// Perfil Railway (Fase 0): proxy de 1 salto com PUBLIC_HTTP=1, HOST, /health/live, migração com --runtime (papel
// site_app só com DML) e o comando do primeiro administrador. A parte de banco roda contra o Postgres embutido do
// repositório do Comercial HS (pasta temporária, porta livre, some ao fim) e PULA se ele não estiver ao lado (HS_DIR).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import pg from 'pg';
import { confiancaProxy, hostEscuta, publicHttp, rotasSaude } from './railway.js';
import { aplicarRuntime, lerSql, pedeRuntime } from './migracao.js';
import { conferirSenha, criarAdminInicial, lerPedido } from './admin-inicial.js';

async function ipEProtocolo(env: NodeJS.ProcessEnv, headers: Record<string, string>) {
  const app = Fastify({ trustProxy: confiancaProxy(env) });
  app.get('/eco', async (req) => ({ ip: req.ip, protocolo: req.protocol }));
  const r = await app.inject({ url: '/eco', headers, remoteAddress: '10.0.0.7' });
  await app.close();
  return r.json() as { ip: string; protocolo: string };
}

test('PUBLIC_HTTP só liga com "1"', () => {
  assert.equal(publicHttp({}), false);
  assert.equal(publicHttp({ PUBLIC_HTTP: '0' }), false);
  assert.equal(publicHttp({ PUBLIC_HTTP: 'true' }), false);
  assert.equal(publicHttp({ PUBLIC_HTTP: '1' }), true);
  assert.equal(confiancaProxy({}), true, 'sem a variável, o trustProxy de sempre');
  assert.equal(typeof confiancaProxy({ PUBLIC_HTTP: '1' }), 'function');
});

test('PUBLIC_HTTP=1: confia em exatamente 1 salto (o IP que a borda acrescenta), ignora o X-Forwarded-For forjado', async () => {
  const r = await ipEProtocolo({ PUBLIC_HTTP: '1' }, { 'x-forwarded-for': '6.6.6.6, 203.0.113.9', 'x-forwarded-proto': 'https' });
  assert.equal(r.ip, '203.0.113.9');
  assert.equal(r.protocolo, 'https');
  const direto = await ipEProtocolo({ PUBLIC_HTTP: '1' }, {});
  assert.equal(direto.ip, '10.0.0.7', 'sem cabeçalho, o par do socket');
});

