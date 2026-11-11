// Lado PRODUTOR do contrato AEVIAS-HIPERSISTEMA-1.0 para a origem 'institucional' (stream workforce_activity):
// changes (cursor), snapshot paginado e imutável, reconciliação e expurgo técnico. O outbox é gravado por trigger no
// banco (db/schema.sql), na mesma transação da mudança; aqui só se LÊ dele. Não importa config nem o pool global: recebe
// o Pool e a chave de cursor, para o teste usar um banco descartável.
//
// Regras que o coletor do RH (aevias-rh/server/src/integrations/collectors/collector.ts) exige e este módulo cumpre:
//  - cursor opaco e DETERMINÍSTICO por posição: o RH compara high_watermark da reconciliação com o do checkpoint;
//  - high_watermark de changes = posição do último item entregue (não a ponta do stream), senão página parcial vira
//    "divergência" e dispara re-snapshot em loop;
//  - snapshot em visão REPEATABLE READ junto do watermark; páginas imutáveis; todo evento depois de H está no feed;
//  - tombstone = operation delete sem conteúdo; a barreira de versão fica em integracao_versoes;
//  - cursor fora da retenção (ou inválido/forjado) = 410 cursor_expired.
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ErroFeed, resposta, valido } from './integracao-contrato.js';

const STREAM = 'workforce_activity';
const CONSUMIDOR = 'rh-collector';
const MAX_LIMITE = 1000;
export const RETENCAO_DIAS = 90;
export const VALIDADE_SNAPSHOT_HORAS = 24;

const expirado = () => new ErroFeed(410, 'cursor_expired', 'schema', 'Cursor expirado; solicite novo snapshot.');
const invalido = (m = 'Requisição inválida.') => new ErroFeed(400, 'invalid_request', 'schema', m);

export function codecCursor(chave: string) {
  const mac = (texto: string) => createHmac('sha256', chave).update(texto).digest('hex').slice(0, 32);
  const confere = (texto: string, assinatura: string) => {
    const a = Buffer.from(mac(texto)),
      b = Buffer.from(assinatura);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  return {
    /** Posição do stream. Determinístico: a mesma posição sempre gera a mesma string. */
    posicao: (sequencia: bigint | string) => {
      const t = `c1.${sequencia}`;
      return `${t}.${mac(t)}`;
    },
    lerPosicao(valor: unknown): bigint {
      const [v, n, m] = String(valor ?? '').split('.');
      if (v !== 'c1' || !/^\d{1,18}$/.test(n ?? '') || !m || !confere(`c1.${n}`, m)) throw expirado();
      return BigInt(n);
    },
    pagina: (snapshotId: string, depoisDe: string) => {
      const corpo = Buffer.from(JSON.stringify({ s: snapshotId, a: depoisDe })).toString('base64url');
      const t = `s1.${corpo}`;
      return `${t}.${mac(t)}`;
    },
    lerPagina(valor: unknown): { s: string; a: string } {
      const [v, corpo, m] = String(valor ?? '').split('.');
      if (v !== 's1' || !corpo || !m || !confere(`s1.${corpo}`, m)) throw expirado();
      try {
        const o = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
        if (typeof o.s !== 'string' || typeof o.a !== 'string') throw 0;
        return o;
      } catch {
        throw expirado();
      }
    }
  };
}

function limite(valor: unknown) {
  if (valor === undefined || valor === null || valor === '') return 500;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMITE) throw invalido('Limite inválido.');
  return n;
}

async function transacao<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/**
 * Estado atual de todos os agregados que o feed expõe, já no formato do evento (sem dado pessoal: ver LGPD no schema.sql).
 * Usado pelo snapshot e pela reconciliação sobre a MESMA visão, então os dois sempre concordam entre si.
 */
const ESTADO_ATUAL = `
  SELECT 'application:' || c.id AS aggregate_id, c.id::text AS source_id, coalesce(v.version, 1) AS version,
         'institucional.application.status_changed.v1' AS event_type, c.criado_em AS occurred_at,
         'application/' || integracao_status_candidatura(c.status) AS particao,
         jsonb_build_object('status', integracao_status_candidatura(c.status), 'area_code', integracao_area(c.area),
           'treatment_version', coalesce((SELECT valor FROM integracao_config WHERE chave = 'privacidade_versao'), 'nao-registrada'),
           'consent_reference', CASE WHEN c.consentimento THEN 'site:candidatura:' || c.id ELSE NULL END,
           'historical_snapshot', true) AS payload
    FROM candidaturas c LEFT JOIN integracao_versoes v ON v.aggregate_id = 'application:' || c.id
  UNION ALL
  SELECT 'admin_action:' || a.id, a.id::text, coalesce(v.version, 1),
         'institucional.admin_action.recorded.v1', a.criado_em,
         'admin_action/' || (integracao_admin_acao(a.acao, a.entidade))[1],
         jsonb_build_object('category', (integracao_admin_acao(a.acao, a.entidade))[1],
           'action', (integracao_admin_acao(a.acao, a.entidade))[2], 'historical_snapshot', true)
    FROM auditoria a LEFT JOIN integracao_versoes v ON v.aggregate_id = 'admin_action:' || a.id
   WHERE integracao_admin_acao(a.acao, a.entidade) IS NOT NULL`;

