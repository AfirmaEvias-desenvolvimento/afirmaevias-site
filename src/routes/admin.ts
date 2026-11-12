import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { consultar, consultarUm, contar } from '../db.js';
import {
  abrirSessao,
  autenticar,
  contaEstaFreada,
  fecharSessao,
  gerarHashSenha,
  limparTentativas,
  registrarTentativaFalha,
  type UsuarioAdmin,
  usuarioDaRequisicao
} from '../auth.js';
import { registrarAuditoria } from '../audit.js';
import { configComercial } from '../comercial-fila.js';
import { transporteMtls } from '../comercial.js';
import { concluirPendencia, contarPendenciasAbertas, excluirContatoPeloPainel, listarPendencias } from '../eliminacao-comercial.js';
import { cabecalhoAnexo, emailValido, limpar, paraCsv } from '../utils.js';

declare module 'fastify' {
  interface FastifyRequest {
    usuario?: UsuarioAdmin | null;
  }
}

const TAMANHO_PAGINA = 25;

// Cada coleção do admin descrita uma vez. As telas de lista, detalhe e CSV
// são geradas a partir daqui — não existe rota escrita à mão por tabela.
type Colecao = {
  chave: string;
  rotulo: string;
  tabela: string;
  singular: string;
  colunasLista: { campo: string; rotulo: string; tipo?: 'data' | 'status' | 'texto' }[];
  camposBusca: string[];
  camposDetalhe: { campo: string; rotulo: string; tipo?: 'data' | 'texto' | 'longo' | 'bool' }[];
  colunasCsv: string[];
  status: string[];
  temArquivo?: boolean;
};

