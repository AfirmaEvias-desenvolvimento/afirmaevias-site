import type { FastifyReply, FastifyRequest } from 'fastify';

// Página 404. Sob /admin usa o layout do painel (o topo.ejs exige `rotaAtual` e `usuario`: sem `rotaAtual` a 404 virava 500,
// inclusive no OPTIONS de preflight); o resto, a do site.
export function naoEncontrado(request: FastifyRequest, reply: FastifyReply) {
  if (request.url.startsWith('/admin')) {
    return reply.code(404).view('admin/404', { titulo: 'Página não encontrada', usuario: null, rotaAtual: '' });
  }
  return reply.code(404).view('pages/404', {
    titulo: 'Página não encontrada',
    descricao: 'O endereço que você acessou não existe.',
    rotaAtual: '',
    naoIndexar: true
  });
}
