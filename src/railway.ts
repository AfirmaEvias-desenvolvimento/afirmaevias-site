// Perfil Railway do site (Fase 0 do hipersistema). Tudo aqui é opt-in: sem PUBLIC_HTTP e sem HOST o site escuta e confia
// no proxy exatamente como antes (0.0.0.0 e trustProxy: true, que é o que a borda TLS local em 127.0.0.1 precisa).
//
// PUBLIC_HTTP=1: a borda da Railway termina o TLS e repassa em HTTP puro ao PORT. Nesse caso o site confia em
// EXATAMENTE 1 salto de proxy: req.ip passa a ser a última entrada do X-Forwarded-For (a que a própria borda
// acrescenta), e o esquema vem do X-Forwarded-Proto dela. Um X-Forwarded-For forjado pelo visitante fica à esquerda e
// é ignorado, então não serve para burlar o limite de tentativas nem para escolher o IP gravado na trilha.
//
// No Fastify 5 o trustProxy numérico não vale (a tipagem não aceita e o comportamento não é o de saltos), por isso o
// salto único é expresso como função: confia só no par imediato do socket (hop 0).
import type { FastifyInstance } from 'fastify';

type Env = NodeJS.ProcessEnv;
export type ConfiancaProxy = true | ((endereco: string, salto: number) => boolean);

export const publicHttp = (env: Env = process.env) => env.PUBLIC_HTTP?.trim() === '1';

/** Um salto só atrás da borda da Railway; sem PUBLIC_HTTP, o comportamento local de sempre (true). */
export function confiancaProxy(env: Env = process.env): ConfiancaProxy {
  return publicHttp(env) ? (_endereco: string, salto: number) => salto < 1 : true;
}

/** HOST do listener público. Na Railway, `::` (rede privada em IPv6; o socket também aceita IPv4). */
export const hostEscuta = (env: Env = process.env) => env.HOST?.trim() || '0.0.0.0';

/**
 * Saúde. `/health/live` é o healthcheck da Railway: só diz que o processo responde, sem banco, AUTH ou RH (o site não
 * depende de AUTH/RH para servir páginas). `/health` continua como era: confere o banco com SELECT 1.
 */
export function rotasSaude(app: FastifyInstance, conferirBanco: () => Promise<unknown>) {
  app.get('/health/live', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { status: 'live' };
  });
  app.get('/health', async (_req, reply) => {
    await conferirBanco();
    reply.header('Cache-Control', 'no-store');
    return { ok: true };
  });
}
