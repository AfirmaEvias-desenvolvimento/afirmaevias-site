// Módulo de e-mail (src/email.ts) contra uma API do Resend FALSA em 127.0.0.1: o SDK real monta e manda a requisição,
// nada sai para a internet e nenhuma chave real é usada.
import { afterEach, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { configuracaoEmail, enviarEmail, semSegredos } from './email.js';

const CHAVE = 're_teste_ChaveFalsa_0123456789';
const REMETENTE = 'SAE <sae@afirmaevias.com.br>';
type Pedido = { metodo: string; url: string; cabecalhos: http.IncomingHttpHeaders; corpo: any };

async function apiFalsa(responder: (pedido: Pedido, res: http.ServerResponse) => void) {
  const pedidos: Pedido[] = [];
  const servidor = http.createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on('data', (p: Buffer) => partes.push(p));
    req.on('end', () => {
      const texto = Buffer.concat(partes).toString();
      const pedido = { metodo: req.method ?? '', url: req.url ?? '', cabecalhos: req.headers, corpo: texto ? JSON.parse(texto) : null };
      pedidos.push(pedido);
      responder(pedido, res);
    });
  });
  await new Promise<void>((pronto) => servidor.listen(0, '127.0.0.1', pronto));
  const { port } = servidor.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    pedidos,
    fechar: () => new Promise<void>((fim) => { servidor.closeAllConnections(); servidor.close(() => fim()); })
  };
}
const json = (res: http.ServerResponse, status: number, corpo: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(corpo));
};

let anterior: Record<string, string | undefined>;
let logs: string[];
beforeEach(() => {
  anterior = { RESEND_API_KEY: process.env.RESEND_API_KEY, EMAIL_FROM: process.env.EMAIL_FROM };
  process.env.RESEND_API_KEY = CHAVE;
  process.env.EMAIL_FROM = REMETENTE;
  logs = [];
  for (const nivel of ['error', 'warn', 'log', 'info'] as const) {
    vi.spyOn(console, nivel).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); });
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const [nome, valor] of Object.entries(anterior)) if (valor === undefined) delete process.env[nome]; else process.env[nome] = valor;
});

test('sem RESEND_API_KEY ou EMAIL_FROM nada sai: resultado nao_configurado com os nomes que faltam', async () => {
  const api = await apiFalsa((_p, res) => json(res, 200, { id: 'nao-devia' }));
  try {
    const msg = { para: 'a@exemplo.test', assunto: 'x', texto: 'x' };
    delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM;
    assert.deepEqual(await enviarEmail(msg, { baseUrl: api.baseUrl }), { ok: false, motivo: 'nao_configurado', faltando: ['RESEND_API_KEY', 'EMAIL_FROM'] });
    process.env.RESEND_API_KEY = CHAVE; process.env.EMAIL_FROM = '   ';
    assert.deepEqual(await enviarEmail(msg, { baseUrl: api.baseUrl }), { ok: false, motivo: 'nao_configurado', faltando: ['EMAIL_FROM'] });
    process.env.RESEND_API_KEY = ''; process.env.EMAIL_FROM = REMETENTE;
    assert.deepEqual(await enviarEmail(msg, { baseUrl: api.baseUrl }), { ok: false, motivo: 'nao_configurado', faltando: ['RESEND_API_KEY'] });
    assert.equal(api.pedidos.length, 0);
    assert.deepEqual(configuracaoEmail({ RESEND_API_KEY: CHAVE, EMAIL_FROM: REMETENTE }), { configurado: true, faltando: [] });
    assert.doesNotMatch(JSON.stringify(configuracaoEmail()), new RegExp(CHAVE), 'a configuração nunca devolve a chave');
  } finally { await api.fechar(); }
});

test('envia pelo SDK: remetente só EMAIL_FROM, chave no Authorization, Idempotency-Key, corpo, responder-para e anexo', async () => {
  const api = await apiFalsa((_p, res) => json(res, 200, { id: 'msg_123' }));
  try {
    const r = await enviarEmail({
      para: ['a@exemplo.test', 'b@exemplo.test'], assunto: 'Assunto', html: '<p>oi</p>', texto: 'oi',
      responderPara: 'r@exemplo.test', anexos: [{ nome: 'a.txt', conteudo: Buffer.from('conteúdo'), tipo: 'text/plain' }]
    }, { baseUrl: api.baseUrl, idempotencia: 'site-aviso/1' });
    assert.deepEqual(r, { ok: true, id: 'msg_123' });
    assert.equal(api.pedidos.length, 1);
    const [p] = api.pedidos;
    assert.equal(p.metodo, 'POST');
    assert.equal(p.url, '/emails');
    assert.equal(p.cabecalhos.authorization, `Bearer ${CHAVE}`);
    assert.equal(p.cabecalhos['idempotency-key'], 'site-aviso/1');
    assert.equal(p.corpo.from, REMETENTE);
    assert.deepEqual(p.corpo.to, ['a@exemplo.test', 'b@exemplo.test']);
    assert.equal(p.corpo.subject, 'Assunto');
    assert.equal(p.corpo.html, '<p>oi</p>');
    assert.equal(p.corpo.text, 'oi');
    assert.equal(p.corpo.reply_to, 'r@exemplo.test');
    assert.equal(p.corpo.attachments[0].filename, 'a.txt');
    assert.equal(p.corpo.attachments[0].content_type, 'text/plain');
    assert.equal(Buffer.from(p.corpo.attachments[0].content, 'base64').toString(), 'conteúdo');
    assert.deepEqual(logs, []);
    // sem idempotência, nenhum Idempotency-Key; o remetente segue o EMAIL_FROM do momento
    process.env.EMAIL_FROM = 'Outro <outro@afirmaevias.com.br>';
    await enviarEmail({ para: 'a@exemplo.test', assunto: 'x', texto: 'x' }, { baseUrl: api.baseUrl });
    assert.equal(api.pedidos[1].cabecalhos['idempotency-key'], undefined);
    assert.equal(api.pedidos[1].corpo.from, 'Outro <outro@afirmaevias.com.br>');
  } finally { await api.fechar(); }
});