test('sem PUBLIC_HTTP o comportamento local não muda (trustProxy: true, primeiro IP da cadeia)', async () => {
  const r = await ipEProtocolo({}, { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' });
  assert.equal(r.ip, '6.6.6.6');
});

test('HOST: padrão 0.0.0.0 como antes; aceita :: e 127.0.0.1', () => {
  assert.equal(hostEscuta({}), '0.0.0.0');
  assert.equal(hostEscuta({ HOST: '' }), '0.0.0.0');
  assert.equal(hostEscuta({ HOST: '::' }), '::');
  assert.equal(hostEscuta({ HOST: ' 127.0.0.1 ' }), '127.0.0.1');
});

test('/health/live não toca o banco; /health continua conferindo o banco', async () => {
  let consultas = 0;
  let falhar = false;
  const app = Fastify();
  rotasSaude(app, async () => {
    consultas++;
    if (falhar) throw new Error('banco fora');
  });
  const vivo = await app.inject('/health/live');
  assert.equal(vivo.statusCode, 200);
  assert.deepEqual(vivo.json(), { status: 'live' });
  assert.equal(vivo.headers['cache-control'], 'no-store');
  assert.equal(consultas, 0);
  const saude = await app.inject('/health');
  assert.equal(saude.statusCode, 200);
  assert.deepEqual(saude.json(), { ok: true });
  assert.equal(consultas, 1);
  falhar = true;
  assert.equal((await app.inject('/health')).statusCode, 500);
  assert.equal((await app.inject('/health/live')).statusCode, 200, 'liveness independe do banco');
  await app.close();
});

test('migração: --runtime é opt-in e os dois SQL estão no pacote', () => {
  assert.equal(pedeRuntime([]), false);
  assert.equal(pedeRuntime(['--runtime']), true);
  assert.match(lerSql('schema.sql'), /CREATE TABLE IF NOT EXISTS admin_usuarios/);
  const runtime = lerSql('runtime.sql');
  assert.match(runtime, /Papel site_app ausente/);
  assert.doesNotMatch(runtime, /PASSWORD/i, 'nenhuma senha no SQL versionado');
});

test('admin-inicial: argumentos conferidos, senha nunca por argumento', () => {
  const ok = lerPedido(['--email', 'pessoa@exemplo.test', '--nome', 'Pessoa Designada', '--designacao', 'designada pelo dono em 19/11/2026 por e-mail']);
  assert.deepEqual(ok, { email: 'pessoa@exemplo.test', nome: 'Pessoa Designada', designacao: 'designada pelo dono em 19/11/2026 por e-mail' });
  assert.throws(() => lerPedido(['--email', 'pessoa@exemplo.test', '--nome', 'P']), /--designacao/);
  assert.throws(() => lerPedido(['--email', 'x', '--nome', 'P', '--designacao', 'designação válida']), /--email/);
  assert.throws(() => lerPedido(['--senha', 'segredo123456']), /opção desconhecida/);
  assert.throws(() => lerPedido(['--email']), /sem valor/);
  assert.throws(() => conferirSenha('curta'), /10 caracteres/);
  assert.equal(conferirSenha('0123456789'), '0123456789');
});

const EMBRULHO = (comando: string) =>
  `sh -c 'umask 077 && mkdir -p /tmp/arq && for v in $(env | grep -o "^[A-Z0-9_]*_CONTEUDO=" | tr -d =); do printenv "$v" > "/tmp/arq/$v"; done && exec ${comando}'`;

test('deploy/railway: comandos com o embrulho do Apêndice B, Dockerfile fora da raiz, railway.json da raiz com build Dockerfile', () => {
  const ler = (f: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), f), 'utf8'));
  const site = ler('deploy/railway/site.json');
  const migrar = ler('deploy/railway/site-migrate.json');
  for (const j of [site, migrar]) {
    assert.equal(j.build.builder, 'DOCKERFILE');
    assert.equal(j.build.dockerfilePath, 'deploy/railway/Dockerfile');
    assert.equal(j.deploy.numReplicas, 1);
  }
  assert.equal(site.deploy.startCommand, EMBRULHO('node dist/server.js'));
  assert.equal(site.deploy.healthcheckPath, '/health/live');
  assert.equal(site.deploy.restartPolicyType, 'ON_FAILURE');
  assert.equal(migrar.deploy.startCommand, EMBRULHO('node dist/migrate.js --runtime'));
  assert.equal(migrar.deploy.restartPolicyType, 'NEVER');
  assert.equal(migrar.deploy.healthcheckPath, undefined, 'o migrate termina: healthcheck o derrubaria');

  const dockerfile = fs.readFileSync(path.join(process.cwd(), 'deploy/railway/Dockerfile'), 'utf8');
  for (const trecho of ['USER node', 'COPY db db', 'COPY public public', 'COPY contracts/vendor contracts/vendor', 'CMD ["node", "dist/server.js"]', 'printenv'])
    assert.ok(dockerfile.includes(trecho), `Dockerfile sem: ${trecho}`);
  assert.equal(fs.existsSync(path.join(process.cwd(), 'Dockerfile')), false, 'sem Dockerfile na raiz');
  // A Railway aplica o build do railway.json da raiz a TODO serviço do repositório (o painel não o sobrepõe): Dockerfile para todos.
  // O deploy segue o do projeto antigo; nos serviços novos o start command do painel (embrulho) prevalece.
  const antigo = ler('railway.json');
  assert.equal(antigo.build.builder, 'DOCKERFILE');
  assert.equal(antigo.build.dockerfilePath, 'deploy/railway/Dockerfile');
  assert.equal(antigo.build.buildCommand, undefined, 'o build é o do Dockerfile');
  assert.equal(antigo.deploy.startCommand, 'npm run migrate && npm start');
});

// ---------------------------------------------------------------- banco real (Postgres embutido)
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

