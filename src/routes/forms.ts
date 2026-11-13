import type { FastifyInstance } from 'fastify';
import { consultar, consultarUm } from '../db.js';
import { config } from '../config.js';
import * as conteudo from '../content.js';
import { assinaturaConfere, emailValido, gerarProtocolo, hashIp, limpar } from '../utils.js';
import { registrarAuditoria } from '../audit.js';
import { chaveDoContato, comercialLigado, processarFilaComercial } from '../comercial-fila.js';

const limite = { config: { rateLimit: { max: 8, timeWindow: '10 minutes' } } };

export async function rotasFormularios(app: FastifyInstance) {
  // ------------------------------------------------------------- contato
  app.post('/contato', limite, async (request, reply) => {
    const corpo = request.body as Record<string, string>;
    const valores = {
      nome: limpar(corpo.nome, 120),
      sobrenome: limpar(corpo.sobrenome, 120),
      email: limpar(corpo.email, 200),
      telefone: limpar(corpo.telefone, 40),
      empresa: limpar(corpo.empresa, 160),
      cnpj: limpar(corpo.cnpj, 24),
      assunto: limpar(corpo.assunto, 160),
      mensagem: limpar(corpo.mensagem, 5000)
    };
    const consentimento = corpo.consentimento === 'on' || corpo.consentimento === 'true';
    const origem = limpar(corpo.origem, 40) || 'contato';

    // campo escondido: se veio preenchido, e robo
    if (limpar(corpo.website, 100)) return reply.redirect('/contato?ok=1');

    // todos os erros de uma vez: a cascata de else-if obrigava um envio por defeito
    const erros: string[] = [];
    if (!valores.nome) erros.push('Escreva seu nome.');
    if (!emailValido(valores.email)) erros.push('Confira o e-mail digitado.');
    if (valores.mensagem.length < 10) erros.push('Conte um pouco mais sobre o que você precisa.');
    // CNPJ é opcional; se preenchido, precisa ter os 14 dígitos (a conferência dos dígitos verificadores é do Comercial)
    if (valores.cnpj && valores.cnpj.replace(/\D/g, '').length !== 14) erros.push('Confira o CNPJ: são 14 números.');
    if (!consentimento) erros.push('Marque o aceite da Política de Privacidade para enviarmos sua mensagem.');

    const pagina = origem === 'home' ? 'pages/contato' : 'pages/contato';

    if (erros.length > 0) {
      return reply.code(400).view(pagina, {
        titulo: 'Contato | Afirma E-vias',
        descricao: 'Fale com a Afirma E-vias.',
        rotaAtual: '/contato',
        enviado: false,
        erros,
        valores
      });
    }

    // Conexão 1 (Institucional → Comercial): com a integração ligada, a linha da fila nasce na MESMA instrução que grava o
    // contato (CTE), então não há contato sem fila nem fila sem contato. Desligada, a segunda parte não insere nada e o
    // site se comporta como antes. O envio em si é assíncrono (comercial-fila.ts): o Comercial fora do ar não atrasa nem
    // derruba a resposta ao visitante.
    const ligado = comercialLigado();
    await consultar(
      `WITH novo AS (
         INSERT INTO contatos (nome, sobrenome, email, telefone, empresa, cnpj, assunto, mensagem, origem, consentimento, ip, user_agent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id
       )
       INSERT INTO leads_comercial (contato_id, chave, privacidade_versao)
       SELECT id, $13 || id::text, $14 FROM novo WHERE $15::boolean`,
      [
        valores.nome,
        valores.sobrenome,
        valores.email,
        valores.telefone,
        valores.empresa,
        valores.cnpj.replace(/\D/g, '') || null,
        valores.assunto,
        valores.mensagem,
        origem,
        consentimento,
        request.ip,
        String(request.headers['user-agent'] ?? '').slice(0, 400),
        chaveDoContato(''),
        config.versaoPolitica,
        ligado
      ]
    );
    if (ligado) void processarFilaComercial();


    return reply.view(pagina, {
      titulo: 'Mensagem enviada | Afirma E-vias',
      descricao: 'Fale com a Afirma E-vias.',
      rotaAtual: '/contato',
      enviado: true,
      erros: [],
      valores: {}
    });
  });

  // -------------------------------------------------------- trabalhe conosco
  app.post('/trabalhe-com-a-gente', limite, async (request, reply) => {
    const valores: Record<string, string> = {};
    let arquivoNome = '';
    let arquivoTipo = '';
    let arquivoDados: Buffer | null = null;
    let arquivoGrande = false;

    try {
      for await (const parte of request.parts()) {
        if (parte.type === 'file') {
          arquivoNome = limpar(parte.filename, 200);
          arquivoTipo = parte.mimetype;
          arquivoDados = await parte.toBuffer();
        } else {
          valores[parte.fieldname] = limpar(parte.value as string, 5000);
        }
      }
    } catch (falha: any) {
      // o limite do multipart estoura dentro do toBuffer: sem isto virava
      // pagina de erro generica em vez de aviso no formulario
      if (falha?.code !== 'FST_REQ_FILE_TOO_LARGE') throw falha;
      arquivoGrande = true;
    }

    // um campo so para o nome; a tabela continua com nome e sobrenome separados
    const nomeCompleto = limpar(valores.nome, 240).replace(/\s+/g, ' ');
    const [primeiroNome, ...restanteNome] = nomeCompleto.split(' ');

    const consentimento = valores.consentimento === 'on';

    const tiposPermitidos = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    const extensao = (arquivoNome.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
    // no celular o arquivo costuma chegar como octet-stream: ai vale a extensao
    const tipoAceito =
      tiposPermitidos.includes(arquivoTipo) ||
      (['pdf', 'doc', 'docx'].includes(extensao) &&
        (arquivoTipo === 'application/octet-stream' || arquivoTipo === ''));

    const erros: string[] = [];
    if (!primeiroNome) erros.push('Escreva seu nome.');
    if (!emailValido(valores.email ?? '')) erros.push('Confira o e-mail digitado.');
    if (arquivoGrande) erros.push('O currículo passou de 5 MB. Salve como PDF e tente de novo.');
    else if (!arquivoDados || arquivoDados.length === 0) erros.push('Anexe seu currículo.');
    else if (!tipoAceito) erros.push('O currículo precisa ser PDF, DOC ou DOCX.');
    // aceitar a extensao quando o tipo chega generico abriu espaco para renomear
    // qualquer arquivo para .pdf: os primeiros bytes precisam bater com o formato
    else if (!assinaturaConfere(arquivoDados, extensao))
      erros.push('O arquivo não parece ser um PDF, DOC ou DOCX de verdade. Salve de novo e reenvie.');
    if (!consentimento) erros.push('Marque o aceite para guardarmos seu currículo.');

    if (erros.length > 0) {
      return reply.code(400).view('pages/vagas', {
        titulo: 'Trabalhe com a gente | Afirma E-vias',
        descricao: 'Envie seu currículo.',
        rotaAtual: '/trabalhe-com-a-gente',
        vagas: conteudo.vagas,
        enviado: false,
        erros,
        valores
      });
    }

    await consultar(
      `INSERT INTO candidaturas (nome, sobrenome, email, telefone, area, mensagem, arquivo_nome, arquivo_tipo, arquivo_bytes, arquivo_dados, consentimento, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        primeiroNome,
        restanteNome.join(' '),
        valores.email,
        valores.telefone ?? '',
        valores.area ?? '',
        valores.mensagem ?? '',
        arquivoNome,
        arquivoTipo,
        arquivoDados!.length,
        arquivoDados,
        consentimento,
        request.ip,
        String(request.headers['user-agent'] ?? '').slice(0, 400)
      ]
    );


    return reply.view('pages/vagas', {
      titulo: 'Currículo recebido | Afirma E-vias',
      descricao: 'Envie seu currículo.',
      rotaAtual: '/trabalhe-com-a-gente',
      vagas: conteudo.vagas,
      enviado: true,
      erros: [],
      valores: {}
    });
  });

  // ----------------------------------------------------- relato integridade
  app.post('/programa-de-integridade', limite, async (request, reply) => {
    const corpo = request.body as Record<string, string>;
    const anonimo = corpo.anonimo !== 'nao';
    const valores = {
      anonimo,
      titulo: limpar(corpo.titulo, 200),
      categoria: limpar(corpo.categoria, 80),
      relato: limpar(corpo.relato, 8000),
      nome: anonimo ? '' : limpar(corpo.nome, 120),
      email: anonimo ? '' : limpar(corpo.email, 200)
    };

    const erros: string[] = [];
    if (!valores.titulo) erros.push('Dê um título ao relato.');
    if (valores.relato.length < 20) erros.push('Descreva o que aconteceu com mais detalhes.');
    if (!anonimo && !emailValido(valores.email)) erros.push('Confira o e-mail para retorno.');

    if (erros.length > 0) {
      return reply.code(400).view('pages/integridade', {
        titulo: 'Programa de integridade | Afirma E-vias',
        descricao: 'Compliance e canal de denúncias.',
        rotaAtual: '/programa-de-integridade',
        integridade: conteudo.integridade,
        enviado: null,
        protocolo: null,
        erros,
        valores
      });
    }

    const protocolo = gerarProtocolo('INT');
    await consultar(
      `INSERT INTO relatos_integridade (protocolo, titulo, relato, categoria, anonimo, nome, email)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [protocolo, valores.titulo, valores.relato, valores.categoria, anonimo, valores.nome || null, valores.email || null]
    );


    return reply.view('pages/integridade', {
      titulo: 'Relato registrado | Afirma E-vias',
      descricao: 'Compliance e canal de denúncias.',
      rotaAtual: '/programa-de-integridade',
      integridade: conteudo.integridade,
      enviado: true,
      protocolo,
      erros: [],
      valores: {}
    });
  });

  // ---------------------------------------------------- portal do titular
  app.post('/portal-do-titular', limite, async (request, reply) => {
    const corpo = request.body as Record<string, string>;
    const valores = {
      tipo: limpar(corpo.tipo, 40),
      nome: limpar(corpo.nome, 160),
      email: limpar(corpo.email, 200),
      documento: limpar(corpo.documento, 40),
      detalhes: limpar(corpo.detalhes, 4000)
    };
    const confirma = corpo.confirmacao === 'on';
    const tiposValidos = conteudo.tiposSolicitacaoLgpd.map((t) => t.valor);

    const erros: string[] = [];
    if (!tiposValidos.includes(valores.tipo)) erros.push('Escolha o que você quer solicitar.');
    if (!valores.nome) erros.push('Escreva seu nome completo.');
    if (!emailValido(valores.email)) erros.push('Confira o e-mail digitado.');
    if (!confirma) erros.push('Confirme que os dados são seus para seguirmos com a solicitação.');

    if (erros.length > 0) {
      return reply.code(400).view('pages/lgpd', {
        titulo: 'Portal do titular | Afirma E-vias',
        descricao: 'Exerça seus direitos previstos na LGPD.',
        rotaAtual: '/portal-do-titular',
        tipos: conteudo.tiposSolicitacaoLgpd,
        enviado: null,
        protocolo: null,
        erros,
        valores
      });
    }

    const protocolo = gerarProtocolo('LGPD');
    await consultar(
      `INSERT INTO solicitacoes_lgpd (protocolo, tipo, nome, email, documento, detalhes, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [protocolo, valores.tipo, valores.nome, valores.email, valores.documento, valores.detalhes, request.ip]
    );


    return reply.view('pages/lgpd', {
      titulo: 'Solicitação registrada | Afirma E-vias',
      descricao: 'Exerça seus direitos previstos na LGPD.',
      rotaAtual: '/portal-do-titular',
      tipos: conteudo.tiposSolicitacaoLgpd,
      enviado: true,
      protocolo,
      erros: [],
      valores: {}
    });
  });

  // ------------------------------------------------- consentimento cookies
  app.post('/api/consentimento', { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const corpo = request.body as Record<string, any>;
    const visitanteId = limpar(corpo.visitanteId, 64) || hashIp(request.ip + Date.now());
    await consultar(
      `INSERT INTO consentimentos_cookies (visitante_id, necessarios, analiticos, marketing, versao_politica, ip_hash, user_agent)
       VALUES ($1, TRUE, $2, $3, $4, $5, $6)`,
      [
        visitanteId,
        Boolean(corpo.analiticos),
        Boolean(corpo.marketing),
        config.versaoPolitica,
        hashIp(request.ip),
        String(request.headers['user-agent'] ?? '').slice(0, 400)
      ]
    );
    return reply.send({ ok: true, versao: config.versaoPolitica });
  });

  // consulta publica de protocolo
  // Sem limite aqui dava para varrer protocolos: o de integridade revela que
  // existe um relato e em que pe esta, o que fragiliza o canal de denuncia.
  app.get(
    '/protocolo/:codigo',
    { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } },
    async (request, reply) => {
    const codigo = limpar((request.params as any).codigo, 40).toUpperCase();
    let registro: any = null;
    let tipo = '';

    if (codigo.startsWith('LGPD-')) {
      registro = await consultarUm(
        'SELECT protocolo, tipo, status, criado_em, prazo_em, respondida_em FROM solicitacoes_lgpd WHERE protocolo = $1',
        [codigo]
      );
      tipo = 'lgpd';
    } else if (codigo.startsWith('INT-')) {
      registro = await consultarUm(
        'SELECT protocolo, status, criado_em FROM relatos_integridade WHERE protocolo = $1',
        [codigo]
      );
      tipo = 'integridade';
    }

    return reply.view('pages/protocolo', {
      titulo: `Protocolo ${codigo} | Afirma E-vias`,
      descricao: 'Acompanhe o andamento do seu protocolo.',
      rotaAtual: '',
      codigo,
      registro,
      tipo
    });
  });
}
