// Painel Infra: GET /api/wallpaper/usuarios (401, formato, cache, sem log, fora do rate limit, sem CORS) e a deduplicação
// do registro de atividade. Banco falso, sem Postgres: as regras de contagem contra um banco real estão em
// src/wallpaper-banco.test.ts.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import {
  ROTA_WALLPAPER,
  TOKEN_MINIMO,
  calcularEstatisticas,
  criarRegistroAtividade,
  inicioDaHora,
  rotaWallpaper,
  tokenConfere
} from './wallpaper.js';

const SEGREDO = 'segredo-de-teste-do-painel-infra-0123456789abcdef';
const AGORA = Date.parse('2026-11-25T12:34:56.789Z');
const H = 3_600_000;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Banco falso: responde às duas consultas da rota e guarda o que recebeu. Linhas trazem campos pessoais de propósito. */
function bancoFalso(opcoes: { total?: number; ativos?: number; porHora?: Record<string, number>; falhar?: boolean } = {}) {
  const chamadas: { sql: string; parametros?: unknown[] }[] = [];
  const banco = {
    chamadas,
    async query(sql: string, parametros?: unknown[]) {
      chamadas.push({ sql, parametros });
      if (opcoes.falhar) throw new Error('banco fora do ar: conta pessoa@exemplo.test');
      if (/GROUP BY a\.hora/.test(sql)) {
        return {
          rows: Object.entries(opcoes.porHora ?? {}).map(([hora, ativos]) => ({
            hora: new Date(hora),
            ativos,
            email: 'pessoa@exemplo.test',
            usuario_id: '11111111-1111-4111-8111-111111111111'
          }))
        };
      }
      return { rows: [{ total_usuarios: opcoes.total ?? 0, ativos_24h: opcoes.ativos ?? 0, nome: 'Pessoa' }] };
    }
  };
  return banco;
}

async function montar(banco: ReturnType<typeof bancoFalso>, extra: { segredo?: string | undefined; agora?: () => number } = {}) {
  const app = Fastify();
  rotaWallpaper(app, { banco, segredo: () => ('segredo' in extra ? extra.segredo : SEGREDO), agora: extra.agora ?? (() => AGORA) });
  await app.ready();
  return app;
}

const comToken = (token: string) => ({ authorization: `Bearer ${token}` });

test('tokenConfere: só o Bearer certo, e nunca com segredo ausente ou curto', () => {
  assert.equal(tokenConfere(`Bearer ${SEGREDO}`, SEGREDO), true);
  assert.equal(tokenConfere(`bearer ${SEGREDO}`, SEGREDO), true, 'o esquema não diferencia maiúsculas');
  assert.equal(tokenConfere(undefined, SEGREDO), false);
  assert.equal(tokenConfere('', SEGREDO), false);
  assert.equal(tokenConfere(SEGREDO, SEGREDO), false, 'sem o esquema Bearer');
  assert.equal(tokenConfere(`Basic ${SEGREDO}`, SEGREDO), false);
  assert.equal(tokenConfere(`Bearer ${SEGREDO}x`, SEGREDO), false);
  assert.equal(tokenConfere(`Bearer ${SEGREDO.slice(0, -1)}`, SEGREDO), false);
  assert.equal(tokenConfere('Bearer ', SEGREDO), false);
  const curto = 'a'.repeat(TOKEN_MINIMO - 1);
  assert.equal(tokenConfere(`Bearer ${curto}`, curto), false, 'segredo com menos de 32 caracteres: sempre 401');
  assert.equal(tokenConfere('Bearer ', ''), false);
  assert.equal(tokenConfere('Bearer undefined', undefined), false);
  const exato = 'b'.repeat(TOKEN_MINIMO);
  assert.equal(tokenConfere(`Bearer ${exato}`, exato), true, '32 caracteres bastam');
});

test('401 sem token, com token errado e com a variável ausente ou curta; o banco nem é consultado', async () => {
  const banco = bancoFalso({ total: 3 });
  const app = await montar(banco);
  for (const headers of [{}, comToken('errado'), comToken(SEGREDO + 'x'), { authorization: `Basic ${SEGREDO}` }, { authorization: SEGREDO }]) {
    const r = await app.inject({ url: ROTA_WALLPAPER, headers });
    assert.equal(r.statusCode, 401, JSON.stringify(headers));
    assert.deepEqual(r.json(), { erro: 'nao_autorizado' });
    assert.equal(r.headers['www-authenticate'], 'Bearer');
  }
  await app.close();

  for (const segredo of [undefined, '', 'c'.repeat(TOKEN_MINIMO - 1)]) {
    const fechada = await montar(banco, { segredo });
    const r = await fechada.inject({ url: ROTA_WALLPAPER, headers: comToken(segredo ?? '') });
    assert.equal(r.statusCode, 401, `segredo ${JSON.stringify(segredo)}: a rota nunca fica aberta`);
    await fechada.close();
  }
  assert.equal(banco.chamadas.length, 0, '401 não toca o banco');
});

