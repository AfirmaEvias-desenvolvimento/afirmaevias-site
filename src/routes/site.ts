import type { FastifyInstance } from 'fastify';
import * as conteudo from '../content.js';
import { config } from '../config.js';

export async function rotasSite(app: FastifyInstance) {
  app.get('/', async (_req, reply) =>
    reply.view('pages/home', {
      titulo: 'Afirma Evias | Engenharia viária',
      descricao:
        'Estudos, projetos, supervisão e controle tecnológico de obras rodoviárias e urbanas. Mais de 20 anos de tradição e inovação.',
      rotaAtual: '/',
      home: conteudo.home,
      indicadores: conteudo.indicadores,
      clientes: conteudo.clientes,
      notaClientes: conteudo.notaClientes,
      telasVitrine: conteudo.telasVitrine,
      aplicativo: conteudo.aplicativo
    })
  );

  app.get('/afirma-evias', async (_req, reply) =>
    reply.view('pages/sobre', {
      titulo: 'A empresa | Afirma Evias',
      descricao:
        'A história da Afirma Evias: a união da Afirma Engenharia (2002) com a Evias (2016), consolidada na fusão de 2024.',
      rotaAtual: '/afirma-evias',
      sobre: conteudo.sobre,
      indicadores: conteudo.indicadores
    })
  );

  app.get('/servicos', async (_req, reply) =>
    reply.view('pages/servicos', {
      titulo: 'Serviços | Afirma Evias',
      descricao:
        'Supervisão e controle tecnológico, projetos em BIM, consultoria, laboratórios fixos e móveis, sondagens, ensaios e levantamentos.',
      rotaAtual: '/servicos',
      notaMarcas: conteudo.notaMarcas,
      servicos: conteudo.servicos
    })
  );

  app.get('/aplicativo', async (_req, reply) =>
    reply.view('pages/aplicativo', {
      titulo: 'Aplicativo | Afirma Evias',
      descricao:
        'O app Afirma Evias conecta campo e escritório: ensaios georreferenciados, alertas de não conformidade e dashboards analíticos.',
      rotaAtual: '/aplicativo',
      aplicativo: conteudo.aplicativo,
      telasVitrine: conteudo.telasVitrine
    })
  );

  app.get('/acreditacao-e-certificacao', async (_req, reply) =>
    reply.view('pages/acreditacao', {
      titulo: 'Acreditação e certificação | Afirma Evias',
      descricao:
        'ISO 9001, política da qualidade, missão, visão, valores e comunicado sobre a acreditação ISO/IEC 17025.',
      rotaAtual: '/acreditacao-e-certificacao',
      acreditacao: conteudo.acreditacao
    })
  );

  app.get('/programa-de-integridade', async (_req, reply) =>
    reply.view('pages/integridade', {
      titulo: 'Programa de integridade | Afirma Evias',
      descricao:
        'Compliance, Código de Ética e Conduta e canal de denúncias anônimo e seguro operado por empresa independente.',
      rotaAtual: '/programa-de-integridade',
      integridade: conteudo.integridade,
      enviado: null,
      protocolo: null,
      erros: [],
      valores: {}
    })
  );

  app.get('/trabalhe-com-a-gente', async (_req, reply) =>
    reply.view('pages/vagas', {
      titulo: 'Trabalhe com a gente | Afirma Evias',
      descricao:
        'Vagas em engenharia de projetos, supervisão de obras, laboratório, topografia e BIM. Envie seu currículo para a Afirma Evias — guardamos por 12 meses e avaliamos cada envio.',
      rotaAtual: '/trabalhe-com-a-gente',
      vagas: conteudo.vagas,
      enviado: false,
      erros: [],
      valores: {}
    })
  );

  app.get('/contato', async (_req, reply) =>
    reply.view('pages/contato', {
      titulo: 'Contato | Afirma Evias',
      descricao:
        'Fale com a Afirma Evias sobre controle tecnológico, projetos viários, sondagens ou laboratório. Escritórios em Curitiba/PR e Marília/SP, com atendimento por telefone, WhatsApp e formulário.',
      rotaAtual: '/contato',
      enviado: false,
      erros: [],
      valores: {}
    })
  );

  app.get('/politica-de-privacidade', async (_req, reply) =>
    reply.view('pages/privacidade', {
      titulo: 'Política de privacidade | Afirma Evias',
      descricao: 'Como a Afirma Evias trata dados pessoais, nos termos da LGPD (Lei 13.709/2018).',
      rotaAtual: '/politica-de-privacidade',
      privacidade: conteudo.privacidade,
      cookies: conteudo.cookies
    })
  );

  app.get('/termos-de-uso', async (_req, reply) =>
    reply.view('pages/termos', {
      titulo: 'Termos de uso | Afirma Evias',
      descricao:
        'Condições de uso do site da Afirma Evias: responsabilidades, propriedade intelectual, uso dos formulários e canais oficiais de atendimento.',
      rotaAtual: '/termos-de-uso',
      termos: conteudo.termos
    })
  );

  app.get('/portal-do-titular', async (_req, reply) =>
    reply.view('pages/lgpd', {
      titulo: 'Portal do titular | Afirma Evias',
      descricao:
        'Exerça seus direitos de titular de dados pessoais previstos no art. 18 da LGPD. Resposta em até 15 dias com protocolo.',
      rotaAtual: '/portal-do-titular',
      tipos: conteudo.tiposSolicitacaoLgpd,
      enviado: null,
      protocolo: null,
      erros: [],
      valores: {}
    })
  );

  app.get('/bruno_magalhaes', async (_req, reply) =>
    reply.view('pages/extra', {
      titulo: 'Bruno Magalhães | Afirma Evias',
      descricao: '',
      rotaAtual: '/bruno_magalhaes',
      naoIndexar: true,
      pecas: conteudo.pecas
    })
  );

  app.get('/acessibilidade', async (_req, reply) =>
    reply.view('pages/acessibilidade', {
      titulo: 'Declaração de acessibilidade | Afirma Evias',
      descricao:
        'O que foi verificado, o que ainda não foi e como relatar uma barreira de acessibilidade no site da Afirma Evias.',
      rotaAtual: '/acessibilidade',
      acessibilidade: conteudo.acessibilidade
    })
  );

  app.get('/robots.txt', async (_req, reply) => {
    reply.type('text/plain');
    return `User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${
      config.siteUrl.replace(/\/$/, '')
    }/sitemap.xml\n`;
  });

  app.get('/sitemap.xml', async (_req, reply) => {
    const rotas = [
      '/',
      '/afirma-evias',
      '/servicos',
      '/aplicativo',
      '/acreditacao-e-certificacao',
      '/programa-de-integridade',
      '/trabalhe-com-a-gente',
      '/contato',
      '/politica-de-privacidade',
      '/termos-de-uso',
      '/portal-do-titular',
      '/acessibilidade'
    ];
    const base = config.siteUrl.replace(/\/$/, '');
    reply.type('application/xml');
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${rotas.map((rota) => `  <url><loc>${base}${rota}</loc></url>`).join('\n')}
</urlset>`;
  });
}