test('erro devolvido pelo Resend ({ data, error }) vira resultado e log, sem a chave nem o Authorization', async () => {
  const api = await apiFalsa((_p, res) => json(res, 422, {
    statusCode: 422, name: 'validation_error', message: `Invalid from field (${CHAVE}). Authorization: Bearer ${CHAVE}`
  }));
  try {
    const r = await enviarEmail({ para: 'a@exemplo.test', assunto: 'x', html: '<p>x</p>' }, { baseUrl: api.baseUrl, ref: 'teste:1' });
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.motivo === 'erro_resend');
    assert.equal(r.erro.nome, 'validation_error');
    assert.equal(r.erro.status, 422);
    assert.match(r.erro.mensagem, /^Invalid from field/);
    assert.equal(logs.length, 1);
    const log = JSON.parse(logs[0]);
    assert.equal(log.codigo, 'email_falhou');
    assert.equal(log.ref, 'teste:1');
    assert.equal(log.erro, 'validation_error');
    assert.equal(log.status, 422);
    const tudo = JSON.stringify(r) + logs.join('\n');
    assert.ok(!tudo.includes(CHAVE), 'a chave não aparece no resultado nem no log');
    assert.doesNotMatch(tudo, /authorization|bearer/i);
  } finally { await api.fechar(); }
});

test('API fora do ar e falta de resposta viram erro (sem exceção), e o tempo esgotado é dito como tal', async () => {
  const fora = await enviarEmail({ para: 'a@exemplo.test', assunto: 'x', texto: 'x' }, { baseUrl: 'http://127.0.0.1:1' });
  assert.ok(!fora.ok && fora.motivo === 'erro_resend');
  assert.equal(fora.erro.nome, 'application_error');
  assert.equal(fora.erro.status, null);
  const mudo = await apiFalsa(() => { /* nunca responde */ });
  try {
    const lento = await enviarEmail({ para: 'a@exemplo.test', assunto: 'x', texto: 'x' }, { baseUrl: mudo.baseUrl, tempoLimiteMs: 300 });
    assert.ok(!lento.ok && lento.motivo === 'erro_resend');
    assert.equal(lento.erro.nome, 'tempo_esgotado');
  } finally { await mudo.fechar(); }
  assert.equal(logs.length, 2);
  assert.ok(!logs.join('\n').includes(CHAVE));
});

test('semSegredos tira a chave, o Authorization, o Bearer e qualquer re_…', () => {
  const limpo = semSegredos(`a ${CHAVE} b Authorization: Bearer xyz c bearer abc d re_OutraChave99 e`, CHAVE);
  assert.ok(!limpo.includes(CHAVE));
  assert.doesNotMatch(limpo, /authorization|bearer|xyz|abc|re_OutraChave99/i);
  assert.ok(semSegredos('x'.repeat(1000), CHAVE).length <= 300);
});

test('um só módulo envia e-mail: só src/email.ts usa o SDK; sem SMTP, nodemailer, chamada crua à API nem remetente fixo', () => {
  const raiz = process.cwd();
  const arquivos = (pasta: string): string[] => fs.readdirSync(path.join(raiz, pasta), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(pasta, e.name);
    return e.isDirectory() ? arquivos(rel) : /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [rel] : [];
  });
  const codigo = arquivos('src');
  const comSdk = codigo.filter((a) => /from\s+['"]resend['"]/.test(fs.readFileSync(path.join(raiz, a), 'utf8')));
  assert.deepEqual(comSdk, [path.join('src', 'email.ts')]);
  for (const a of codigo) {
    const texto = fs.readFileSync(path.join(raiz, a), 'utf8');
    assert.doesNotMatch(texto, /nodemailer|smtp|kinghost|api\.resend\.com|EMAIL_REMETENTE/i, a);
    if (a !== path.join('src', 'email.ts')) assert.doesNotMatch(texto, /\bfrom:\s*[`'"]/, `${a} define remetente`);
  }
  const pacote = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8'));
  assert.match(pacote.dependencies.resend, /^\d+\.\d+\.\d+$/, 'versão exata do SDK');
  assert.equal(pacote.dependencies.nodemailer, undefined);
  const exemplo = fs.readFileSync(path.join(raiz, '.env.example'), 'utf8');
  assert.match(exemplo, /^RESEND_API_KEY=\r?$/m);
  assert.match(exemplo, /^EMAIL_FROM=\r?$/m);
  assert.doesNotMatch(exemplo, /SMTP_|MAIL_HOST|EMAIL_REMETENTE/);
});
