// Página 404 renderizada de verdade (mesmas views e mesmo contexto padrão do server.ts). Em produção, GET /admin/<inexistente>
// e OPTIONS /admin/login caíam no layout do painel sem `rotaAtual` e davam 500 (ReferenceError no topo.ejs) em vez de 404.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import path from 'node:path';
import Fastify from 'fastify';
import view from '@fastify/view';
import ejs from 'ejs';
process.env.DATABASE_URL ??= 'postgres://sem-uso:sem-uso@127.0.0.1:1/sem-uso'; // config.ts exige a variável; nada conecta
const { config } = await import('./config.js');
const conteudo = await import('./content.js');
const { asset } = await import('./assets.js');
const { dadosEstruturados } = await import('./seo.js');
const { linhasDeTitulo } = await import('./utils.js');
const { naoEncontrado } = await import('./nao-encontrado.js');

async function app() {
  const a = Fastify();
  await a.register(view, {
    engine: { ejs },
    root: path.resolve(process.cwd(), 'src/views'),
    viewExt: 'ejs',
    defaultContext: {
      siteUrl: config.siteUrl,
      portalClienteUrl: config.portalClienteUrl,
      navegacao: conteudo.navegacao,
      empresa: conteudo.empresa,
      cookiesCategorias: conteudo.cookies.categorias,
      heroiPorRota: conteudo.heroiPorRota,
      asset,
      dadosEstruturados,
      linhas: linhasDeTitulo
    }
  });
  a.setNotFoundHandler(naoEncontrado);
  // como no server.ts: erro ao renderizar vira 500 (lá, a página pages/erro)
  a.setErrorHandler((_erro, _req, reply) => reply.code(500).type('text/plain').send('erro interno'));
  return a;
}

test('rota inexistente do painel devolve 404 com a página do painel, sem sessão e sem 500', async () => {
  const a = await app();
  try {
    for (const url of ['/admin/contatos', '/admin/qualquer/coisa']) {
      const r = await a.inject({ method: 'GET', url });
      assert.equal(r.statusCode, 404, `${url}: ${r.body.slice(0, 200)}`);
      assert.match(r.body, /Essa tela não existe/);
      assert.doesNotMatch(r.body, /action="\/admin\/sair"/, 'sem usuário, sem o formulário de sair');
    }
  } finally {
    await a.close();
  }
});

test('OPTIONS (preflight CORS) em rota do painel devolve 404, sem 500 e sem Access-Control-*', async () => {
  const a = await app();
  try {
    const r = await a.inject({
      method: 'OPTIONS',
      url: '/admin/login',
      headers: { origin: 'https://origem-estranha.example', 'access-control-request-method': 'POST' }
    });
    assert.equal(r.statusCode, 404);
    assert.match(r.body, /Essa tela não existe/);
    assert.equal(r.headers['access-control-allow-origin'], undefined);
  } finally {
    await a.close();
  }
});

test('rota inexistente do site devolve a 404 pública', async () => {
  const a = await app();
  try {
    const r = await a.inject({ method: 'GET', url: '/nao-existe' });
    assert.equal(r.statusCode, 404);
    assert.match(r.headers['content-type'] as string, /text\/html/);
  } finally {
    await a.close();
  }
});