export const colecoes: Record<string, Colecao> = {
  contatos: {
    chave: 'contatos',
    rotulo: 'Contatos comerciais',
    singular: 'contato',
    tabela: 'contatos',
    colunasLista: [
      { campo: 'criado_em', rotulo: 'Recebido', tipo: 'data' },
      { campo: 'nome', rotulo: 'Nome' },
      { campo: 'email', rotulo: 'E-mail' },
      { campo: 'empresa', rotulo: 'Empresa' },
      { campo: 'origem', rotulo: 'Origem' },
      { campo: 'status', rotulo: 'Status', tipo: 'status' }
    ],
    camposBusca: ['nome', 'sobrenome', 'email', 'empresa', 'mensagem'],
    camposDetalhe: [
      { campo: 'nome', rotulo: 'Nome' },
      { campo: 'sobrenome', rotulo: 'Sobrenome' },
      { campo: 'email', rotulo: 'E-mail' },
      { campo: 'telefone', rotulo: 'Telefone' },
      { campo: 'empresa', rotulo: 'Empresa' },
      { campo: 'cnpj', rotulo: 'CNPJ' },
      { campo: 'assunto', rotulo: 'Assunto' },
      { campo: 'mensagem', rotulo: 'Mensagem', tipo: 'longo' },
      { campo: 'origem', rotulo: 'Página de origem' },
      { campo: 'consentimento', rotulo: 'Aceitou a política', tipo: 'bool' },
      { campo: 'ip', rotulo: 'IP' },
      { campo: 'user_agent', rotulo: 'Navegador' },
      { campo: 'criado_em', rotulo: 'Recebido em', tipo: 'data' }
    ],
    colunasCsv: ['criado_em', 'nome', 'sobrenome', 'email', 'telefone', 'empresa', 'assunto', 'mensagem', 'origem', 'status'],
    status: ['novo', 'em atendimento', 'respondido', 'arquivado']
  },
  candidaturas: {
    chave: 'candidaturas',
    rotulo: 'Currículos',
    singular: 'currículo',
    tabela: 'candidaturas',
    temArquivo: true,
    colunasLista: [
      { campo: 'criado_em', rotulo: 'Recebido', tipo: 'data' },
      { campo: 'nome', rotulo: 'Nome' },
      { campo: 'email', rotulo: 'E-mail' },
      { campo: 'area', rotulo: 'Área' },
      { campo: 'arquivo_nome', rotulo: 'Arquivo' },
      { campo: 'status', rotulo: 'Status', tipo: 'status' }
    ],
    camposBusca: ['nome', 'sobrenome', 'email', 'area', 'mensagem'],
    camposDetalhe: [
      { campo: 'nome', rotulo: 'Nome' },
      { campo: 'sobrenome', rotulo: 'Sobrenome' },
      { campo: 'email', rotulo: 'E-mail' },
      { campo: 'telefone', rotulo: 'Telefone' },
      { campo: 'area', rotulo: 'Área de interesse' },
      { campo: 'mensagem', rotulo: 'Mensagem', tipo: 'longo' },
      { campo: 'arquivo_nome', rotulo: 'Currículo' },
      { campo: 'arquivo_bytes', rotulo: 'Tamanho (bytes)' },
      { campo: 'consentimento', rotulo: 'Aceitou a política', tipo: 'bool' },
      { campo: 'criado_em', rotulo: 'Recebido em', tipo: 'data' }
    ],
    colunasCsv: ['criado_em', 'nome', 'sobrenome', 'email', 'telefone', 'area', 'arquivo_nome', 'status'],
    status: ['novo', 'em análise', 'entrevista', 'banco de talentos', 'descartado']
  },
  relatos: {
    chave: 'relatos',
    rotulo: 'Relatos de integridade',
    singular: 'relato',
    tabela: 'relatos_integridade',
    colunasLista: [
      { campo: 'criado_em', rotulo: 'Recebido', tipo: 'data' },
      { campo: 'protocolo', rotulo: 'Protocolo' },
      { campo: 'titulo', rotulo: 'Título' },
      { campo: 'categoria', rotulo: 'Categoria' },
      { campo: 'status', rotulo: 'Status', tipo: 'status' }
    ],
    camposBusca: ['protocolo', 'titulo', 'relato', 'categoria'],
    camposDetalhe: [
      { campo: 'protocolo', rotulo: 'Protocolo' },
      { campo: 'titulo', rotulo: 'Título' },
      { campo: 'categoria', rotulo: 'Categoria' },
      { campo: 'relato', rotulo: 'Relato', tipo: 'longo' },
      { campo: 'anonimo', rotulo: 'Anônimo', tipo: 'bool' },
      { campo: 'nome', rotulo: 'Nome do relator' },
      { campo: 'email', rotulo: 'E-mail do relator' },
      { campo: 'criado_em', rotulo: 'Recebido em', tipo: 'data' }
    ],
    colunasCsv: ['criado_em', 'protocolo', 'titulo', 'categoria', 'anonimo', 'status'],
    status: ['recebido', 'em apuração', 'procedente', 'improcedente', 'encerrado']
  },
  lgpd: {
    chave: 'lgpd',
    rotulo: 'Solicitações LGPD',
    singular: 'solicitação',
    tabela: 'solicitacoes_lgpd',
    colunasLista: [
      { campo: 'criado_em', rotulo: 'Recebida', tipo: 'data' },
      { campo: 'protocolo', rotulo: 'Protocolo' },
      { campo: 'tipo', rotulo: 'Pedido' },
      { campo: 'nome', rotulo: 'Titular' },
      { campo: 'prazo_em', rotulo: 'Prazo', tipo: 'data' },
      { campo: 'status', rotulo: 'Status', tipo: 'status' }
    ],
    camposBusca: ['protocolo', 'nome', 'email', 'detalhes'],
    camposDetalhe: [
      { campo: 'protocolo', rotulo: 'Protocolo' },
      { campo: 'tipo', rotulo: 'Tipo de pedido' },
      { campo: 'nome', rotulo: 'Titular' },
      { campo: 'email', rotulo: 'E-mail' },
      { campo: 'documento', rotulo: 'Documento' },
      { campo: 'detalhes', rotulo: 'Detalhes', tipo: 'longo' },
      { campo: 'criado_em', rotulo: 'Recebida em', tipo: 'data' },
      { campo: 'prazo_em', rotulo: 'Prazo legal', tipo: 'data' },
      { campo: 'respondida_em', rotulo: 'Respondida em', tipo: 'data' },
      { campo: 'ip', rotulo: 'IP' }
    ],
    colunasCsv: ['criado_em', 'protocolo', 'tipo', 'nome', 'email', 'status', 'prazo_em', 'respondida_em'],
    status: ['recebida', 'em análise', 'atendida', 'recusada']
  },
  consentimentos: {
    chave: 'consentimentos',
    rotulo: 'Consentimentos de cookies',
    singular: 'consentimento',
    tabela: 'consentimentos_cookies',
    colunasLista: [
      { campo: 'criado_em', rotulo: 'Registrado', tipo: 'data' },
      { campo: 'visitante_id', rotulo: 'Visitante' },
      { campo: 'analiticos', rotulo: 'Analíticos' },
      { campo: 'marketing', rotulo: 'Marketing' },
      { campo: 'versao_politica', rotulo: 'Versão' }
    ],
    camposBusca: ['visitante_id', 'versao_politica'],
    camposDetalhe: [
      { campo: 'visitante_id', rotulo: 'ID do visitante' },
      { campo: 'necessarios', rotulo: 'Necessários', tipo: 'bool' },
      { campo: 'analiticos', rotulo: 'Analíticos', tipo: 'bool' },
      { campo: 'marketing', rotulo: 'Marketing', tipo: 'bool' },
      { campo: 'versao_politica', rotulo: 'Versão da política' },
      { campo: 'ip_hash', rotulo: 'Hash do IP' },
      { campo: 'user_agent', rotulo: 'Navegador' },
      { campo: 'criado_em', rotulo: 'Registrado em', tipo: 'data' }
    ],
    colunasCsv: ['criado_em', 'visitante_id', 'necessarios', 'analiticos', 'marketing', 'versao_politica'],
    status: []
  }
};