test('banco real: migrate --runtime dá ao site_app só DML, e o site funciona com ele', { skip: !temPg }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-railway-'));
  const { iniciarPg } = await import(pathToFileURL(script).href);
  const servidor = await iniciarPg({ dir, porta: await portaLivre(), banco: 'site_railway' });
  const dono = new pg.Client({ connectionString: servidor.urls.migracao });
  await dono.connect();
  const senhaApp = 'senha-de-teste-' + Math.random().toString(36).slice(2);
  const urlApp = new URL(servidor.urls.migracao);
  urlApp.username = 'site_app';
  urlApp.password = senhaApp;
  const migrar = (...args: string[]) =>
    spawnSync(process.execPath, ['--import', 'tsx', 'src/migrate.ts', ...args], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: servidor.urls.migracao, NODE_ENV: 'development', ADMIN_EMAIL: '', ADMIN_PASSWORD: '', NODE_OPTIONS: '' }
    });
  let app: pg.Client | null = null;
  try {
    await dono.query('DROP ROLE IF EXISTS site_app');

    // sem o papel: migrate --runtime falha com a mensagem certa (o schema em si é do dono e pode ficar aplicado)
    const semPapel = migrar('--runtime');
    assert.equal(semPapel.status, 1);
    assert.match(semPapel.stderr, /Papel site_app ausente/);
    assert.doesNotMatch(semPapel.stderr + semPapel.stdout, new RegExp(new URL(servidor.urls.migracao).password), 'senha do dono fora do log');

    // papel com privilégio demais é recusado
    await dono.query(`CREATE ROLE site_app LOGIN CREATEDB PASSWORD '${senhaApp}'`);
    await assert.rejects(aplicarRuntime(dono), /privilégio demais/);
    await dono.query('ALTER ROLE site_app NOCREATEDB NOSUPERUSER NOCREATEROLE NOREPLICATION NOBYPASSRLS');

    // o comando da imagem, duas vezes (roda a cada deploy)
    for (let i = 0; i < 2; i++) {
      const r = migrar('--runtime');
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /schema aplicado/);
      assert.match(r.stdout, /privilegios do site_app aplicados/);
    }
    // sem --runtime a migração é a de sempre (o ecossistema local)
    const local = migrar();
    assert.equal(local.status, 0, local.stderr);
    assert.doesNotMatch(local.stdout, /site_app/);

    app = new pg.Client({ connectionString: urlApp.toString() });
    await app.connect();

    // sem DDL
    await assert.rejects(app.query('CREATE TABLE invasora (id int)'), /permission denied|permissão negada/);
    await assert.rejects(app.query('ALTER TABLE contatos ADD COLUMN x int'), /must be owner|dono/);
    await assert.rejects(app.query('DROP TABLE contatos'), /must be owner|dono/);
    const [{ owner }] = (await app.query(`SELECT count(*)::int AS owner FROM pg_tables WHERE schemaname='public' AND tableowner='site_app'`)).rows;
    assert.equal(owner, 0);

    // DML do runtime: formulário (com gatilhos do feed e BIGSERIAL), painel, exclusão
    const { rows: [contato] } = await app.query(
      `INSERT INTO contatos (nome, email, mensagem, consentimento) VALUES ('Pessoa', 'p@exemplo.test', 'Mensagem de teste', TRUE) RETURNING id`
    );
    await app.query(`UPDATE contatos SET status = 'respondido' WHERE id = $1`, [contato.id]);
    await app.query(
      `INSERT INTO candidaturas (nome, email, area, arquivo_nome, arquivo_tipo, arquivo_dados, consentimento) VALUES ('Pessoa', 'p@exemplo.test', 'Laboratório', 'cv.pdf', 'application/pdf', '\\x25504446', TRUE)`
    );
    assert.ok((await app.query('SELECT count(*)::int AS n FROM integracao_stream')).rows[0].n >= 1, 'gatilho do feed gravou com o site_app');
    await app.query('DELETE FROM contatos WHERE id = $1', [contato.id]);

    // o que o processo faz ao subir e de hora em hora, com o papel restrito
    process.env.DATABASE_URL = urlApp.toString();
    process.env.NODE_ENV = 'development';
    const { pool: poolApp } = await import('./db.js');
    const { publicarConfiguracao } = await import('./integracao-produtor.js');
    await publicarConfiguracao(poolApp, '2026-11-06', ['Laboratório']);
    const { aplicarRetencao } = await import('./retencao.js');
    await aplicarRetencao();
    const { limparSessoesExpiradas } = await import('./auth.js');
    await limparSessoesExpiradas();

    // primeiro admin pelo comando, com o papel do runtime; o segundo é recusado
    const hash = async (s: string) => `hash-de-teste:${s.length}`;
    const pedido = { email: 'designada@exemplo.test', nome: 'Pessoa Designada', designacao: 'designada pelo dono (teste)' };
    const id = await criarAdminInicial(app as any, pedido, '0123456789', hash);
    const [criado] = (await app.query('SELECT papel, ativo, senha_hash FROM admin_usuarios WHERE id = $1', [id])).rows;
    assert.deepEqual(criado, { papel: 'admin', ativo: true, senha_hash: 'hash-de-teste:10' });
    const [trilha] = (await app.query(`SELECT acao, detalhes FROM auditoria WHERE entidade_id = $1`, [id])).rows;
    assert.equal(trilha.acao, 'usuario.criado');
    assert.equal(trilha.detalhes.designacao, pedido.designacao);
    assert.equal(JSON.stringify(trilha.detalhes).includes('0123456789'), false, 'senha fora da trilha');
    await assert.rejects(criarAdminInicial(app as any, { ...pedido, email: 'outra@exemplo.test' }, '0123456789', hash), /Já existe administrador ativo/);
    assert.equal((await app.query(`SELECT count(*)::int AS n FROM admin_usuarios`)).rows[0].n, 1, 'a recusa não deixou nada');
  } finally {
    await app?.end().catch(() => {});
    const { pool } = await import('./db.js').catch(() => ({ pool: null as any }));
    await pool?.end().catch(() => {});
    await dono.query('DROP OWNED BY site_app').catch(() => {});
    await dono.end().catch(() => {});
    await servidor.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
