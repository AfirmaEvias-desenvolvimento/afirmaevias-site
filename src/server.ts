import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import compress from '@fastify/compress';
import estatico from '@fastify/static';
import view from '@fastify/view';
import rateLimit from '@fastify/rate-limit';
import ejs from 'ejs';
import { config, producao } from './config.js';
import * as conteudo from './content.js';
import { pool } from './db.js';
import { limparSessoesExpiradas } from './auth.js';
import { aplicarRetencao } from './retencao.js';
import { iniciarFilaComercial } from './comercial-fila.js';
import { iniciarFilaAvisos } from './notificacoes.js';
import { iniciarIntegracao } from './integracao-servidor.js';
import { asset } from './assets.js';
import { dadosEstruturados } from './seo.js';
import { linhasDeTitulo } from './utils.js';
import { rotasSite } from './routes/site.js';
import { rotasFormularios } from './routes/forms.js';
import { rotasAdmin } from './routes/admin.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));

const app = Fastify({
  logger: producao ? true : { transport: undefined },
  trustProxy: true,
  bodyLimit: config.uploadMaximoBytes + 1024 * 512
});

await app.register(cookie, { secret: config.sessionSecret });
await app.register(formbody);
// texto ia sem compressao nenhuma: o CSS cai de 43 KB para 8 KB em brotli
await app.register(compress, { encodings: ['br', 'gzip'], threshold: 1024 });
await app.register(multipart, { limits: { fileSize: config.uploadMaximoBytes, files: 1 } });
// O plugin responde 429 sozinho, sem passar pelo setErrorHandler, entao a
// pagina de erro do site nao chega a ser renderizada aqui - o corpo e JSON.
// O que da para fazer e devolver uma mensagem util e em portugues: o campo
// pronto do plugin traz o tempo formatado em ingles ("9 minutes"), por isso a
// espera e calculada a partir do ttl, que vem em milissegundos.
await app.register(rateLimit, {
  global: false,
  max: 20,
  timeWindow: '10 minutes',
  errorResponseBuilder: (_req, contexto) => {
    const minutos = Math.max(1, Math.ceil((contexto.ttl ?? 0) / 60000));
    return {
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Muitas tentativas em pouco tempo. Tente de novo em ${minutos} minuto${minutos > 1 ? 's' : ''}.`
    };
  }
});

await app.register(estatico, {
  root: path.resolve(aqui, '../public'),
  prefix: '/',
  maxAge: producao ? '365d' : 0
});

await app.register(view, {
  engine: { ejs },
  root: path.resolve(aqui, 'views'),
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

app.addHook('onSend', async (req, reply, payload) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'SAMEORIGIN');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  // isolamento entre origens: impede que outra pagina abra esta em popup e
  // mantenha referencia ao window, e que terceiros embutam nossos recursos
  reply.header('Cross-Origin-Opener-Policy', 'same-origin');
  reply.header('Cross-Origin-Resource-Policy', 'same-origin');
  // O site nao usa CDN, fonte externa nem analytics: da para fechar tudo.
  // Nenhum atributo style sobrou nos templates, entao style-src pode ficar em
  // 'self' puro: sem 'unsafe-inline' o navegador recusa qualquer estilo que um
  // XSS tentasse injetar. Uma rota abre excecao para o player de video e recebe
  // politica propria, em vez de afrouxar o cabecalho de todas as paginas.
  const base =
    "default-src 'self'; style-src 'self'; " +
    "font-src 'self'; connect-src 'self'; form-action 'self'; " +
    "frame-ancestors 'self'; base-uri 'self'; object-src 'none'";
  const comVideo = req.url.startsWith('/bruno_magalhaes');
  reply.header(
    'Content-Security-Policy',
    comVideo
      ? `${base}; script-src 'self' https://www.youtube.com https://s.ytimg.com; ` +
        "img-src 'self' data: https://i.ytimg.com; " +
        'frame-src https://www.youtube.com https://www.youtube-nocookie.com'
      : `${base}; img-src 'self' data:; script-src 'self'`
  );
  if (producao) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return payload;
});

app.get('/health', async (_req, reply) => {
  await pool.query('SELECT 1');
  reply.header('Cache-Control', 'no-store');
  return { ok: true };
});

await app.register(rotasSite);
await app.register(rotasFormularios);
await app.register(rotasAdmin, { prefix: '/admin' });

app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/admin')) {
    return reply.code(404).view('admin/404', { titulo: 'Página não encontrada', usuario: null });
  }
  return reply.code(404).view('pages/404', {
    titulo: 'Página não encontrada',
    descricao: 'O endereço que você acessou não existe.',
    rotaAtual: '',
    naoIndexar: true
  });
});

