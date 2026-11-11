// Listener de SERVIÇO do site (lado produtor do feed do RH, origem 'institucional'): porta própria, TLS com certificado de
// cliente obrigatório, sem cookie, sem as rotas do site e do /admin. Quem chama é identificado pela SAN do certificado
// (`urn:aevias:service:<id>`), nunca por cabeçalho; só `rh-collector` passa, e a cada requisição o AUTH confirma a
// capacidade (`feed.read` / `capabilities.read`) para a identidade `institucional-api` (o próprio site). Qualquer falha
// nega (fail-closed); nada de cache positivo.
//
// Desligado por padrão: só sobe com INTEGRACAO_PORT + INTEGRACAO_TLS_CERT/KEY + INTEGRACAO_MTLS_CA + INTEGRACAO_AUTH_URL
// (e a identidade de cliente institucional-api: INTEGRACAO_CLIENT_CERT/KEY, ou os COMERCIAL_MTLS_CERT/KEY da conexão 1).
// Mal configurado, loga uma vez e o site segue funcionando: o feed é opcional para o site.
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { TLSSocket } from 'node:tls';
import type { Pool } from 'pg';
import { CONTRACT_HASH, CONTRACT_VERSION, ErroFeed, resposta, valido } from './integracao-contrato.js';
import { criarProdutor, publicarConfiguracao } from './integracao-produtor.js';
import { transporteMtls, type Transporte } from './comercial.js';

export const APP_CODE = 'institucional';
export const COLETOR = 'rh-collector';
const SAN_SERVICO = 'URI:urn:aevias:service:';

export type Par = { servico: string; sha256: string };
export type LeitorDePar = (req: FastifyRequest) => Par;

export const parDoTls: LeitorDePar = (req) => {
  const socket = req.raw.socket as TLSSocket;
  if (!socket.encrypted || !socket.authorized || !socket.getPeerCertificate) throw new ErroFeed(403, 'scope_denied');
  const cert = socket.getPeerCertificate();
  const sans = (cert.subjectaltname ?? '').split(', ').filter((s) => s.startsWith(SAN_SERVICO));
  if (sans.length !== 1 || !cert.raw) throw new ErroFeed(403, 'scope_denied');
  return { servico: sans[0].slice(SAN_SERVICO.length), sha256: createHash('sha256').update(cert.raw).digest('hex') };
};

/** C03: o AUTH confirma, AGORA, que este par (id + certificado) tem a capacidade neste app. Qualquer dúvida nega. */
export function autorizadorAuth(transporte: Transporte) {
  return async (par: Par, capacidade: string) => {
    const pedido = { app_code: APP_CODE, capability: capacidade, request_id: randomUUID(), service_id: par.servico, certificate_sha256: par.sha256 };
    const r = await transporte('POST', '/v1/service-authorize-peer', pedido);
    if (r.status === null || r.status >= 500) throw new ErroFeed(503, 'core_unavailable', 'network', 'Serviço central indisponível. Tente novamente.');
    if (r.status !== 200) throw new ErroFeed(403, 'scope_denied');
    if (!valido('ServiceAuthorizeResponse', r.corpo) || r.corpo.service_id !== par.servico || r.corpo.app_code !== APP_CODE)
      throw new ErroFeed(503, 'dependency_contract_mismatch', 'schema', 'Serviço central indisponível. Tente novamente.');
  };
}

export type OpcoesIntegracao = {
  https?: Record<string, unknown>;
  /** Substituível nos testes; em produção vem do certificado TLS. */
  par?: LeitorDePar;
  /** Substituível nos testes; em produção consulta o AUTH. */
  autorizar?: (par: Par, capacidade: string) => Promise<void>;
  chaveCursor: string;
  release?: string;
};

