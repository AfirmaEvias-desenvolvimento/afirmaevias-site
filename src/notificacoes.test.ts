import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
process.env.DATABASE_URL ??= 'postgres://fixture:fixture@127.0.0.1:1/fixture';
const { processarFilaAvisos } = await import('./notificacoes.js');

const hs = path.resolve(process.env.HS_DIR ?? path.join(process.cwd(), '..', '..', 'aevias_comercial_HS'));
const script = path.join(hs, 'scripts', 'pg-embutido.mjs');
const disponivel = fs.existsSync(script) && fs.existsSync(path.join(hs, 'node_modules', 'embedded-postgres'));
const portaLivre = () => new Promise<number>((resolve) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as AddressInfo).port; s.close(() => resolve(p)); }); });

test('fila persiste com formulário, retenta falha e entrega sem dados pessoais', { skip: !disponivel }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-avisos-'));
  const { iniciarPg } = await import(pathToFileURL(script).href);
  const server = await iniciarPg({ dir, porta: await portaLivre(), banco: 'site_avisos' });
  const banco = new pg.Pool({ connectionString: server.urls.migracao });
  const anterior = process.env.RESEND_API_KEY;
  try {
    const schema = fs.readFileSync(path.join(process.cwd(), 'db/schema.sql'), 'utf8');
    await banco.query(schema); await banco.query(schema);
    const c = await banco.connect();
    await c.query('BEGIN');
    await c.query("INSERT INTO contatos (nome,email,mensagem) VALUES ('Segredo','segredo@exemplo.test','Texto privado')");
    assert.equal((await c.query('SELECT count(*)::int n FROM avisos_email_fila')).rows[0].n, 1);
    await c.query('ROLLBACK'); c.release();
    assert.equal((await banco.query('SELECT count(*)::int n FROM avisos_email_fila')).rows[0].n, 0);
    await banco.query("INSERT INTO contatos (nome,email,mensagem) VALUES ('Segredo','segredo@exemplo.test','Texto privado')");
    process.env.RESEND_API_KEY = 'teste';
    let chave = '';
    let corpoEnviado = '';
    let chaveReenvio = '';
    await processarFilaAvisos(banco, (async (_url, init) => {
      const cab = init!.headers as Record<string, string>;
      chave = cab['Idempotency-Key'];
      corpoEnviado = String(init!.body);
      return new Response('', { status: 503 });
    }) as typeof fetch);
    assert.doesNotMatch(corpoEnviado, /Segredo|segredo@exemplo|Texto privado/);
    assert.ok(chave);
    const falha = (await banco.query('SELECT * FROM avisos_email_fila')).rows[0];
    assert.equal(falha.tentativas, 1);
    await banco.query("UPDATE avisos_email_fila SET proxima_tentativa = now() - interval '1 second'");
    await processarFilaAvisos(banco, (async (_url, init) => {
      chaveReenvio = (init!.headers as Record<string,string>)['Idempotency-Key'];
      return new Response('{}', { status: 200 });
    }) as typeof fetch);
    assert.equal(chaveReenvio, chave);
    assert.equal((await banco.query('SELECT count(*)::int n FROM avisos_email_fila')).rows[0].n, 0);
    const registro = (await banco.query("INSERT INTO contatos (nome,email,mensagem) VALUES ('X','x@example.test','X') RETURNING id")).rows[0];
    await banco.query('DELETE FROM contatos WHERE id = $1', [registro.id]);
    assert.equal((await banco.query('SELECT count(*)::int n FROM avisos_email_fila')).rows[0].n, 0);
  } finally {
    if (anterior === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = anterior;
    await banco.end(); await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
