import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import estatico from '@fastify/static';

const aqui = path.dirname(fileURLToPath(import.meta.url));

/**
 * Arquivos de public/ (na imagem da Railway, /app/public ao lado de dist/), sem sessão: cache de 365 dias em produção e
 * zero no desenvolvimento. Inclui public/email/, as imagens que os e-mails dos sistemas mostram (ver src/cabecalhos.ts).
 */
export async function registrarEstaticos(app: FastifyInstance, producao: boolean) {
  await app.register(estatico, {
    root: path.resolve(aqui, '../public'),
    prefix: '/',
    maxAge: producao ? '365d' : 0
  });
}