export function criarProdutor(pool: Pool, chaveCursor: string) {
  const codec = codecCursor(chaveCursor);

  async function ponta(c: Pool | PoolClient) {
    const { rows } = await c.query('SELECT sequence::text AS sequence, retained_after::text AS retained_after FROM integracao_stream WHERE stream = $1', [STREAM]);
    if (!rows[0]) throw new ErroFeed(503, 'core_unavailable', 'network', 'Serviço indisponível. Tente novamente.');
    return { sequencia: BigInt(rows[0].sequence), retida: BigInt(rows[0].retained_after) };
  }

  return {
    codec,

    async changes(consulta: { cursor?: unknown; limit?: unknown }) {
      const max = limite(consulta.limit);
      const desde = consulta.cursor === undefined || consulta.cursor === '' ? 0n : codec.lerPosicao(consulta.cursor);
      return transacao(pool, async (c) => {
        const { sequencia, retida } = await ponta(c);
        if (desde < retida || desde > sequencia) throw expirado();
        const { rows } = await c.query('SELECT sequence::text AS sequence, event FROM integracao_outbox WHERE sequence > $1 AND sequence <= $2 ORDER BY sequence LIMIT $3', [desde.toString(), sequencia.toString(), max + 1]);
        const pagina = rows.slice(0, max);
        const ultima = pagina.length ? BigInt(pagina[pagina.length - 1].sequence) : desde;
        return resposta('ChangesResponse', {
          items: pagina.map((r) => r.event),
          next_cursor: codec.posicao(ultima),
          has_more: rows.length > max,
          // posição realmente entregue, não a ponta do stream (ver cabeçalho)
          high_watermark: codec.posicao(ultima),
          generated_at: new Date().toISOString(),
          schema_version: 1
        });
      });
    },

    async criarSnapshot(corpo: unknown, chaveOperacao: string) {
      if (!valido('SnapshotRequest', corpo) || !chaveOperacao || chaveOperacao.length > 128 || !/^[\x21-\x7e]+$/.test(chaveOperacao))
        throw invalido('Snapshot requer stream, request_id e Idempotency-Key.');
      const pedido = corpo as { stream: string; request_id: string };
      const hash = createHash('sha256').update(JSON.stringify({ stream: pedido.stream, request_id: pedido.request_id })).digest('hex');
      const responder = (linha: any) => {
        if (linha.request_hash !== hash) throw new ErroFeed(409, 'idempotency_conflict', 'conflict', 'Idempotency-Key usada com outro corpo.');
        if (new Date(linha.expires_at).getTime() <= Date.now()) throw expirado();
        return resposta('SnapshotCreated', {
          snapshot_id: linha.id,
          high_watermark: codec.posicao(linha.high_watermark),
          expires_at: new Date(linha.expires_at).toISOString(),
          schema_version: 1,
          request_id: linha.request_id
        });
      };
      const existente = await pool.query('SELECT * FROM integracao_snapshots WHERE consumer = $1 AND operation_key = $2', [CONSUMIDOR, chaveOperacao]);
      if (existente.rows[0]) return responder({ ...existente.rows[0], high_watermark: existente.rows[0].high_watermark });
      try {
        return await transacao(pool, async (c) => {
          const { sequencia } = await ponta(c); // fixa a visão MVCC: tudo que se lê abaixo é o estado em H
          const estado = (await c.query(ESTADO_ATUAL)).rows;
          const id = randomUUID();
          // evento.sequence tem de casar ^[1-9][0-9]*$: com stream ainda vazio (H=0) usa "1"
          const seqEvento = (sequencia > 0n ? sequencia : 1n).toString();
          const { rows } = await c.query(
            `INSERT INTO integracao_snapshots (id, consumer, operation_key, request_hash, request_id, high_watermark, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(hours => $7)) RETURNING *`,
            [id, CONSUMIDOR, chaveOperacao, hash, pedido.request_id, sequencia.toString(), VALIDADE_SNAPSHOT_HORAS]
          );
          for (let i = 0; i < estado.length; i += 500) {
            const lote = estado.slice(i, i + 500);
            const eventos = lote.map((e: any) => ({
              event_id: randomUUID(),
              source_system: 'institucional',
              stream: STREAM,
              sequence: seqEvento,
              event_type: e.event_type,
              schema_version: 1,
              source_id: e.source_id,
              aggregate_id: e.aggregate_id,
              aggregate_version: e.version,
              person_id: null,
              actor_auth_user_id: null,
              occurred_at: new Date(e.occurred_at).toISOString(),
              recorded_at: new Date().toISOString(),
              effective_date: dataSaoPaulo(new Date(e.occurred_at)),
              operation: 'upsert',
              payload: e.payload,
              trace_id: randomUUID()
            }));
            for (const ev of eventos) if (!valido('Event', ev)) throw new ErroFeed(503, 'dependency_contract_mismatch', 'schema', 'Serviço indisponível. Tente novamente.');
            await c.query(
              `INSERT INTO integracao_snapshot_itens (snapshot_id, aggregate_id, event)
               SELECT $1, a, e::jsonb FROM unnest($2::text[], $3::text[]) AS t(a, e)`,
              [id, eventos.map((e) => e.aggregate_id), eventos.map((e) => JSON.stringify(e))]
            );
          }
          return responder(rows[0]);
        });
      } catch (e: any) {
        // Duas criações simultâneas com a mesma chave: a perdedora devolve a resposta da vencedora (idempotência).
        if (e?.code === '23505') {
          const r = await pool.query('SELECT * FROM integracao_snapshots WHERE consumer = $1 AND operation_key = $2', [CONSUMIDOR, chaveOperacao]);
          if (r.rows[0]) return responder(r.rows[0]);
        }
        throw e;
      }
    },

    async paginaSnapshot(id: string, consulta: { cursor?: unknown; limit?: unknown }) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw expirado();
      const max = limite(consulta.limit);
      const cur = consulta.cursor === undefined || consulta.cursor === '' ? null : codec.lerPagina(consulta.cursor);
      if (cur && cur.s !== id) throw expirado();
      const snap = (await pool.query('SELECT high_watermark::text AS h FROM integracao_snapshots WHERE id = $1 AND consumer = $2 AND expires_at > now()', [id, CONSUMIDOR])).rows[0];
      if (!snap) throw expirado();
      const { rows } = await pool.query('SELECT aggregate_id, event FROM integracao_snapshot_itens WHERE snapshot_id = $1 AND aggregate_id > $2 ORDER BY aggregate_id LIMIT $3', [id, cur?.a ?? '', max + 1]);
      const pagina = rows.slice(0, max);
      const mais = rows.length > max;
      return resposta('SnapshotPage', {
        snapshot_id: id,
        items: pagina.map((r) => r.event),
        next_cursor: mais ? codec.pagina(id, pagina[pagina.length - 1].aggregate_id) : null,
        has_more: mais,
        high_watermark: codec.posicao(snap.h),
        schema_version: 1
      });
    },

    async reconciliacao() {
      return transacao(pool, async (c) => {
        const { sequencia } = await ponta(c);
        const linhas = (await c.query(`SELECT aggregate_id, version, particao, payload FROM (${ESTADO_ATUAL}) e ORDER BY particao, aggregate_id`)).rows;
        const grupos = new Map<string, any[]>();
        for (const l of linhas) (grupos.get(l.particao) ?? grupos.set(l.particao, []).get(l.particao)!).push(l);
        return resposta('Reconciliation', {
          source_system: 'institucional',
          schema_version: 1,
          high_watermark: codec.posicao(sequencia),
          generated_at: new Date().toISOString(),
          // digest sobre id opaco + versão + estado; nunca hash de CPF/e-mail (não há dado pessoal aqui)
          partitions: [...grupos].map(([particao, itens]) => ({
            partition: particao,
            count: itens.length,
            sha256: createHash('sha256')
              .update(itens.map((i) => `${i.aggregate_id}|${i.version}|${JSON.stringify({ ...i.payload, historical_snapshot: undefined })}`).join('\n'))
              .digest('hex')
          }))
        });
      });
    },

    /** Retenção técnica do feed (padrão 90 dias, produção deve alinhar com a retenção dos dados exportados). */
    async expurgar(dias = RETENCAO_DIAS) {
      await pool.query('DELETE FROM integracao_snapshots WHERE expires_at < now() - interval \'1 day\'');
      const r = await pool.query(
        `WITH apagados AS (DELETE FROM integracao_outbox WHERE criado_em < now() - make_interval(days => $1) RETURNING sequence)
         UPDATE integracao_stream SET retained_after = greatest(retained_after, coalesce((SELECT max(sequence) FROM apagados), 0))
          WHERE stream = $2 RETURNING retained_after::text`,
        [dias, STREAM]
      );
      return r.rows[0]?.retained_after as string | undefined;
    }
  };
}

const dataSaoPaulo = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/**
 * Publica no banco o que o trigger precisa saber da aplicação: versão do aviso de privacidade vigente e as áreas de vaga
 * publicadas (só elas saem como area_code). Idempotente; chamado a cada migrate e na subida do listener.
 */
export async function publicarConfiguracao(pool: Pool, versaoPolitica: string, areas: string[]) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`INSERT INTO integracao_config (chave, valor) VALUES ('privacidade_versao', $1) ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`, [versaoPolitica]);
    await c.query('DELETE FROM integracao_areas');
    await c.query('INSERT INTO integracao_areas (slug) SELECT DISTINCT integracao_slug(a) FROM unnest($1::text[]) AS a WHERE integracao_slug(a) <> \'\'', [areas]);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
