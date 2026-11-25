// Painel Infra contra um Postgres de verdade (o embutido do repositório do Comercial HS, em pasta temporária e porta livre,
// que some ao fim). PULA se esse repositório não estiver ao lado (HS_DIR). Confere, com o papel de runtime site_app:
// os privilégios da tabela nova (INSERT, SELECT e DELETE, sem UPDATE), as regras de contagem (só contas ativas, janela de
// 24 h, distintos por hora), a deduplicação (memória + ON CONFLICT), o descarte de 7 dias, a cascata ao excluir a conta,
// o registro no ponto em que a sessão é reconhecida (usuarioDaRequisicao) e o tempo das consultas.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import pg from 'pg';
import { aplicarRuntime, lerSql } from './migracao.js';
import { REGRAS } from './regras-retencao.js';
import { ROTA_WALLPAPER, calcularEstatisticas, criarRegistroAtividade, rotaWallpaper } from './wallpaper.js';

const hs = path.resolve(process.env.HS_DIR ?? path.join(process.cwd(), '..', '..', 'aevias_comercial_HS'));
const script = path.join(hs, 'scripts', 'pg-embutido.mjs');
const temPg = fs.existsSync(script) && fs.existsSync(path.join(hs, 'node_modules', 'embedded-postgres'));
const portaLivre = () =>
  new Promise<number>((resolver) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as AddressInfo).port;
      s.close(() => resolver(p));
    });
  });

const H = 3_600_000;
const SEGREDO = 'segredo-de-teste-do-painel-infra-0123456789abcdef';
const AGORA = Date.parse('2026-11-25T12:34:56.000Z');
const HORA_ATUAL = Date.parse('2026-11-25T12:00:00.000Z');

