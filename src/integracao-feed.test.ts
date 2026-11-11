// Feed do produtor 'institucional' para o RH (AEVIAS-HIPERSISTEMA-1.0): contra um Postgres de verdade (o embutido do
// repositório do Comercial HS, em pasta temporária e porta livre, que some ao fim) e contra um listener mTLS real com
// certificados gerados por openssl. PULA se o Postgres embutido ou o openssl não existirem. Não toca o banco do site.
//
// O "consumidor" do teste reproduz as regras do coletor do RH (barreira de aggregate_version, snapshot em staging,
// tombstone, reconciliação por contagem) para provar que o produtor satisfaz o que o coletor exige.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { createServer, type AddressInfo } from 'node:net';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { valido, ErroFeed, CONTRACT_HASH, CONTRACT_VERSION } from './integracao-contrato.js';
import { criarProdutor, publicarConfiguracao } from './integracao-produtor.js';
import { autorizadorAuth, construirIntegracao, lerConfigIntegracao, parDoTls } from './integracao-servidor.js';
import { transporteMtls } from './comercial.js';

const hsDir = path.resolve(process.env.HS_DIR ?? path.join(process.cwd(), '..', '..', 'aevias_comercial_HS'));
const pgEmbutido = path.join(hsDir, 'scripts', 'pg-embutido.mjs');
const temPg = fs.existsSync(pgEmbutido) && fs.existsSync(path.join(hsDir, 'node_modules', 'embedded-postgres'));
const temOpenssl = (() => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
})();
const portaLivre = () =>
  new Promise<number>((r) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as AddressInfo).port;
      s.close(() => r(p));
    });
  });

const AREAS = ['Engenharia de projetos', 'Tecnologia da informação'];
const PII = ['Fulana', 'Secreta', 'fulana@exemplo.test', '1.2.3.4', 'texto livre', '99999-0000', 'adm@exemplo.test'];
const CHAVE = 'chave-de-teste-do-cursor';

/** Consumidor mínimo com as regras do coletor do RH. */
function consumidor() {
  const atual = new Map<string, { v: number; deleted: boolean; e: any }>();
  const aplicar = (e: any) => {
    assert.ok(valido('Event', e), 'evento fora do schema: ' + JSON.stringify(e).slice(0, 200));
    assert.equal(e.source_system, 'institucional');
    const ant = atual.get(e.aggregate_id);
    if (ant && ant.v >= e.aggregate_version) return;
    atual.set(e.aggregate_id, { v: e.aggregate_version, deleted: e.operation === 'delete', e });
  };
  const vivos = () => [...atual.values()].filter((x) => !x.deleted);
  return { atual, aplicar, vivos };
}

