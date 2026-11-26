import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import type { EnviarEmail } from './email.js';
process.env.DATABASE_URL ??= 'postgres://fixture:fixture@127.0.0.1:1/fixture';
const { processarFilaAvisos } = await import('./notificacoes.js');

const hs = path.resolve(process.env.HS_DIR ?? path.join(process.cwd(), '..', '..', 'aevias_comercial_HS'));
const script = path.join(hs, 'scripts', 'pg-embutido.mjs');
const disponivel = fs.existsSync(script) && fs.existsSync(path.join(hs, 'node_modules', 'embedded-postgres'));
const portaLivre = () => new Promise<number>((resolve) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as AddressInfo).port; s.close(() => resolve(p)); }); });

test('fila persiste com formulário, espera sem RESEND_API_KEY/EMAIL_FROM, retenta falha e entrega sem dados pessoais', { skip: !disponivel }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-avisos-'));
  const { iniciarPg } = await import(pathToFileURL(script).href);
  const server = await iniciarPg({ dir, porta: await portaLivre(), banco: 'site_avisos' });
  const banco = new pg.Pool({ connectionString: server.urls.migracao });
  const anterior = { chave: process.env.RESEND_API_KEY, remetente: process.env.EMAIL_FROM };
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
    // Sem configuração completa (chave sem EMAIL_FROM, ou nada) o aviso não sai e continua na fila, intacto.
    let chamadas = 0;
    const contar: EnviarEmail = async () => { chamadas++; return { ok: true, id: 'nao-devia' }; };
    delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM;
    await processarFilaAvisos(banco, contar);
    process.env.RESEND_API_KEY = 'teste';
    await processarFilaAvisos(banco, contar);
    assert.equal(chamadas, 0);
    const parada = (await banco.query('SELECT tentativas, reserva FROM avisos_email_fila')).rows;
    assert.equal(parada.length, 1);
    assert.equal(parada[0].tentativas, 0);
    assert.equal(parada[0].reserva, null);
    process.env.EMAIL_FROM = 'SAE <sae@afirmaevias.com.br>';
    let chave = '';
    let corpoEnviado = '';
    let chaveReenvio = '';
    await processarFilaAvisos(banco, async (mensagem, opcoes) => {
      chave = opcoes?.idempotencia ?? '';
      corpoEnviado = JSON.stringify(mensagem);
      return { ok: false, motivo: 'erro_resend', erro: { nome: 'internal_server_error', status: 503, mensagem: 'indisponível' } };
    });
    assert.doesNotMatch(corpoEnviado, /Segredo|segredo@exemplo|Texto privado/);
    assert.doesNotMatch(corpoEnviado, /"from"|sae@/, 'o remetente é só o EMAIL_FROM, posto pelo módulo de e-mail');
    assert.match(corpoEnviado, /comercial@afirmaevias\.com\.br/);
    assert.match(chave, /^site-aviso\//);
    const falha = (await banco.query('SELECT * FROM avisos_email_fila')).rows[0];
    assert.equal(falha.tentativas, 1);
    await banco.query("UPDATE avisos_email_fila SET proxima_tentativa = now() - interval '1 second'");
    await processarFilaAvisos(banco, async (_mensagem, opcoes) => {
      chaveReenvio = opcoes?.idempotencia ?? '';
      return { ok: true, id: 'id-do-resend' };
    });
    assert.equal(chaveReenvio, chave);
    assert.equal((await banco.query('SELECT count(*)::int n FROM avisos_email_fila')).rows[0].n, 0);
    const registro = (await banco.query("INSERT INTO contatos (nome,email,mensagem) VALUES ('X','x@example.test','X') RETURNING id")).rows[0];
    await banco.query('DELETE FROM contatos WHERE id = $1', [registro.id]);
    assert.equal((await banco.query('SELECT count(*)::int n FROM avisos_email_fila')).rows[0].n, 0);
  } finally {
    if (anterior.chave === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = anterior.chave;
    if (anterior.remetente === undefined) delete process.env.EMAIL_FROM; else process.env.EMAIL_FROM = anterior.remetente;
    await banco.end(); await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
