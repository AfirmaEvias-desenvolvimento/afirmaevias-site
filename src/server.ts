import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import compress from '@fastify/compress';
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
import { confiancaProxy, hostEscuta, rotasSaude } from './railway.js';
import { rotaWallpaper } from './wallpaper.js';
import { rotasSite } from './routes/site.js';
import { rotasFormularios } from './routes/forms.js';
import { rotasAdmin } from './routes/admin.js';
import { naoEncontrado } from './nao-encontrado.js';
import { registrarEstaticos } from './estaticos.js';
import { cabecalhosDeSeguranca } from './cabecalhos.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));

// local: true (borda TLS em 127.0.0.1); PUBLIC_HTTP=1 (Railway): TRUST_PROXY_HOPS saltos, padrão 2 (src/railway.ts).
// TRUST_PROXY_HOPS fora de 1 a 3 impede a partida, com a mensagem no log.
let trustProxy: ReturnType<typeof confiancaProxy>;
try {
  trustProxy = confiancaProxy();
} catch (erro) {
  console.error(`[erro] ${(erro as Error).message}`);
  process.exit(1);
}

const app = Fastify({
  logger: producao ? true : { transport: undefined },
  trustProxy,
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

// public/ sem sessão (365 dias de cache em produção), inclusive public/email/logo-afirma-evias.png dos e-mails dos sistemas
await registrarEstaticos(app, producao);

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

// nosniff, X-Frame-Options, COOP/CORP, CSP e HSTS (src/cabecalhos.ts); só as imagens de /email/ saem com CORP cross-origin
cabecalhosDeSeguranca(app, producao);

// /health/live (processo de pé, healthcheck da Railway) e /health (confere o banco, como sempre)
rotasSaude(app, () => pool.query('SELECT 1'));

// Painel Infra: GET /api/wallpaper/usuarios, só números, Bearer WALLPAPER_STATS_TOKEN, sem rate limit e sem log de acesso
rotaWallpaper(app, { banco: pool });

await app.register(rotasSite);
await app.register(rotasFormularios);
await app.register(rotasAdmin, { prefix: '/admin' });

app.setNotFoundHandler(naoEncontrado);

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
  const host = hostEscuta();
  await app.listen({ port: config.porta, host });
  console.log(`site no ar em http://${host.includes(':') ? `[${host}]` : host}:${config.porta}`);
} catch (erro) {
  app.log.error(erro);
  process.exit(1);
}