test(
  'feed do produtor institucional contra Postgres real',
  { skip: (!temPg && 'repositório do Comercial HS (Postgres embutido) não encontrado; defina HS_DIR') || undefined },
  async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-feed-'));
    const porta = await portaLivre();
    const { iniciarPg } = await import(pathToFileURL(pgEmbutido).href);
    let servidor: any;
    try {
      servidor = await iniciarPg({ dir, porta, banco: 'site_feed' });
    } catch (falha) {
      t.skip(`Postgres embutido não subiu: ${falha instanceof Error ? falha.message : falha}`);
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    }
    const pool = new pg.Pool({ connectionString: servidor.urls.migracao, max: 6 });
    const schema = fs.readFileSync(path.join(process.cwd(), 'db', 'schema.sql'), 'utf8');
    try {
      await pool.query(schema);
      await pool.query(schema); // idempotente: roda a cada deploy
      await publicarConfiguracao(pool, '2026-11-06', AREAS);
      await publicarConfiguracao(pool, '2026-11-06', AREAS); // idempotente
      const produtor = criarProdutor(pool, CHAVE);
      const q = (sql: string, p: unknown[] = []) => pool.query(sql, p).then((r) => r.rows);
      const nova = async (extra: Record<string, unknown> = {}) => {
        const v = { nome: 'Fulana', sobrenome: 'Secreta', email: 'fulana@exemplo.test', telefone: '(41) 99999-0000', area: 'Engenharia de projetos', mensagem: 'texto livre', ip: '1.2.3.4', ...extra };
        return (await q(
          `INSERT INTO candidaturas (nome, sobrenome, email, telefone, area, mensagem, arquivo_nome, arquivo_dados, consentimento, ip, user_agent)
           VALUES ($1,$2,$3,$4,$5,$6,'cv.pdf','\\x25504446'::bytea,TRUE,$7,'UA') RETURNING id`,
          [v.nome, v.sobrenome, v.email, v.telefone, v.area, v.mensagem, v.ip]
        ))[0].id as string;
      };
      const semPii = (x: unknown) => {
        const s = JSON.stringify(x);
        for (const p of PII) assert.ok(!s.includes(p), `vazou "${p}" no feed`);
      };

      await t.test('stream vazio: changes sem cursor devolve página válida e snapshot vazio é aceito (sequence >= 1)', async () => {
        const c = await produtor.changes({});
        assert.deepEqual(c.items, []);
        assert.equal(c.has_more, false);
        assert.equal(c.high_watermark, produtor.codec.posicao(0n));
        const s = await produtor.criarSnapshot({ stream: 'workforce_activity', request_id: '11111111-1111-4111-8111-111111111111' }, 'op-vazio');
        assert.ok(valido('SnapshotCreated', s));
        const p = await produtor.paginaSnapshot(s.snapshot_id, { limit: 500 });
        assert.deepEqual(p.items, []);
        assert.equal(p.next_cursor, null);
        const r = await produtor.reconciliacao();
        assert.deepEqual(r.partitions, []);
        assert.equal(r.high_watermark, c.high_watermark, 'mesma posição, mesma string: o RH compara por igualdade');
      });

      let ultima = produtor.codec.posicao(0n);
      const lote = async (limite = 500) => {
        const c = await produtor.changes({ cursor: ultima, limit: limite });
        ultima = c.next_cursor!;
        return c;
      };

      await t.test('candidatura nova vira application.received.v1 mínimo, no schema e sem dado pessoal', async () => {
        const id = await nova();
        const c = await lote();
        assert.equal(c.items.length, 1);
        const e: any = c.items[0];
        assert.equal(e.event_type, 'institucional.application.received.v1');
        assert.equal(e.operation, 'upsert');
        assert.equal(e.aggregate_version, 1);
        assert.equal(e.source_id, id);
        assert.equal(e.aggregate_id, `application:${id}`);
        assert.equal(e.person_id, null);
        assert.equal(e.actor_auth_user_id, null);
        assert.equal(e.sequence, '1');
        assert.deepEqual(e.payload, {
          status: 'received',
          area_code: 'engenharia-de-projetos',
          treatment_version: '2026-11-06',
          consent_reference: `site:candidatura:${id}`,
          historical_snapshot: false
        });
        semPii(c);
        assert.equal(c.high_watermark, c.next_cursor);
      });

      await t.test('área fora das publicadas (texto livre) sai null: nada de texto do candidato no feed', async () => {
        await nova({ area: 'Maria Silva, CPF 123.456.789-09' });
        const c = await lote();
        assert.equal((c.items[0] as any).payload.area_code, null);
        assert.ok(!JSON.stringify(c).includes('123.456'));
      });

      await t.test('mudança de status gera nova versão; observação e troca interna entre estados equivalentes não geram', async () => {
        const id = await nova();
        await lote();
        await q(`UPDATE candidaturas SET status = 'em análise' WHERE id = $1`, [id]);
        await q(`UPDATE candidaturas SET status = 'entrevista' WHERE id = $1`, [id]); // screening -> screening
        await q(`UPDATE candidaturas SET observacao = 'anotação interna', atualizado_em = now() WHERE id = $1`, [id]);
        await q(`UPDATE candidaturas SET status = 'banco de talentos' WHERE id = $1`, [id]);
        const c = await lote();
        assert.deepEqual(
          c.items.map((e: any) => [e.event_type, e.aggregate_version, e.payload.status]),
          [
            ['institucional.application.status_changed.v1', 2, 'screening'],
            ['institucional.application.status_changed.v1', 3, 'closed']
          ]
        );
        semPii(c);
      });

      await t.test('atividade administrativa: só categoria/ação; login e senha não entram; e-mail de quem agiu nunca sai', async () => {
        const ins = (acao: string, entidade: string | null) =>
          q(`INSERT INTO auditoria (usuario_email, acao, entidade, entidade_id, detalhes, ip) VALUES ('adm@exemplo.test', $1, $2, 'x', '{"status":"novo"}', '1.2.3.4')`, [acao, entidade]);
        await ins('login.ok', null);
        await ins('senha.alterada', null);
        await ins('registro.atualizado', 'relatos_integridade'); // relato de integridade: proibido
        await ins('registro.atualizado', 'solicitacoes_lgpd'); // portal do titular: proibido
        await ins('registro.atualizado', 'candidaturas');
        await ins('registro.excluido', 'contatos');
        const c = await lote();
        assert.deepEqual(
          c.items.map((e: any) => [e.event_type, e.payload.category, e.payload.action, e.person_id, e.actor_auth_user_id]),
          [
            ['institucional.admin_action.recorded.v1', 'recruitment', 'updated', null, null],
            ['institucional.admin_action.recorded.v1', 'general_service', 'closed', null, null]
          ]
        );
        semPii(c);
      });

      await t.test('exclusão (retenção, painel ou LGPD) gera tombstone sem conteúdo, com versão maior', async () => {
        const id = await nova();
        await lote();
        await q(`DELETE FROM candidaturas WHERE id = $1`, [id]);
        const c = await lote();
        const e: any = c.items[0];
        assert.equal(e.operation, 'delete');
        assert.deepEqual(e.payload, {});
        assert.equal(e.person_id, null);
        assert.equal(e.aggregate_version, 2);
        assert.equal(e.aggregate_id, `application:${id}`);
        const [barreira] = await q('SELECT version, deleted FROM integracao_versoes WHERE aggregate_id = $1', [`application:${id}`]);
        assert.deepEqual(barreira, { version: 2, deleted: true }, 'barreira técnica contra ressurreição, sem dado pessoal');
      });

      await t.test('paginação por cursor: has_more, high_watermark = posição entregue, sem perda nem repetição', async () => {
        const antes = ultima;
        for (let i = 0; i < 5; i++) await nova();
        const vistos: string[] = [];
        let cur = antes;
        for (let i = 0; i < 10; i++) {
          const c = await produtor.changes({ cursor: cur, limit: 2 });
          assert.ok(c.items.length <= 2);
          assert.equal(c.high_watermark, c.next_cursor);
          vistos.push(...c.items.map((e: any) => e.sequence));
          cur = c.next_cursor!;
          if (!c.has_more) break;
        }
        assert.equal(vistos.length, 5);
        assert.equal(new Set(vistos).size, 5);
        assert.deepEqual([...vistos].map(Number), [...vistos].map(Number).sort((a, b) => a - b), 'ordem do cursor');
        ultima = cur;
      });

      await t.test('cursor forjado, de outra chave, futuro ou limite inválido: 410 / 400, sem eco', async () => {
        const forjado = produtor.codec.posicao(1n).replace(/.$/, (c) => (c === '0' ? '1' : '0'));
        for (const cursor of [forjado, 'lixo', 'c1.99999999999.abc', criarProdutor(pool, 'outra-chave').codec.posicao(1n), produtor.codec.posicao(999999n)])
          await assert.rejects(produtor.changes({ cursor }), (e: any) => e.status === 410 && e.code === 'cursor_expired');
        await assert.rejects(produtor.changes({ limit: 0 }), (e: any) => e.status === 400);
        await assert.rejects(produtor.changes({ limit: 1001 }), (e: any) => e.status === 400);
        await assert.rejects(produtor.changes({ limit: 'x' }), (e: any) => e.status === 400);
      });

      await t.test('snapshot: idempotente por chave, 409 com outro corpo, páginas imutáveis, cursor preso ao snapshot, 410 desconhecido', async () => {
        const pedido = { stream: 'workforce_activity', request_id: '22222222-2222-4222-8222-222222222222' };
        const s1 = await produtor.criarSnapshot(pedido, 'op-1');
        const s2 = await produtor.criarSnapshot(pedido, 'op-1');
        assert.deepEqual(s2, s1);
        await assert.rejects(produtor.criarSnapshot({ ...pedido, request_id: '33333333-3333-4333-8333-333333333333' }, 'op-1'), (e: any) => e.status === 409 && e.code === 'idempotency_conflict');
        await assert.rejects(produtor.criarSnapshot({ stream: 'outro', request_id: pedido.request_id }, 'op-2'), (e: any) => e.status === 400);
        await assert.rejects(produtor.criarSnapshot(pedido, ''), (e: any) => e.status === 400);

        const todas: any[] = [];
        let cur: string | undefined;
        let paginas = 0;
        for (;;) {
          const p = await produtor.paginaSnapshot(s1.snapshot_id, { limit: 3, cursor: cur });
          assert.equal(p.high_watermark, s1.high_watermark);
          todas.push(...p.items);
          paginas++;
          if (!p.has_more) break;
          assert.ok(p.next_cursor && p.next_cursor !== cur);
          cur = p.next_cursor;
        }
        assert.ok(paginas > 1);
        const vivasAgora = await q(`SELECT count(*)::int AS n FROM candidaturas`);
        const adminAgora = await q(`SELECT count(*)::int AS n FROM auditoria WHERE integracao_admin_acao(acao, entidade) IS NOT NULL`);
        assert.equal(todas.length, vivasAgora[0].n + adminAgora[0].n);
        assert.equal(new Set(todas.map((e) => e.event_id)).size, todas.length);
        assert.ok(todas.every((e) => e.payload.historical_snapshot === true && e.operation === 'upsert'));
        semPii(todas);

        // imutável: candidatura criada depois não aparece nas páginas, mas aparece no changes depois de H
        const depois = await nova();
        const p0 = await produtor.paginaSnapshot(s1.snapshot_id, { limit: 1000 });
        assert.ok(!JSON.stringify(p0).includes(depois));
        const c = await produtor.changes({ cursor: s1.high_watermark, limit: 1000 });
        assert.ok(JSON.stringify(c).includes(depois));
        ultima = (await produtor.changes({ cursor: ultima, limit: 1000 })).next_cursor!;

        const outro = await produtor.criarSnapshot({ stream: 'workforce_activity', request_id: '44444444-4444-4444-8444-444444444444' }, 'op-3');
        await assert.rejects(produtor.paginaSnapshot(outro.snapshot_id, { cursor: cur ?? produtor.codec.pagina(s1.snapshot_id, 'x'), limit: 1 }), (e: any) => e.status === 410);
        await assert.rejects(produtor.paginaSnapshot('55555555-5555-4555-8555-555555555555', {}), (e: any) => e.status === 410);
        await assert.rejects(produtor.paginaSnapshot('nao-e-uuid', {}), (e: any) => e.status === 410);
      });

      await t.test('snapshot expirado: 410 na página e na repetição da criação', async () => {
        const pedido = { stream: 'workforce_activity', request_id: '66666666-6666-4666-8666-666666666666' };
        const s = await produtor.criarSnapshot(pedido, 'op-exp');
        await q(`UPDATE integracao_snapshots SET expires_at = now() - interval '1 minute' WHERE id = $1`, [s.snapshot_id]);
        await assert.rejects(produtor.paginaSnapshot(s.snapshot_id, {}), (e: any) => e.status === 410);
        await assert.rejects(produtor.criarSnapshot(pedido, 'op-exp'), (e: any) => e.status === 410);
      });

      await t.test('candidatura apagada some do item ainda não consumido do snapshot (minimização)', async () => {
        const id = await nova();
        const s = await produtor.criarSnapshot({ stream: 'workforce_activity', request_id: '77777777-7777-4777-8777-777777777777' }, 'op-min');
        assert.ok(JSON.stringify(await produtor.paginaSnapshot(s.snapshot_id, { limit: 1000 })).includes(id));
        await q(`DELETE FROM candidaturas WHERE id = $1`, [id]);
        assert.ok(!JSON.stringify(await produtor.paginaSnapshot(s.snapshot_id, { limit: 1000 })).includes(id));
        ultima = (await produtor.changes({ cursor: ultima, limit: 1000 })).next_cursor!;
      });

      await t.test('bootstrap + delta como o coletor do RH: estado do consumidor bate com a reconciliação (contagem e digest estáveis)', async () => {
        const c = consumidor();
        const s = await produtor.criarSnapshot({ stream: 'workforce_activity', request_id: '88888888-8888-4888-8888-888888888888' }, 'op-boot');
        let cur: string | undefined;
        do {
          const p = await produtor.paginaSnapshot(s.snapshot_id, { limit: 4, cursor: cur });
          p.items.forEach(c.aplicar);
          cur = p.next_cursor ?? undefined;
        } while (cur);
        // mudanças depois de H (inclui exclusão de agregado do snapshot e novo)
        const [alvo] = await q(`SELECT id FROM candidaturas ORDER BY criado_em LIMIT 1`);
        await q(`DELETE FROM candidaturas WHERE id = $1`, [alvo.id]);
        await nova();
        let pos = s.high_watermark;
        for (;;) {
          const m = await produtor.changes({ cursor: pos, limit: 2 });
          m.items.forEach(c.aplicar);
          pos = m.next_cursor!;
          if (!m.has_more) {
            assert.equal(m.high_watermark, pos);
            break;
          }
        }
        const rel = await produtor.reconciliacao();
        assert.equal(rel.high_watermark, pos, 'sem escritas novas, o RH vê "mesma posição"');
        assert.equal(rel.partitions.reduce((n: number, p: any) => n + p.count, 0), c.vivos().length);
        const porParticao = new Map<string, number>();
        for (const x of c.vivos()) {
          const k = x.e.event_type.includes('admin_action') ? `admin_action/${x.e.payload.category}` : `application/${x.e.payload.status}`;
          porParticao.set(k, (porParticao.get(k) ?? 0) + 1);
        }
        assert.deepEqual(Object.fromEntries(rel.partitions.map((p: any) => [p.partition, p.count])), Object.fromEntries(porParticao));
        const rel2 = await produtor.reconciliacao();
        assert.deepEqual(rel2.partitions, rel.partitions, 'digest determinístico');
        semPii(rel);
        // qualquer mudança de estado altera o digest da partição afetada
        const [v] = await q(`SELECT id FROM candidaturas LIMIT 1`);
        await q(`UPDATE candidaturas SET status = 'descartado' WHERE id = $1`, [v.id]);
        const rel3 = await produtor.reconciliacao();
        assert.notDeepEqual(rel3.partitions, rel.partitions);
        ultima = (await produtor.changes({ cursor: ultima, limit: 1000 })).next_cursor!;
      });

      await t.test('linhas anteriores ao feed entram só pelo snapshot (versão 1) e o próximo evento é versão 2', async () => {
        await q('ALTER TABLE candidaturas DISABLE TRIGGER candidaturas_integracao');
        const id = await nova({ nome: 'Antiga' });
        await q('ALTER TABLE candidaturas ENABLE TRIGGER candidaturas_integracao');
        await pool.query(schema); // novo deploy: backfill de versões
        assert.equal((await produtor.changes({ cursor: ultima, limit: 1000 })).items.length, 0, 'sem evento retroativo');
        const s = await produtor.criarSnapshot({ stream: 'workforce_activity', request_id: '99999999-9999-4999-8999-999999999999' }, 'op-legado');
        const p = await produtor.paginaSnapshot(s.snapshot_id, { limit: 1000 });
        const e: any = p.items.find((x: any) => x.source_id === id);
        assert.equal(e.aggregate_version, 1);
        await q(`UPDATE candidaturas SET status = 'em análise' WHERE id = $1`, [id]);
        const c = await produtor.changes({ cursor: ultima, limit: 1000 });
        assert.equal((c.items[0] as any).aggregate_version, 2);
        ultima = c.next_cursor!;
      });

      await t.test('retenção: expurgo avança retained_after; cursor mais antigo recebe 410, o atual continua valendo', async () => {
        const antiga = produtor.codec.posicao(1n);
        const atual = (await produtor.changes({ cursor: ultima })).next_cursor!;
        assert.ok(await produtor.expurgar(0), 'expurgo devolve retained_after');
        await assert.rejects(produtor.changes({ cursor: antiga }), (e: any) => e.status === 410);
        const c = await produtor.changes({ cursor: atual });
        assert.deepEqual(c.items, []);
        const [{ n }] = await q('SELECT count(*)::int AS n FROM integracao_outbox');
        assert.equal(n, 0);
        // a barreira de versão e o contador sobrevivem ao expurgo
        const id = await nova();
        const c2 = await produtor.changes({ cursor: atual });
        assert.equal(c2.items.length, 1);
        assert.equal((c2.items[0] as any).source_id, id);
      });

      await t.test('configuração mal feita ou desligada: listener não sobe e não lança', () => {
        const avisos: string[] = [];
        assert.equal(lerConfigIntegracao({}, (m) => avisos.push(m)), null);
        assert.equal(avisos.length, 0, 'desligado por padrão, sem ruído');
        assert.equal(lerConfigIntegracao({ INTEGRACAO_PORT: '4807' }, (m) => avisos.push(m)), null);
        assert.equal(lerConfigIntegracao({ INTEGRACAO_PORT: 'x' }, (m) => avisos.push(m)), null);
        assert.equal(avisos.length, 2);
      });

      // -------------------------------------------------------------- listener mTLS de verdade
      await t.test('listener mTLS', { skip: (!temOpenssl && 'openssl indisponível') || undefined }, async (tt) => {
        const pki = fs.mkdtempSync(path.join(os.tmpdir(), 'site-feed-pki-'));
        const ssl = (args: string[]) => execFileSync('openssl', args, { cwd: pki, stdio: 'pipe' });
        ssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.crt', '-subj', '/CN=Teste CA', '-days', '2']);
        ssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca2.key', '-out', 'ca2.crt', '-subj', '/CN=Outra CA', '-days', '2']);
        const emitir = (nome: string, san: string, ca = 'ca') => {
          fs.writeFileSync(path.join(pki, `${nome}.ext`), `subjectAltName=${san}\n`);
          ssl(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${nome}.key`, '-out', `${nome}.csr`, '-subj', `/CN=${nome}`]);
          ssl(['x509', '-req', '-in', `${nome}.csr`, '-CA', `${ca}.crt`, '-CAkey', `${ca}.key`, '-CAcreateserial', '-out', `${nome}.crt`, '-days', '2', '-extfile', `${nome}.ext`]);
        };
        emitir('srv', 'DNS:localhost,IP:127.0.0.1');
        emitir('coletor', 'URI:urn:aevias:service:rh-collector');
        emitir('outro', 'URI:urn:aevias:service:comercial-api');
        emitir('semsan', 'DNS:x.local');
        emitir('forasteiro', 'URI:urn:aevias:service:rh-collector', 'ca2');
        emitir('site', 'URI:urn:aevias:service:institucional-api');
        const ler = (n: string) => fs.readFileSync(path.join(pki, n));

        const chamadas: { servico: string; sha: string; capacidade: string }[] = [];
        let decisao = 'permitir' as 'permitir' | 'negar' | 'cair';
        const app = construirIntegracao(pool, {
          https: { key: ler('srv.key'), cert: ler('srv.crt'), ca: ler('ca.crt'), requestCert: true, rejectUnauthorized: true },
          chaveCursor: CHAVE,
          autorizar: async (par, capacidade) => {
            chamadas.push({ servico: par.servico, sha: par.sha256, capacidade });
            if (decisao === 'negar') throw new ErroFeed(403, 'scope_denied');
            if (decisao === 'cair') throw new ErroFeed(503, 'core_unavailable', 'network');
          }
        });
        await app.listen({ port: 0, host: '127.0.0.1' });
        const alvo = (app.server.address() as AddressInfo).port;
        const chamar = (metodo: string, caminho: string, cli: string | null, corpo?: unknown, cab: Record<string, string> = {}) =>
          new Promise<{ status: number; corpo: any }>((resolver, rejeitar) => {
            const conteudo = corpo === undefined ? undefined : JSON.stringify(corpo);
            const req = https.request(
              { host: '127.0.0.1', port: alvo, servername: 'localhost', path: caminho, method: metodo, ca: ler('ca.crt'), ...(cli ? { cert: ler(`${cli}.crt`), key: ler(`${cli}.key`) } : {}), agent: false,
                headers: { ...(conteudo ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(conteudo) } : {}), ...cab } },
              (res) => {
                const partes: Buffer[] = [];
                res.on('data', (p) => partes.push(p));
                res.on('end', () => resolver({ status: res.statusCode!, corpo: JSON.parse(Buffer.concat(partes).toString() || 'null') }));
              }
            );
            req.on('error', rejeitar);
            req.end(conteudo);
          });
        try {
          await tt.test('rh-collector com capacidade: capabilities, changes, snapshot, página e reconciliação no schema do contrato', async () => {
            const cap = await chamar('GET', '/internal/capabilities', 'coletor');
            assert.equal(cap.status, 200);
            assert.ok(valido('Capabilities', cap.corpo));
            assert.deepEqual([cap.corpo.app_code, cap.corpo.contract_version, cap.corpo.contract_sha256], ['institucional', CONTRACT_VERSION, CONTRACT_HASH]);
            assert.equal(chamadas.at(-1)!.capacidade, 'capabilities.read');
            assert.match(chamadas.at(-1)!.sha, /^[a-f0-9]{64}$/);

            const posicao = produtor.codec.posicao(BigInt((await q('SELECT sequence FROM integracao_stream'))[0].sequence));
            const ch = await chamar('GET', '/api/integracao/v1/changes?limit=500&cursor=' + encodeURIComponent(posicao), 'coletor');
            assert.equal(ch.status, 200);
            assert.ok(valido('ChangesResponse', ch.corpo));
            assert.equal(chamadas.at(-1)!.capacidade, 'feed.read');
            assert.equal((await chamar('GET', '/api/integracao/v1/changes', 'coletor')).status, 410, 'sem cursor depois de expurgo: o RH deve fazer snapshot');

            const sn = await chamar('POST', '/api/integracao/v1/snapshots', 'coletor', { stream: 'workforce_activity', request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, { 'idempotency-key': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
            assert.equal(sn.status, 200);
            assert.ok(valido('SnapshotCreated', sn.corpo));
            const pg1 = await chamar('GET', `/api/integracao/v1/snapshots/${sn.corpo.snapshot_id}?limit=500`, 'coletor');
            assert.equal(pg1.status, 200);
            assert.ok(valido('SnapshotPage', pg1.corpo));
            const rc = await chamar('GET', '/api/integracao/v1/reconciliation', 'coletor');
            assert.equal(rc.status, 200);
            assert.ok(valido('Reconciliation', rc.corpo));
            assert.equal(rc.corpo.source_system, 'institucional');
            const conflito = await chamar('POST', '/api/integracao/v1/snapshots', 'coletor', { stream: 'workforce_activity', request_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, { 'idempotency-key': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
            assert.equal(conflito.status, 409);
            assert.ok(valido('Error', conflito.corpo));
            const antigo = await chamar('GET', '/api/integracao/v1/changes?cursor=c1.1.zzz', 'coletor');
            assert.equal(antigo.status, 410);
            assert.equal(antigo.corpo.code, 'cursor_expired');
            assert.ok(valido('Error', antigo.corpo));
          });

          await tt.test('outra identidade de serviço, SAN ausente, CA estranha e sem certificado: negados antes do AUTH', async () => {
            const antes = chamadas.length;
            for (const cli of ['outro', 'semsan']) {
              const r = await chamar('GET', '/api/integracao/v1/changes', cli);
              assert.equal(r.status, 403);
              assert.ok(valido('Error', r.corpo));
              assert.equal(r.corpo.code, 'scope_denied');
            }
            await assert.rejects(chamar('GET', '/api/integracao/v1/changes', 'forasteiro'));
            await assert.rejects(chamar('GET', '/api/integracao/v1/changes', null));
            assert.equal(chamadas.length, antes, 'o AUTH nem é consultado para quem não é o coletor');
          });

          await tt.test('AUTH nega a capacidade (403) ou cai (503): nunca devolve dado; só as rotas do feed existem', async () => {
            decisao = 'negar';
            const n = await chamar('GET', '/api/integracao/v1/reconciliation', 'coletor');
            assert.equal(n.status, 403);
            assert.ok(valido('Error', n.corpo));
            decisao = 'cair';
            const d = await chamar('GET', '/api/integracao/v1/changes', 'coletor');
            assert.equal(d.status, 503);
            assert.equal(d.corpo.retryable, true);
            assert.ok(valido('Error', d.corpo));
            decisao = 'permitir';
            for (const [m, c] of [['GET', '/'], ['GET', '/admin'], ['POST', '/api/integracao/v1/comercial/leads'], ['GET', '/api/integracao/v1/timesheets']] as const) {
              const r = await chamar(m, c, 'coletor', m === 'POST' ? {} : undefined);
              assert.equal(r.status, 403, `${m} ${c}`);
            }
            assert.equal((await chamar('GET', '/health/live', 'coletor')).status, 200);
          });

          await tt.test('autorizadorAuth contra um AUTH de mentira por mTLS: identidade institucional-api, corpo do contrato, nega e 5xx', async () => {
            const vistos: any[] = [];
            let resp: { status: number; corpo: unknown } = { status: 200, corpo: { allowed: true, service_id: 'rh-collector', app_code: 'institucional', policy_version: 1 } };
            const auth = https.createServer(
              { key: ler('srv.key'), cert: ler('srv.crt'), ca: ler('ca.crt'), requestCert: true, rejectUnauthorized: true },
              (req, res) => {
                const partes: Buffer[] = [];
                req.on('data', (p) => partes.push(p));
                req.on('end', () => {
                  vistos.push({ url: req.url, metodo: req.method, san: (req.socket as any).getPeerCertificate().subjectaltname, corpo: JSON.parse(Buffer.concat(partes).toString()) });
                  res.writeHead(resp.status, { 'content-type': 'application/json' });
                  res.end(JSON.stringify(resp.corpo));
                });
              }
            );
            await new Promise<void>((r) => auth.listen(0, '127.0.0.1', r));
            try {
              const url = new URL(`https://localhost:${(auth.address() as AddressInfo).port}/`);
              const autorizar = autorizadorAuth(transporteMtls({ url, ca: ler('ca.crt'), cert: ler('site.crt'), key: ler('site.key') }, 5000));
              const par = { servico: 'rh-collector', sha256: 'a'.repeat(64) };
              await autorizar(par, 'feed.read');
              assert.equal(vistos[0].url, '/v1/service-authorize-peer');
              assert.equal(vistos[0].metodo, 'POST');
              assert.match(vistos[0].san, /urn:aevias:service:institucional-api/);
              assert.deepEqual(Object.keys(vistos[0].corpo).sort(), ['app_code', 'capability', 'certificate_sha256', 'request_id', 'service_id']);
              assert.deepEqual([vistos[0].corpo.app_code, vistos[0].corpo.capability, vistos[0].corpo.service_id, vistos[0].corpo.certificate_sha256], ['institucional', 'feed.read', 'rh-collector', 'a'.repeat(64)]);
              resp = { status: 403, corpo: { error: 'x', code: 'scope_denied', errorCategory: 'permission', request_id: 'x', retryable: false } };
              await assert.rejects(autorizar(par, 'feed.read'), (e: any) => e.status === 403);
              resp = { status: 200, corpo: { allowed: true, service_id: 'outro', app_code: 'institucional', policy_version: 1 } };
              await assert.rejects(autorizar(par, 'feed.read'), (e: any) => e.status === 503);
              resp = { status: 500, corpo: {} };
              await assert.rejects(autorizar(par, 'feed.read'), (e: any) => e.status === 503);
            } finally {
              await new Promise((r) => auth.close(r));
            }
            await assert.rejects(autorizadorAuth(transporteMtls({ url: new URL('https://localhost:1/'), ca: ler('ca.crt'), cert: ler('site.crt'), key: ler('site.key') }, 500))({ servico: 'rh-collector', sha256: 'a'.repeat(64) }, 'feed.read'), (e: any) => e.status === 503);
          });
        } finally {
          await app.close();
          fs.rmSync(pki, { recursive: true, force: true });
        }
      });
      void parDoTls;
    } finally {
      await pool.end().catch(() => {});
      await servidor.stop().catch(() => {});
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);