test(
  'banco real: site_app só com INSERT/SELECT/DELETE na tabela nova; contagem, deduplicação, descarte, cascata e gancho da sessão',
  { skip: !temPg, timeout: 180_000 },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-wallpaper-'));
    const { iniciarPg } = await import(pathToFileURL(script).href);
    const servidor = await iniciarPg({ dir, porta: await portaLivre(), banco: 'site_wallpaper' });
    const dono = new pg.Client({ connectionString: servidor.urls.migracao });
    await dono.connect();
    const senhaApp = 'senha-de-teste-' + Math.random().toString(36).slice(2);
    const urlApp = new URL(servidor.urls.migracao);
    urlApp.username = 'site_app';
    urlApp.password = senhaApp;
    let app: pg.Client | null = null;
    try {
      await dono.query('DROP ROLE IF EXISTS site_app');
      await dono.query(`CREATE ROLE site_app LOGIN PASSWORD '${senhaApp}'`);
      // o que o site-migrate faz: schema como o dono, depois os GRANTs (duas vezes: roda a cada deploy)
      for (let i = 0; i < 2; i++) {
        await dono.query(lerSql('schema.sql'));
        await aplicarRuntime(dono);
      }
      app = new pg.Client({ connectionString: urlApp.toString() });
      await app.connect();

      // ---------------------------------------------------------------- privilégios
      const pode = async (p: string) =>
        (await app!.query(`SELECT has_table_privilege('site_app', 'atividade_usuario_hora', $1) AS ok`, [p])).rows[0].ok;
      assert.equal(await pode('INSERT'), true);
      assert.equal(await pode('SELECT'), true);
      assert.equal(await pode('DELETE'), true);
      assert.equal(await pode('UPDATE'), false, 'sem UPDATE na tabela nova');
      await assert.rejects(app.query('UPDATE atividade_usuario_hora SET hora = hora'), /permission denied|permissão negada/);

      // ---------------------------------------------------------------- contas
      const conta = async (email: string, ativo: boolean) =>
        (
          await app!.query(`INSERT INTO admin_usuarios (nome, email, senha_hash, ativo) VALUES ('Pessoa', $1, 'x', $2) RETURNING id`, [
            email,
            ativo
          ])
        ).rows[0].id as string;
      const u1 = await conta('u1@exemplo.test', true);
      const u2 = await conta('u2@exemplo.test', true);
      const u3 = await conta('u3@exemplo.test', true);
      const inativa = await conta('inativa@exemplo.test', false);

      // registro pelo módulo, com relógio controlado e contagem dos INSERTs que chegam ao banco
      let agora = AGORA;
      let inserts = 0;
      const pendentes: Promise<unknown>[] = [];
      let fila: Promise<unknown> = Promise.resolve();
      const contando = {
        // um Client só: as gravações vão em fila (em produção é o pool)
        query: (sql: string, parametros?: unknown[]) => {
          inserts++;
          const p = fila.then(() => app!.query(sql, parametros as any[]));
          fila = p.catch(() => {});
          pendentes.push(p);
          return p;
        }
      };
      const registrar = criarRegistroAtividade(contando, () => agora);
      const esperar = async () => {
        await Promise.allSettled(pendentes.splice(0));
      };

      // u1: hora atual (3 requisições), hora anterior e 24 h atrás (fora da janela). u2: a hora mais antiga da janela.
      // a conta inativa: hora atual (não conta). u3: nenhuma atividade.
      registrar(u1);
      registrar(u1);
      registrar(u1);
      registrar(inativa);
      agora = AGORA - H;
      registrar(u1);
      agora = AGORA - 23 * H;
      registrar(u2);
      agora = AGORA - 24 * H;
      registrar(u1);
      await esperar();
      assert.equal(inserts, 5, 'uma gravação por conta e hora');

      // outro processo (memória vazia) na mesma hora: o ON CONFLICT segura a duplicata
      agora = AGORA;
      const outroProcesso = criarRegistroAtividade(contando, () => agora);
      outroProcesso(u1);
      await esperar();
      const linhasU1 = (await app.query(`SELECT count(*)::int AS n FROM atividade_usuario_hora WHERE usuario_id = $1 AND hora = $2`, [
        u1,
        new Date(HORA_ATUAL).toISOString()
      ])).rows[0].n;
      assert.equal(linhasU1, 1, 'uma linha por conta e hora, mesmo com dois processos');
      const horas = (await app.query(`SELECT DISTINCT extract(minute FROM hora)::int AS m, extract(second FROM hora)::int AS s FROM atividade_usuario_hora`)).rows;
      assert.deepEqual(horas, [{ m: 0, s: 0 }], 'hora gravada com minutos e segundos zerados');

      // ---------------------------------------------------------------- contagem
      const corpo = await calcularEstatisticas(app, AGORA);
      assert.equal(corpo.total_usuarios, 3, 'só contas ativas (a desativada fica de fora)');
      assert.equal(corpo.ativos_24h, 2, 'u1 e u2; a conta inativa e a atividade de 24 h atrás ficam de fora');
      assert.equal(corpo.serie_24h.length, 24);
      assert.equal(corpo.serie_24h[0].hora, '2026-11-24T13:00:00Z');
      assert.equal(corpo.serie_24h[23].hora, '2026-11-25T12:00:00Z');
      assert.deepEqual(
        corpo.serie_24h.map((p) => p.ativos),
        [1, ...Array(21).fill(0), 1, 1],
        'u2 na 1ª hora, u1 na penúltima e na atual (a inativa não soma)'
      );

      // pela rota, com o Bearer: mesmo resultado e nada pessoal
      const http = Fastify();
      rotaWallpaper(http, { banco: app, segredo: () => SEGREDO, agora: () => AGORA });
      const r = await http.inject({ url: ROTA_WALLPAPER, headers: { authorization: `Bearer ${SEGREDO}` } });
      assert.equal(r.statusCode, 200);
      assert.deepEqual(r.json(), corpo);
      assert.doesNotMatch(r.body, /@|Pessoa/);
      for (const id of [u1, u2, u3, inativa]) assert.ok(!r.body.includes(id), 'nenhum id de conta na resposta');
      assert.equal((await http.inject({ url: ROTA_WALLPAPER, headers: { authorization: 'Bearer errado' } })).statusCode, 401);
      await http.close();

      // ---------------------------------------------------------------- tempo (< 200 ms) com volume de uma semana cheia
      await dono.query(
        `INSERT INTO admin_usuarios (nome, email, senha_hash) SELECT 'Carga', 'carga' || g || '@exemplo.test', 'x' FROM generate_series(1, 200) g`
      );
      await dono.query(
        `INSERT INTO atividade_usuario_hora (usuario_id, hora)
         SELECT u.id, $1::timestamptz - make_interval(hours => h) FROM admin_usuarios u, generate_series(0, 167) h
          WHERE u.email LIKE 'carga%' ON CONFLICT DO NOTHING`,
        [new Date(HORA_ATUAL).toISOString()]
      );
      await dono.query('ANALYZE atividade_usuario_hora');
      let melhor = Infinity;
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        const carga = await calcularEstatisticas(app, AGORA);
        melhor = Math.min(melhor, performance.now() - t0);
        assert.equal(carga.total_usuarios, 203);
        assert.equal(carga.ativos_24h, 202);
      }
      assert.ok(melhor < 200, `consulta levou ${melhor.toFixed(1)} ms`);
      await dono.query(`DELETE FROM admin_usuarios WHERE email LIKE 'carga%'`);

      // ---------------------------------------------------------------- descarte de 7 dias (a regra da rotina de retenção)
      const regra = REGRAS.find((x) => /atividade_usuario_hora/.test(x.sql));
      assert.ok(regra, 'regra de descarte cadastrada');
      await app.query(`DELETE FROM atividade_usuario_hora`);
      await app.query(
        `INSERT INTO atividade_usuario_hora (usuario_id, hora) VALUES
           ($1, date_trunc('hour', now()) - interval '8 days'), ($1, date_trunc('hour', now()) - interval '6 days'), ($1, date_trunc('hour', now()))`,
        [u3]
      );
      const apagadas = await app.query(`${regra.sql} RETURNING 1`);
      assert.equal(apagadas.rowCount, 1, 'só a linha com mais de 7 dias sai, com o papel do runtime');
      assert.equal((await app.query(`SELECT count(*)::int AS n FROM atividade_usuario_hora`)).rows[0].n, 2);

      // ---------------------------------------------------------------- excluir a conta apaga a atividade dela
      await app.query(`DELETE FROM admin_usuarios WHERE id = $1`, [u3]);
      assert.equal((await app.query(`SELECT count(*)::int AS n FROM atividade_usuario_hora WHERE usuario_id = $1`, [u3])).rows[0].n, 0);

      // ---------------------------------------------------------------- gancho: sessão reconhecida grava a hora atual
      process.env.DATABASE_URL = urlApp.toString();
      process.env.NODE_ENV = 'development';
      const { usuarioDaRequisicao } = await import('./auth.js');
      const token = 'token-de-teste-' + Math.random().toString(36).slice(2);
      await app.query(`INSERT INTO admin_sessoes (token, usuario_id, expira_em) VALUES ($1, $2, now() + interval '1 hour')`, [token, u2]);
      const requisicao = (valor: string) => ({ cookies: { ae_sessao: 'assinado' }, unsignCookie: () => ({ valid: true, value: valor }) }) as any;
      assert.equal(await usuarioDaRequisicao(requisicao('token-inexistente')), null);
      const reconhecido = await usuarioDaRequisicao(requisicao(token));
      assert.equal(reconhecido?.id, u2);
      let gravada = 0;
      for (let i = 0; i < 50 && !gravada; i++) {
        await new Promise((r) => setTimeout(r, 40));
        gravada = (
          await app.query(`SELECT count(*)::int AS n FROM atividade_usuario_hora WHERE usuario_id = $1 AND hora = $2`, [
            u2,
            new Date(Math.floor(Date.now() / H) * H).toISOString()
          ])
        ).rows[0].n;
      }
      assert.equal(gravada, 1, 'a requisição autenticada marcou a conta na hora atual');
      // a tabela só tinha as linhas de u3, que saíram com a conta: sobra apenas a de u2 (o token inexistente não grava)
      assert.equal((await app.query(`SELECT count(*)::int AS n FROM atividade_usuario_hora`)).rows[0].n, 1);
    } finally {
      await app?.end().catch(() => {});
      const { pool } = await import('./db.js').catch(() => ({ pool: null as any }));
      await pool?.end().catch(() => {});
      await dono.query('DROP OWNED BY site_app').catch(() => {});
      await dono.end().catch(() => {});
      await servidor.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);