export function construirIntegracao(pool: Pool, opcoes: OpcoesIntegracao): FastifyInstance {
  const par = opcoes.par ?? parDoTls;
  const autorizar = opcoes.autorizar ?? (async () => { throw new ErroFeed(503, 'core_unavailable', 'network'); });
  const produtor = criarProdutor(pool, opcoes.chaveCursor);
  const app = Fastify({ logger: false, https: opcoes.https as any, bodyLimit: 16 * 1024 });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
  });
  app.setErrorHandler((e: any, _req, reply) => {
    const id = randomUUID();
    if (e instanceof ErroFeed) return reply.code(e.status).send(e.corpo(id));
    // erro de validação/parse do Fastify (JSON inválido, corpo grande): 4xx sem eco do conteúdo
    if (typeof e?.statusCode === 'number' && e.statusCode >= 400 && e.statusCode < 500)
      return reply.code(400).send(new ErroFeed(400, 'invalid_request', 'schema', 'Requisição inválida.').corpo(id));
    return reply.code(503).send(new ErroFeed(503, 'core_unavailable', 'network', 'Serviço indisponível. Tente novamente.').corpo(id));
  });
  app.setNotFoundHandler((_req, reply) => reply.code(403).send(new ErroFeed(403, 'scope_denied').corpo(randomUUID())));

  const guarda = async (req: FastifyRequest, capacidade: 'feed.read' | 'capabilities.read') => {
    const p = par(req);
    if (p.servico !== COLETOR) throw new ErroFeed(403, 'scope_denied');
    await autorizar(p, capacidade);
  };

  app.get('/health/live', async () => ({ status: 'live' }));
  app.get('/internal/capabilities', async (req) => {
    await guarda(req, 'capabilities.read');
    return resposta('Capabilities', {
      app_code: APP_CODE,
      contract_version: CONTRACT_VERSION,
      contract_sha256: CONTRACT_HASH,
      capabilities: ['feed.read', 'snapshots', 'changes', 'reconciliation'],
      release: opcoes.release ?? process.env.RELEASE_ID ?? 'development'
    });
  });
  app.get('/api/integracao/v1/changes', async (req) => {
    await guarda(req, 'feed.read');
    return produtor.changes(req.query as any);
  });
  app.post('/api/integracao/v1/snapshots', async (req, reply) => {
    await guarda(req, 'feed.read');
    const chave = req.headers['idempotency-key'];
    return reply.send(await produtor.criarSnapshot(req.body, typeof chave === 'string' ? chave : ''));
  });
  app.get('/api/integracao/v1/snapshots/:id', async (req) => {
    await guarda(req, 'feed.read');
    return produtor.paginaSnapshot((req.params as any).id, req.query as any);
  });
  app.get('/api/integracao/v1/reconciliation', async (req) => {
    await guarda(req, 'feed.read');
    return produtor.reconciliacao();
  });
  (app as any).produtor = produtor;
  return app;
}

/** Lê INTEGRACAO_* e devolve o necessário para subir; null (com aviso) se desligado ou mal configurado. */
export function lerConfigIntegracao(env: NodeJS.ProcessEnv = process.env, aviso: (m: string) => void = console.warn) {
  const porta = env.INTEGRACAO_PORT?.trim();
  if (!porta) return null;
  try {
    const n = Number(porta);
    if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error('INTEGRACAO_PORT inválida');
    const arquivo = (nome: string, alternativa?: string) => {
      const caminho = env[nome] || (alternativa ? env[alternativa] : undefined);
      if (!caminho) throw new Error(`${nome} ausente`);
      return readFileSync(caminho);
    };
    const authUrl = new URL(env.INTEGRACAO_AUTH_URL ?? '');
    if (authUrl.protocol !== 'https:' || authUrl.username || authUrl.password) throw new Error('INTEGRACAO_AUTH_URL exige https sem credenciais');
    const ca = arquivo('INTEGRACAO_MTLS_CA');
    return {
      porta: n,
      host: env.INTEGRACAO_HOST?.trim() || '127.0.0.1',
      https: {
        cert: arquivo('INTEGRACAO_TLS_CERT'),
        key: arquivo('INTEGRACAO_TLS_KEY'),
        ca,
        requestCert: true,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2' as const
      },
      auth: { url: authUrl, ca, cert: arquivo('INTEGRACAO_CLIENT_CERT', 'COMERCIAL_MTLS_CERT'), key: arquivo('INTEGRACAO_CLIENT_KEY', 'COMERCIAL_MTLS_KEY') },
      chaveCursor: env.INTEGRACAO_CURSOR_KEY?.trim() || null
    };
  } catch (falha) {
    aviso(`feed do RH desligado: ${falha instanceof Error ? falha.message : 'configuração inválida'}`);
    return null;
  }
}

/** Sobe o listener se configurado. Nunca lança: o site não pode cair por causa do feed. */
export async function iniciarIntegracao(pool: Pool, ctx: { chaveCursorPadrao: string; versaoPolitica: string; areas: string[] }) {
  const cfg = lerConfigIntegracao();
  if (!cfg) return null;
  try {
    await publicarConfiguracao(pool, ctx.versaoPolitica, ctx.areas);
    const app = construirIntegracao(pool, {
      https: cfg.https,
      chaveCursor: cfg.chaveCursor ?? ctx.chaveCursorPadrao,
      autorizar: autorizadorAuth(transporteMtls(cfg.auth, 3000))
    });
    await app.listen({ port: cfg.porta, host: cfg.host });
    const produtor = (app as any).produtor as ReturnType<typeof criarProdutor>;
    const expurgar = () => void produtor.expurgar().catch(() => {});
    expurgar();
    setInterval(expurgar, 6 * 60 * 60 * 1000).unref();
    console.log(`feed do RH (mTLS) em https://${cfg.host}:${cfg.porta}`);
    return app;
  } catch (falha) {
    console.warn(`feed do RH não subiu: ${falha instanceof Error ? falha.message : 'erro'}`);
    return null;
  }
}