// As consultas do painel interpolam nome de tabela e de coluna direto na SQL,
// porque parametro do Postgres so vale para valor, nao para identificador. Hoje
// tudo vem deste mapa e nada do visitante - os valores de busca, status e
// resposta passam por $1, $2 e assim por diante. O risco e futuro: uma coluna
// nova escrita errada, ou algum dia montada a partir de entrada externa. Esta
// checagem roda uma vez, ao subir, e derruba o processo em vez de deixar a
// consulta quebrada chegar em producao.
function conferirIdentificadores() {
  const valido = /^[a-z_][a-z0-9_]*$/;
  const problemas: string[] = [];
  const checar = (valor: string, onde: string) => {
    if (!valido.test(valor)) problemas.push(`${onde}: ${JSON.stringify(valor)}`);
  };

  for (const [chave, colecao] of Object.entries(colecoes)) {
    checar(colecao.tabela, `${chave}.tabela`);
    colecao.camposBusca.forEach((c) => checar(c, `${chave}.camposBusca`));
    colecao.colunasCsv.forEach((c) => checar(c, `${chave}.colunasCsv`));
    colecao.colunasLista.forEach((c) => checar(c.campo, `${chave}.colunasLista`));
    colecao.camposDetalhe.forEach((c) => checar(c.campo, `${chave}.camposDetalhe`));
  }

  if (problemas.length > 0) {
    throw new Error(`Identificador de SQL invalido em colecoes -> ${problemas.join('; ')}`);
  }
}

conferirIdentificadores();

// A tela de detalhe fazia SELECT * e depois apagava arquivo_dados do objeto.
// Apagar em JS nao evita nada: o curriculo inteiro, ate 5 MB, ja veio do
// Postgres para a memoria antes disso. Aqui a coluna binaria sai da propria
// consulta. A lista vem do catalogo do banco, entao vale para qualquer coluna
// binaria que venha a existir, sem precisar manter relacao a mao.
const colunasEmCache = new Map<string, string>();