app.setErrorHandler((erro: any, request, reply) => {
  request.log.error(erro);
  const status = erro?.statusCode && erro.statusCode < 500 ? erro.statusCode : 500;
  const conhecidos: Record<number, string> = {
    413: 'O arquivo enviado passou do tamanho permitido.',
    400: 'Os dados enviados não foram aceitos. Confira o formulário e tente de novo.'
  };
  // A pagina dizia "quebrou do nosso lado" para tudo, inclusive 400 e 413, que
  // sao dado que o visitante mandou. Culpar o servidor por isso confunde quem
  // esta tentando corrigir o proprio envio.
  const nossoLado = status >= 500;
  return reply.code(status).view('pages/erro', {
    titulo: nossoLado ? 'Algo quebrou aqui' : 'Não deu para seguir',
    descricao: 'Tivemos um problema ao carregar esta página.',
    rotaAtual: '',
    naoIndexar: true,
    cabecalho: nossoLado ? 'Algo quebrou<br>aqui do nosso lado.' : 'Não deu<br>para seguir.',
    ajuda: nossoLado,
    // erro.message de um 4xx desconhecido pode carregar detalhe interno de
    // plugin ou de validacao; nao e informacao para o visitante
    mensagem: conhecidos[status] ?? (nossoLado ? 'Erro interno do servidor.' : 'A requisição não pôde ser atendida.')
  });
});

setInterval(() => {
  limparSessoesExpiradas().catch(() => {});
}, 60 * 60 * 1000).unref();

// descarte pelos prazos da politica: uma vez por dia, e uma vez ao subir
setInterval(() => {
  aplicarRetencao().catch(() => {});
}, 24 * 60 * 60 * 1000).unref();
aplicarRetencao().catch(() => {});

// Conexão 1 (Institucional → Comercial): reenvia os leads pendentes. Não faz nada sem COMERCIAL_API_URL.
iniciarFilaComercial();
iniciarFilaAvisos();

// Feed do produtor 'institucional' para o RH (changes/snapshots/reconciliation por mTLS). Não faz nada sem INTEGRACAO_PORT.
await iniciarIntegracao(pool, { chaveCursorPadrao: config.sessionSecret, versaoPolitica: config.versaoPolitica, areas: conteudo.vagas.areas });

// O Railway manda SIGTERM a cada redeploy. Sem tratar, a requisicao que estava
// no meio do caminho e cortada e o pool do Postgres morre com o processo, sem
// devolver as conexoes. Quem estivesse enviando um formulario nesse instante
// veria erro de rede em vez de resposta.
//
// app.close() para de aceitar conexao nova e espera as que estao em andamento;
// so depois o pool fecha. O prazo existe porque encerramento pendurado e pior
// que encerramento abrupto: o Railway mata o processo de qualquer forma e o
// deploy fica travado esperando.
let encerrando = false;

async function encerrar(sinal: string) {
  if (encerrando) return;
  encerrando = true;
  app.log.info(`${sinal} recebido: encerrando`);

  const prazo = setTimeout(() => {
    app.log.error('encerramento passou de 10s, saindo a forca');
    process.exit(1);
  }, 10_000);
  prazo.unref();

  try {
    await app.close();
    await pool.end();
    clearTimeout(prazo);
    process.exit(0);
  } catch (erro) {
    app.log.error(erro);
    process.exit(1);
  }
}

for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sinal, () => void encerrar(sinal));
}

try {
  await app.listen({ port: config.porta, host: process.env.HOST ?? '0.0.0.0' });
  console.log(`site no ar em http://${process.env.HOST ?? '0.0.0.0'}:${config.porta}`);
} catch (erro) {
  app.log.error(erro);
  process.exit(1);
}