test('200: 24 pontos em ordem, hora cheia em UTC, zeros nas horas sem uso, invariantes e nenhum dado pessoal', async () => {
  const banco = bancoFalso({
    total: 5,
    ativos: 3,
    porHora: { '2026-11-24T13:00:00Z': 2, '2026-11-25T11:00:00Z': 1, '2026-11-25T12:00:00Z': 3 }
  });
  const app = await montar(banco);
  const r = await app.inject({ url: ROTA_WALLPAPER, headers: comToken(SEGREDO) });
  assert.equal(r.statusCode, 200);
  assert.match(String(r.headers['content-type']), /^application\/json/);
  assert.equal(r.headers['cache-control'], 'no-store');
  const corpo = r.json();
  assert.deepEqual(Object.keys(corpo).sort(), ['ativos_24h', 'gerado_em', 'id', 'nome', 'serie_24h', 'total_usuarios']);
  assert.equal(corpo.id, 'institucional');
  assert.equal(corpo.nome, 'Site');
  assert.equal(corpo.gerado_em, '2026-11-25T12:34:56Z');
  assert.equal(corpo.total_usuarios, 5);
  assert.equal(corpo.ativos_24h, 3);

  const serie = corpo.serie_24h as { hora: string; ativos: number }[];
  assert.equal(serie.length, 24);
  assert.equal(serie[0].hora, '2026-11-24T13:00:00Z');
  assert.equal(serie[23].hora, '2026-11-25T12:00:00Z', 'o último ponto é a hora atual (parcial)');
  for (let i = 0; i < 24; i++) {
    assert.deepEqual(Object.keys(serie[i]).sort(), ['ativos', 'hora']);
    assert.match(serie[i].hora, /^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/, 'hora cheia em UTC, com Z');
    if (i > 0) assert.equal(Date.parse(serie[i].hora) - Date.parse(serie[i - 1].hora), H, 'ordem crescente, de hora em hora');
    assert.ok(Number.isInteger(serie[i].ativos) && serie[i].ativos >= 0);
    assert.ok(serie[i].ativos <= corpo.ativos_24h, 'cada ponto <= ativos_24h');
  }
  assert.ok(corpo.ativos_24h <= corpo.total_usuarios);
  assert.deepEqual(
    serie.map((p) => p.ativos),
    [2, ...Array(21).fill(0), 1, 3],
    'horas sem uso entram com 0'
  );

  // nenhum dado pessoal, mesmo com o banco devolvendo colunas a mais
  const texto = r.body;
  assert.doesNotMatch(texto, /@/);
  assert.doesNotMatch(texto, UUID);
  assert.doesNotMatch(texto, /Pessoa|email|usuario_id/i);

  // a janela consultada é a hora atual e as 23 anteriores, pelo relógio do processo
  assert.equal(banco.chamadas.length, 2);
  for (const c of banco.chamadas) assert.deepEqual(c.parametros, ['2026-11-24T13:00:00.000Z', '2026-11-25T12:00:00.000Z']);
  await app.close();
});

test('sem conta nenhuma: total 0, ativos 0 e 24 pontos zerados', async () => {
  const corpo = await calcularEstatisticas(bancoFalso(), Date.parse('2026-11-25T00:00:00.000Z'));
  assert.equal(corpo.total_usuarios, 0);
  assert.equal(corpo.ativos_24h, 0);
  assert.equal(corpo.serie_24h.length, 24);
  assert.ok(corpo.serie_24h.every((p) => p.ativos === 0));
  assert.equal(corpo.serie_24h[0].hora, '2026-11-24T01:00:00Z');
  assert.equal(corpo.serie_24h[23].hora, '2026-11-25T00:00:00Z', 'na virada exata a hora atual é a que começa agora');
});

test('cache de 60 s: chamadas seguidas não consultam o banco; passado o prazo, consulta de novo; falha não fica em cache', async () => {
  let agora = AGORA;
  const banco = bancoFalso({ total: 2, ativos: 1 });
  const app = await montar(banco, { agora: () => agora });
  const pedir = () => app.inject({ url: ROTA_WALLPAPER, headers: comToken(SEGREDO) });

  const [a, b] = await Promise.all([pedir(), pedir()]);
  assert.equal(a.statusCode, 200);
  assert.equal(b.body, a.body);
  assert.equal(banco.chamadas.length, 2, 'duas chamadas simultâneas, um cálculo só');
  agora += 59_000;
  assert.equal((await pedir()).body, a.body);
  assert.equal(banco.chamadas.length, 2, 'dentro dos 60 s, do cache');
  agora += 2_000;
  const c = await pedir();
  assert.equal(c.statusCode, 200);
  assert.equal(banco.chamadas.length, 4, 'depois dos 60 s, consulta de novo');
  assert.notEqual(c.json().gerado_em, a.json().gerado_em);
  await app.close();

  const quebrado = bancoFalso({ falhar: true });
  const app2 = await montar(quebrado);
  const r = await app2.inject({ url: ROTA_WALLPAPER, headers: comToken(SEGREDO) });
  assert.equal(r.statusCode, 503);
  assert.deepEqual(r.json(), { erro: 'indisponivel' }, 'sem detalhe do erro');
  await app2.inject({ url: ROTA_WALLPAPER, headers: comToken(SEGREDO) });
  assert.equal(quebrado.chamadas.length, 2, 'a falha não foi guardada no cache: a 2ª chamada consultou de novo');
  await app2.close();
});