async function colunasSemBinario(tabela: string) {
  const pronta = colunasEmCache.get(tabela);
  if (pronta) return pronta;

  const linhas = await consultar<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND data_type <> 'bytea'
      ORDER BY ordinal_position`,
    [tabela]
  );
  const nomes = linhas.map((l) => l.column_name);
  // os nomes vem do catalogo, mas seguem a mesma regra dos demais
  // identificadores interpolados: se algum destoar, e melhor falhar aqui
  if (nomes.length === 0 || nomes.some((n) => !/^[a-z_][a-z0-9_]*$/.test(n))) {
    throw new Error(`Colunas inesperadas em ${tabela}`);
  }
  const lista = nomes.join(', ');
  colunasEmCache.set(tabela, lista);
  return lista;
}

async function exigirLogin(request: FastifyRequest, reply: FastifyReply) {
  const usuario = await usuarioDaRequisicao(request);
  if (!usuario) {
    return reply.redirect(`/admin/login?destino=${encodeURIComponent(request.url)}`);
  }
  request.usuario = usuario;
}

export async function rotasAdmin(app: FastifyInstance) {
  // ------------------------------------------------------------------ login
  app.get('/login', async (request, reply) => {
    const usuario = await usuarioDaRequisicao(request);
    if (usuario) return reply.redirect('/admin');
    const aviso = limpar((request.query as any)?.aviso, 120) || null;
    return reply.view('admin/login', { titulo: 'Entrar', erro: null, aviso, email: '', usuario: null });
  });

  app.post(
    '/login',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const corpo = request.body as Record<string, string>;
      const email = limpar(corpo.email, 200);
      const senha = String(corpo.senha ?? '');

      const freada = await contaEstaFreada(email);
      // Mesmo freada, a senha e conferida: parar antes economizaria os ~264ms
      // do bcrypt e devolveria a diferenca de tempo que a enumeracao explora.
      const usuario = await autenticar(email, senha);

      if (freada || !usuario) {
        // Enquanto freada nao registramos nova tentativa. Se registrasse, um
        // ataque continuo empurraria a janela para sempre e o administrador
        // legitimo nunca mais entraria - o freio viraria o proprio ataque.
        if (!freada) await registrarTentativaFalha(email, request.ip);
        await registrarAuditoria({
          acao: freada ? 'login.freado' : 'login.falhou',
          detalhes: { email },
          ip: request.ip
        });
        // Mensagem identica nos dois casos: dizer "conta bloqueada" confirmaria
        // que a conta existe.
        return reply.code(401).view('admin/login', {
          titulo: 'Entrar',
          erro: 'E-mail ou senha não conferem.',
          aviso: null,
          email,
          usuario: null
        });
      }

      await limparTentativas(email);

      await abrirSessao(reply, usuario, request.ip, String(request.headers['user-agent'] ?? ''));
      await registrarAuditoria({ usuario, acao: 'login.ok', ip: request.ip });
      const destino = limpar((request.query as any)?.destino, 200);
      return reply.redirect(destino.startsWith('/admin') ? destino : '/admin');
    }
  );

  app.post('/sair', async (request, reply) => {
    const usuario = await usuarioDaRequisicao(request);
    if (usuario) await registrarAuditoria({ usuario, acao: 'logout', ip: request.ip });
    await fecharSessao(request, reply);
    return reply.redirect('/admin/login');
  });

  // ------------------------------------------------------------- dashboard
  app.get('/', { preHandler: exigirLogin }, async (request, reply) => {
    const [contatosNovos, contatosTotal, curriculosNovos, curriculosTotal, relatosAbertos, lgpdAbertas, lgpdVencendo, consentimentos, eliminacoesComercial] =
      await Promise.all([
        contar(`SELECT count(*) AS total FROM contatos WHERE status = 'novo'`),
        contar(`SELECT count(*) AS total FROM contatos`),
        contar(`SELECT count(*) AS total FROM candidaturas WHERE status = 'novo'`),
        contar(`SELECT count(*) AS total FROM candidaturas`),
        contar(`SELECT count(*) AS total FROM relatos_integridade WHERE status IN ('recebido','em apuração')`),
        contar(`SELECT count(*) AS total FROM solicitacoes_lgpd WHERE status IN ('recebida','em análise')`),
        contar(
          `SELECT count(*) AS total FROM solicitacoes_lgpd WHERE status IN ('recebida','em análise') AND prazo_em < now() + INTERVAL '5 days'`
        ),
        contar(`SELECT count(*) AS total FROM consentimentos_cookies`),
        contarPendenciasAbertas()
      ]);

    const ultimosContatos = await consultar(
      'SELECT id, nome, email, empresa, status, criado_em FROM contatos ORDER BY criado_em DESC LIMIT 6'
    );
    const ultimasLgpd = await consultar(
      'SELECT id, protocolo, tipo, nome, status, prazo_em FROM solicitacoes_lgpd ORDER BY criado_em DESC LIMIT 6'
    );
    const serie = await consultar(
      `SELECT to_char(dia, 'DD/MM') AS rotulo, coalesce(c.total, 0) AS total
         FROM generate_series(current_date - INTERVAL '13 days', current_date, INTERVAL '1 day') AS dia
         LEFT JOIN (
           SELECT date_trunc('day', criado_em) AS d, count(*) AS total
             FROM contatos WHERE criado_em > now() - INTERVAL '14 days'
            GROUP BY 1
         ) c ON c.d = dia
        ORDER BY dia`
    );

    return reply.view('admin/dashboard', {
      titulo: 'Visão geral',
      usuario: request.usuario,
      rotaAtual: '/admin',
      metricas: {
        contatosNovos,
        contatosTotal,
        curriculosNovos,
        curriculosTotal,
        relatosAbertos,
        lgpdAbertas,
        lgpdVencendo,
        consentimentos,
        eliminacoesComercial
      },
      ultimosContatos,
      ultimasLgpd,
      serie
    });
  });

  // ------------------------------------------------------ lista da coleção
  app.get('/dados/:colecao', { preHandler: exigirLogin }, async (request, reply) => {
    const chave = (request.params as any).colecao;
    const colecao = colecoes[chave];
    if (!colecao) return reply.callNotFound();

    const query = request.query as Record<string, string>;
    const busca = limpar(query.q, 120);
    const status = limpar(query.status, 60);
    const pagina = Math.max(1, Number(query.p ?? 1) || 1);

    const condicoes: string[] = [];
    const parametros: any[] = [];

    if (busca) {
      const alvos = colecao.camposBusca.map((campo) => `coalesce(${campo}::text,'')`).join(" || ' ' || ");
      parametros.push(`%${busca}%`);
      condicoes.push(`(${alvos}) ILIKE $${parametros.length}`);
    }
    if (status && colecao.status.includes(status)) {
      parametros.push(status);
      condicoes.push(`status = $${parametros.length}`);
    }

    const onde = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
    const total = await contar(`SELECT count(*) AS total FROM ${colecao.tabela} ${onde}`, parametros);
    const campos = ['id', ...colecao.colunasLista.map((c) => c.campo)];

    const registros = await consultar(
      `SELECT ${campos.join(', ')} FROM ${colecao.tabela} ${onde} ORDER BY criado_em DESC LIMIT ${TAMANHO_PAGINA} OFFSET ${
        (pagina - 1) * TAMANHO_PAGINA
      }`,
      parametros
    );

    return reply.view('admin/lista', {
      titulo: colecao.rotulo,
      usuario: request.usuario,
      rotaAtual: `/admin/dados/${chave}`,
      colecao,
      registros,
      total,
      pagina,
      paginas: Math.max(1, Math.ceil(total / TAMANHO_PAGINA)),
      busca,
      status
    });
  });

  // ----------------------------------------------------- detalhe do registro
  app.get('/dados/:colecao/:id', { preHandler: exigirLogin }, async (request, reply) => {
    const { colecao: chave, id } = request.params as any;
    const colecao = colecoes[chave];
    if (!colecao) return reply.callNotFound();

    const registro = await consultarUm(
      `SELECT ${await colunasSemBinario(colecao.tabela)} FROM ${colecao.tabela} WHERE id = $1`,
      [id]
    );
    if (!registro) return reply.callNotFound();

    return reply.view('admin/detalhe', {
      titulo: `${colecao.singular} · ${String(registro.protocolo ?? registro.nome ?? id).slice(0, 40)}`,
      usuario: request.usuario,
      rotaAtual: `/admin/dados/${chave}`,
      colecao,
      registro
    });
  });

  // atualizar status / observação / resposta
  app.post('/dados/:colecao/:id', { preHandler: exigirLogin }, async (request, reply) => {
    const { colecao: chave, id } = request.params as any;
    const colecao = colecoes[chave];
    if (!colecao) return reply.callNotFound();

    const corpo = request.body as Record<string, string>;
    const novoStatus = limpar(corpo.status, 60);
    const atualizacoes: string[] = [];
    const parametros: any[] = [];

    if (colecao.status.includes(novoStatus)) {
      parametros.push(novoStatus);
      atualizacoes.push(`status = $${parametros.length}`);
    }
    if (typeof corpo.observacao === 'string' && ['contatos', 'candidaturas'].includes(chave)) {
      parametros.push(limpar(corpo.observacao, 4000));
      atualizacoes.push(`observacao = $${parametros.length}`);
    }
    if (typeof corpo.resposta === 'string' && ['lgpd', 'relatos'].includes(chave)) {
      parametros.push(limpar(corpo.resposta, 8000));
      atualizacoes.push(`resposta = $${parametros.length}`);
    }
    if (chave === 'lgpd' && ['atendida', 'recusada'].includes(novoStatus)) {
      atualizacoes.push('respondida_em = now()');
    }

    if (atualizacoes.length > 0) {
      parametros.push(id);
      await consultar(
        `UPDATE ${colecao.tabela} SET ${atualizacoes.join(', ')}${
          chave === 'consentimentos' ? '' : ', atualizado_em = now()'
        } WHERE id = $${parametros.length}`,
        parametros
      );
      await registrarAuditoria({
        usuario: request.usuario,
        acao: 'registro.atualizado',
        entidade: colecao.tabela,
        entidadeId: id,
        detalhes: { status: novoStatus },
        ip: request.ip
      });
    }

    return reply.redirect(`/admin/dados/${chave}/${id}`);
  });

  // excluir registro (direito de eliminação da LGPD)
  app.post('/dados/:colecao/:id/excluir', { preHandler: exigirLogin }, async (request, reply) => {
    const { colecao: chave, id } = request.params as any;
    const colecao = colecoes[chave];
    if (!colecao) return reply.callNotFound();
    if (request.usuario?.papel !== 'admin') return reply.code(403).send('Só administradores podem excluir.');

    // Contato: a exclusão passa por transação que informa quem pediu; se o lead já foi entregue ao Comercial, o banco
    // registra a pendência para confirmação pelo Comercial. Ver eliminacao-comercial.ts.
    let leadEntregue = false;
    if (colecao.tabela === 'contatos') {
      leadEntregue = (await excluirContatoPeloPainel(id, request.usuario.id)).leadEntregue;
    } else {
      await consultar(`DELETE FROM ${colecao.tabela} WHERE id = $1`, [id]);
    }
    await registrarAuditoria({
      usuario: request.usuario,
      acao: 'registro.excluido',
      entidade: colecao.tabela,
      entidadeId: id,
      detalhes: leadEntregue ? { pendenciaEliminacaoComercial: true } : undefined,
      ip: request.ip
    });
    if (leadEntregue) return reply.redirect('/admin/eliminacoes-comercial?novo=1');
    return reply.redirect(`/admin/dados/${chave}`);
  });

  // download do currículo
  app.get('/dados/candidaturas/:id/arquivo', { preHandler: exigirLogin }, async (request, reply) => {
    const { id } = request.params as any;
    const registro = await consultarUm<{ arquivo_nome: string; arquivo_tipo: string; arquivo_dados: Buffer }>(
      'SELECT arquivo_nome, arquivo_tipo, arquivo_dados FROM candidaturas WHERE id = $1',
      [id]
    );
    if (!registro?.arquivo_dados) return reply.callNotFound();

    await registrarAuditoria({
      usuario: request.usuario,
      acao: 'curriculo.baixado',
      entidade: 'candidaturas',
      entidadeId: id,
      ip: request.ip
    });

    reply.header('Content-Type', registro.arquivo_tipo || 'application/octet-stream');
    reply.header('Content-Disposition', cabecalhoAnexo(registro.arquivo_nome));
    return reply.send(registro.arquivo_dados);
  });

  // exportar CSV
  app.get('/dados/:colecao/exportar.csv', { preHandler: exigirLogin }, async (request, reply) => {
    const chave = (request.params as any).colecao;
    const colecao = colecoes[chave];
    if (!colecao) return reply.callNotFound();

    const linhas = await consultar(
      `SELECT ${colecao.colunasCsv.join(', ')} FROM ${colecao.tabela} ORDER BY criado_em DESC LIMIT 5000`
    );
    await registrarAuditoria({
      usuario: request.usuario,
      acao: 'dados.exportados',
      entidade: colecao.tabela,
      detalhes: { linhas: linhas.length },
      ip: request.ip
    });

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${chave}-${new Date().toISOString().slice(0, 10)}.csv"`);
    return reply.send('\uFEFF' + paraCsv(linhas));
  });

  // ------------------------------------------------ eliminação no Comercial
  // Leads já entregues ao Comercial de contatos que o site apagou (LGPD/retenção).
  app.get('/eliminacoes-comercial', { preHandler: exigirLogin }, async (request, reply) => {
    const { novo, resultado } = request.query as { novo?: string; resultado?: string };
    return reply.view('admin/eliminacoes-comercial', {
      titulo: 'Eliminações no Comercial',
      usuario: request.usuario,
      rotaAtual: '/admin/eliminacoes-comercial',
      pendencias: await listarPendencias(),
      aviso: novo === '1' ? 'novo' : resultado
    });
  });

  app.post('/eliminacoes-comercial/:id/concluir', { preHandler: exigirLogin }, async (request, reply) => {
    if (request.usuario?.papel !== 'admin') return reply.code(403).send('Só administradores podem concluir.');
    const origem = request.headers['sec-fetch-site'];
    if (origem && origem !== 'same-origin' && origem !== 'none') return reply.code(403).send('Origem da requisição inválida.');
    const { id } = request.params as { id: string };
    const cfg = configComercial();
    const resultado = await concluirPendencia(id, request.usuario, cfg ? transporteMtls(cfg) : undefined, request.ip);
    if (resultado === 'nao_encontrada') return reply.callNotFound();
    return reply.redirect('/admin/eliminacoes-comercial?resultado=' + resultado);
  });

  // ------------------------------------------------------------- auditoria
  app.get('/auditoria', { preHandler: exigirLogin }, async (request, reply) => {
    const pagina = Math.max(1, Number((request.query as any).p ?? 1) || 1);
    const total = await contar('SELECT count(*) AS total FROM auditoria');
    const registros = await consultar(
      `SELECT id, usuario_email, acao, entidade, entidade_id, detalhes, ip, criado_em
         FROM auditoria ORDER BY criado_em DESC LIMIT 50 OFFSET ${(pagina - 1) * 50}`
    );
    return reply.view('admin/auditoria', {
      titulo: 'Trilha de auditoria',
      usuario: request.usuario,
      rotaAtual: '/admin/auditoria',
      registros,
      pagina,
      paginas: Math.max(1, Math.ceil(total / 50))
    });
  });

  // -------------------------------------------------------------- usuários
  app.get('/usuarios', { preHandler: exigirLogin }, async (request, reply) => {
    const usuarios = await consultar(
      'SELECT id, nome, email, papel, ativo, ultimo_acesso, criado_em FROM admin_usuarios ORDER BY criado_em'
    );
    return reply.view('admin/usuarios', {
      titulo: 'Usuários do painel',
      usuario: request.usuario,
      rotaAtual: '/admin/usuarios',
      usuarios,
      erro: null,
      aviso: limpar((request.query as any).aviso, 120) || null
    });
  });

  // Nao havia como trocar a propria senha: a inicial vinha de ADMIN_PASSWORD e
  // so mudava mexendo no banco. Exige a senha atual para que uma sessao roubada
  // nao consiga tomar a conta.
  app.post('/minha-senha', { preHandler: exigirLogin }, async (request, reply) => {
    const corpo = request.body as Record<string, string>;
    const atual = String(corpo.senhaAtual ?? '');
    const nova = String(corpo.senhaNova ?? '');
    const repetida = String(corpo.senhaRepetida ?? '');

    let erro: string | null = null;
    if (!(await autenticar(request.usuario!.email, atual))) erro = 'A senha atual não confere.';
    else if (nova.length < 10) erro = 'A nova senha precisa de pelo menos 10 caracteres.';
    else if (nova !== repetida) erro = 'A confirmação não bate com a nova senha.';
    else if (nova === atual) erro = 'A nova senha precisa ser diferente da atual.';

    if (erro) {
      const usuarios = await consultar(
        'SELECT id, nome, email, papel, ativo, ultimo_acesso, criado_em FROM admin_usuarios ORDER BY criado_em'
      );
      return reply.code(400).view('admin/usuarios', {
        titulo: 'Usuários do painel',
        usuario: request.usuario,
        rotaAtual: '/admin/usuarios',
        usuarios,
        erro,
        aviso: null
      });
    }

    await consultar('UPDATE admin_usuarios SET senha_hash = $1 WHERE id = $2', [
      await gerarHashSenha(nova),
      request.usuario!.id
    ]);
    // derruba as outras sessoes: trocar a senha tem de expulsar quem estava dentro
    await consultar('DELETE FROM admin_sessoes WHERE usuario_id = $1', [request.usuario!.id]);
    await registrarAuditoria({ usuario: request.usuario!, acao: 'senha.alterada', ip: request.ip });
    return reply.redirect('/admin/login?aviso=Senha+alterada.+Entre+de+novo.');
  });

  app.post('/usuarios', { preHandler: exigirLogin }, async (request, reply) => {
    if (request.usuario?.papel !== 'admin') return reply.code(403).send('Só administradores podem criar usuários.');
    const corpo = request.body as Record<string, string>;
    const nome = limpar(corpo.nome, 120);
    const email = limpar(corpo.email, 200);
    const senha = String(corpo.senha ?? '');
    const papel = corpo.papel === 'admin' ? 'admin' : 'editor';

    const usuarios = await consultar(
      'SELECT id, nome, email, papel, ativo, ultimo_acesso, criado_em FROM admin_usuarios ORDER BY criado_em'
    );

    let erro: string | null = null;
    if (!nome) erro = 'Escreva o nome.';
    else if (!emailValido(email)) erro = 'Confira o e-mail.';
    else if (senha.length < 10) erro = 'A senha precisa de pelo menos 10 caracteres.';

    if (erro) {
      return reply.code(400).view('admin/usuarios', {
        titulo: 'Usuários do painel',
        usuario: request.usuario,
        rotaAtual: '/admin/usuarios',
        usuarios,
        erro,
        aviso: null
      });
    }

    const hash = await gerarHashSenha(senha);
    await consultar('INSERT INTO admin_usuarios (nome, email, senha_hash, papel) VALUES ($1,$2,$3,$4)', [
      nome,
      email,
      hash,
      papel
    ]);
    await registrarAuditoria({
      usuario: request.usuario,
      acao: 'usuario.criado',
      entidade: 'admin_usuarios',
      detalhes: { email, papel },
      ip: request.ip
    });
    return reply.redirect('/admin/usuarios?aviso=Usuário criado');
  });

  app.post('/usuarios/:id/alternar', { preHandler: exigirLogin }, async (request, reply) => {
    if (request.usuario?.papel !== 'admin') return reply.code(403).send('Só administradores podem fazer isso.');
    const { id } = request.params as any;
    if (id === request.usuario.id) return reply.redirect('/admin/usuarios?aviso=Você não pode desativar a si mesmo');
    await consultar('UPDATE admin_usuarios SET ativo = NOT ativo WHERE id = $1', [id]);
    await registrarAuditoria({
      usuario: request.usuario,
      acao: 'usuario.alternado',
      entidade: 'admin_usuarios',
      entidadeId: id,
      ip: request.ip
    });
    return reply.redirect('/admin/usuarios?aviso=Acesso atualizado');
  });
}
