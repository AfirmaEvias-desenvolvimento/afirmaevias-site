// Perfil Railway do site (Fase 0 do hipersistema). Tudo aqui é opt-in: sem PUBLIC_HTTP e sem HOST o site escuta e confia
// no proxy exatamente como antes (0.0.0.0 e trustProxy: true, que é o que a borda TLS local em 127.0.0.1 precisa).
//
// PUBLIC_HTTP=1: a borda da Railway termina o TLS e repassa em HTTP puro ao PORT, e entre a borda e o container há mais
// um salto interno. Medido em produção (19/11/2026): o par TCP é interno da Railway e o X-Forwarded-For chega como
// "<cliente>, <IP da própria borda 46.151.194.x>"; um X-Forwarded-For mandado pelo visitante é DESCARTADO pela borda.
// Confiar só no socket (1 salto) gravava o IP da borda como se fosse o do cliente (trilha, evidência, limites por IP).
// Por isso o site confia em N saltos, N = TRUST_PROXY_HOPS (inteiro de 1 a 3, padrão 2): o socket e os N-1 itens mais à
// direita do X-Forwarded-For. Com N=2 o IP do cliente é o 2º item da direita (o penúltimo), como no nginx do Controle.
// Com menos itens do que o necessário vale o mais à esquerda disponível; sem X-Forwarded-For, o par TCP. Valor fora de
// 1 a 3 impede a partida. CF-Connecting-IP, X-Real-IP e Forwarded nunca são lidos: o req.ip só sai do X-Forwarded-For.
//
// No Fastify 5 o trustProxy numérico não vale (a tipagem não aceita e o comportamento não é o de saltos), por isso os
// saltos são expressos como função: (endereço, salto) => salto < N, onde o salto 0 é o par do socket.
import type { FastifyInstance } from 'fastify';

type Env = NodeJS.ProcessEnv;
export type ConfiancaProxy = true | ((endereco: string, salto: number) => boolean);

export const publicHttp = (env: Env = process.env) => env.PUBLIC_HTTP?.trim() === '1';

/** Saltos de proxy confiáveis no modo Railway: TRUST_PROXY_HOPS (1 a 3), padrão 2. Fora de 1 a 3, erro (não sobe). */
export function saltosProxy(env: Env = process.env): number {
  const bruto = env.TRUST_PROXY_HOPS?.trim();
  if (!bruto) return 2;
  if (!/^[1-3]$/.test(bruto))
    throw new Error(`TRUST_PROXY_HOPS inválido: "${bruto}". Use um inteiro de 1 a 3 (padrão 2 na Railway: o socket e a borda).`);
  return Number(bruto);
}

/** N saltos atrás da borda da Railway (TRUST_PROXY_HOPS, padrão 2); sem PUBLIC_HTTP, o comportamento local de sempre (true). */
export function confiancaProxy(env: Env = process.env): ConfiancaProxy {
  if (!publicHttp(env)) return true;
  const saltos = saltosProxy(env);
  return (_endereco: string, salto: number) => salto < saltos;
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