test('sem log de acesso, fora do rate limit, sem CORS e sem cookie', async () => {
  const linhas: string[] = [];
  const stream = new Writable({
    write(pedaco, _enc, pronto) {
      linhas.push(String(pedaco));
      pronto();
    }
  });
  const app = Fastify({ logger: { level: 'info', stream } });
  // rate limit GLOBAL e apertado: se a rota entrasse nele, a 2ª chamada já daria 429
  await app.register(rateLimit, { global: true, max: 1, timeWindow: '1 minute' });
  rotaWallpaper(app, { banco: bancoFalso({ total: 1 }), segredo: () => SEGREDO, agora: () => AGORA });
  app.get('/outra', async () => ({ ok: true }));
  await app.ready();

  for (let i = 0; i < 5; i++) {
    const r = await app.inject({ url: ROTA_WALLPAPER, headers: { ...comToken(SEGREDO), origin: 'https://outro.exemplo.test' } });
    assert.equal(r.statusCode, 200, `chamada ${i + 1}`);
    assert.equal(r.headers['access-control-allow-origin'], undefined, 'sem CORS');
    assert.equal(r.headers['set-cookie'], undefined, 'sem sessão');
  }
  assert.equal((await app.inject({ url: ROTA_WALLPAPER })).statusCode, 401);
  await app.inject({ url: '/outra' });
  await app.close();

  assert.ok(linhas.some((l) => l.includes('/outra')), 'o logger de requisições está ligado nas outras rotas');
  assert.ok(!linhas.some((l) => l.includes('wallpaper')), 'nenhuma linha de log para a rota do painel');
});

test('registro: uma gravação por conta e hora; a lista em memória é limpa quando a hora vira', async () => {
  let agora = Date.parse('2026-11-25T12:05:00.000Z');
  const inserts: unknown[][] = [];
  const registrar = criarRegistroAtividade({
    async query(sql: string, parametros?: unknown[]) {
      assert.match(sql, /^INSERT INTO atividade_usuario_hora \(usuario_id, hora\) VALUES \(\$1, \$2\) ON CONFLICT DO NOTHING$/);
      inserts.push(parametros ?? []);
      return { rows: [] };
    }
  }, () => agora);
  const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  registrar(A);
  registrar(A);
  agora += 40 * 60_000; // 12:45, mesma hora
  registrar(A);
  assert.deepEqual(inserts, [[A, '2026-11-25T12:00:00.000Z']], 'só a primeira requisição da hora grava');
  registrar(B);
  assert.equal(inserts.length, 2, 'outra conta grava a sua');
  agora += 20 * 60_000; // 13:05
  registrar(A);
  registrar(A);
  registrar(B);
  assert.deepEqual(inserts.slice(2), [
    [A, '2026-11-25T13:00:00.000Z'],
    [B, '2026-11-25T13:00:00.000Z']
  ]);
  assert.equal(inicioDaHora(agora), Date.parse('2026-11-25T13:00:00.000Z'));
});

test('registro: fora do caminho crítico; falha do banco não lança, tenta de novo e avisa no máximo uma vez por hora', async () => {
  // consulta que nunca termina: a função volta na hora, sem promessa para a requisição esperar
  const parado = criarRegistroAtividade({ query: () => new Promise<never>(() => {}) }, () => AGORA);
  assert.equal(parado('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), undefined);

  let tentativas = 0;
  const avisos: string[] = [];
  const quebrado = criarRegistroAtividade(
    {
      async query() {
        tentativas++;
        throw new Error('relation "atividade_usuario_hora" does not exist');
      }
    },
    () => AGORA,
    (msg) => avisos.push(msg)
  );
  const A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  assert.doesNotThrow(() => quebrado(A));
  await new Promise((r) => setTimeout(r, 0));
  assert.doesNotThrow(() => quebrado(A));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(tentativas, 2, 'o par saiu da lista depois da falha: a próxima requisição tenta de novo');
  assert.equal(avisos.length, 1, 'um aviso por hora, não um por requisição');
  assert.doesNotMatch(avisos[0], UUID, 'o aviso não leva o id da conta');

  // erro síncrono do driver também não sobe
  const sincrono = criarRegistroAtividade({ query: () => { throw new Error('pool encerrado'); } }, () => AGORA, () => {});
  assert.doesNotThrow(() => sincrono(A));
});
