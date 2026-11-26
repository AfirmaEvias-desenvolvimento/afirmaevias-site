// GET /email/logo-afirma-evias.png: o logotipo que os e-mails dos sistemas (AUTH, Comercial) mostram por
// <img src="https://sae-institucional.up.railway.app/email/logo-afirma-evias.png">. Monta os estáticos e os cabeçalhos
// exatamente como o server.ts (registrarEstaticos + cabecalhosDeSeguranca), sem banco e sem sessão.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import { registrarEstaticos } from './estaticos.js';
import { cabecalhosDeSeguranca } from './cabecalhos.js';

const LOGO = '/email/logo-afirma-evias.png';
const ASSINATURA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CSP_PAGINAS =
  "default-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; form-action 'self'; " +
  "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; img-src 'self' data:; script-src 'self'";

async function app(producao: boolean) {
  const a = Fastify();
  await registrarEstaticos(a, producao);
  cabecalhosDeSeguranca(a, producao);
  a.get('/pagina', async (_req, reply) => reply.type('text/html; charset=utf-8').send('<p>pagina do site</p>'));
  return a;
}

test('GET /email/logo-afirma-evias.png: 200 image/png, sem login, cache de um ano e liberado para outra origem', async () => {
  const a = await app(true);
  try {
    // sem cookie e sem Authorization, como o proxy de imagens ou o webmail pedem
    const r = await a.inject({ method: 'GET', url: LOGO, headers: { accept: 'image/avif,image/webp,image/*,*/*;q=0.8' } });
    assert.equal(r.statusCode, 200);
    assert.equal(r.headers['content-type'], 'image/png');
    assert.match(String(r.headers['cache-control']), /^public, max-age=31536000\b/);
    assert.equal(r.headers['cross-origin-resource-policy'], 'cross-origin', 'o webmail carrega a imagem de outra origem');
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['set-cookie'], undefined);

    const png = r.rawPayload;
    assert.deepEqual([...png.subarray(0, 8)], ASSINATURA_PNG);
    assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
    assert.equal(png.readUInt32BE(16), 440, 'largura 2x, para exibir com 220 px');
    assert.ok(png.readUInt32BE(20) > 0 && png.readUInt32BE(20) < 120, `altura ${png.readUInt32BE(20)}`);
    assert.ok(png.length < 30 * 1024, `${png.length} bytes`);
    assert.deepEqual(png, fs.readFileSync(path.join(process.cwd(), 'public', 'email', 'logo-afirma-evias.png')));

    // HEAD e versão na query (para trocar o logo sem esperar o cache) também servem o arquivo
    const head = await a.inject({ method: 'HEAD', url: LOGO });
    assert.equal(head.statusCode, 200);
    assert.equal(head.headers['content-type'], 'image/png');
    const comVersao = await a.inject({ method: 'GET', url: `${LOGO}?v=2` });
    assert.equal(comVersao.statusCode, 200);
    assert.equal(comVersao.headers['cross-origin-resource-policy'], 'cross-origin');
  } finally {
    await a.close();
  }
});

test('fora da imagem de /email/ nada muda: páginas e estáticos seguem same-origin e com a mesma CSP', async () => {
  const a = await app(true);
  try {
    for (const url of ['/pagina', '/css/site.css', '/img/logo-horizontal-escuro.png']) {
      const r = await a.inject({ method: 'GET', url });
      assert.equal(r.statusCode, 200, url);
      assert.equal(r.headers['cross-origin-resource-policy'], 'same-origin', url);
      assert.equal(r.headers['content-security-policy'], CSP_PAGINAS, url);
      assert.equal(r.headers['strict-transport-security'], 'max-age=31536000; includeSubDomains', url);
    }
    // arquivo inexistente em /email/ é 404 comum, sem a exceção de origem
    const r = await a.inject({ method: 'GET', url: '/email/nao-existe.png' });
    assert.equal(r.statusCode, 404);
    assert.equal(r.headers['cross-origin-resource-policy'], 'same-origin');
  } finally {
    await a.close();
  }
});

test('em desenvolvimento a imagem também sai, sem cache', async () => {
  const a = await app(false);
  try {
    const r = await a.inject({ method: 'GET', url: LOGO });
    assert.equal(r.statusCode, 200);
    assert.equal(r.headers['content-type'], 'image/png');
    assert.match(String(r.headers['cache-control']), /max-age=0\b/);
    assert.equal(r.headers['cross-origin-resource-policy'], 'cross-origin');
    assert.equal(r.headers['strict-transport-security'], undefined);
  } finally {
    await a.close();
  }
});
