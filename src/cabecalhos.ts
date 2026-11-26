import type { FastifyInstance } from 'fastify';

/**
 * Imagens públicas para os e-mails dos sistemas (AUTH, Comercial), em public/email/: os e-mails as mostram por
 * <img src="https://<site>/email/logo-afirma-evias.png">. Quem carrega é o cliente de e-mail, de outra origem.
 */
export const PREFIXO_EMAIL = '/email/';

/** A imagem pedida em /email/ pode ser embutida por outra origem; o resto do site, não. */
function imagemParaEmail(url: string, tipo: unknown) {
  return url.startsWith(PREFIXO_EMAIL) && typeof tipo === 'string' && tipo.startsWith('image/');
}

/** Cabeçalhos de segurança de todas as respostas do site. */
export function cabecalhosDeSeguranca(app: FastifyInstance, producao: boolean) {
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    // isolamento entre origens: impede que outra pagina abra esta em popup e
    // mantenha referencia ao window, e que terceiros embutam nossos recursos.
    // Excecao: as imagens de /email/. O webmail aberto no navegador (outra origem)
    // carrega a imagem direto, e com same-origin o navegador a recusaria. So a
    // imagem muda; paginas, CSS, scripts e a 404 de /email/ seguem same-origin.
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header(
      'Cross-Origin-Resource-Policy',
      imagemParaEmail(req.url, reply.getHeader('content-type')) ? 'cross-origin' : 'same-origin'
    );
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
}
