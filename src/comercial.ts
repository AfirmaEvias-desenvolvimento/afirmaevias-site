// Conexão 1 do hipersistema (C12): o site (identidade institucional-api) entrega o pedido de contato/orçamento como
// LEAD ao Comercial, por mTLS. O Comercial nunca chama o site, e o site funciona sozinho se o Comercial estiver fora:
// o lead nasce numa fila no banco (comercial-fila.ts) e este módulo só sabe falar com o destino.
//
// Desligado por padrão: só existe com COMERCIAL_API_URL (https) + COMERCIAL_MTLS_CA/CERT/KEY legíveis. Este arquivo não
// importa config nem banco de propósito, para o teste usá-lo sem DATABASE_URL.
//
// LGPD: o corpo leva SÓ os campos do contrato (empresa, CNPJ, contato, serviço de interesse, mensagem, versão do
// aviso aceito) e nada de IP/navegador. Nenhum dado pessoal vai para log: só código, status HTTP e id da fila.
import https from 'node:https';
import { readFileSync } from 'node:fs';

export const LEAD_PATH = '/api/integracao/v1/comercial/leads';
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{1,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Corpo ESTRITO do contrato do Comercial HS (server/src/routes/leads.ts): chave a mais é recusada lá. */
export type CorpoLead = {
  empresa: string;
  cnpj?: string;
  contato: { nome: string; email: string; telefone?: string };
  servico_interesse?: string;
  mensagem?: string;
  privacy_version: string;
};

export type ContatoParaLead = {
  nome: string;
  sobrenome?: string | null;
  email: string;
  telefone?: string | null;
  empresa?: string | null;
  cnpj?: string | null;
  assunto?: string | null;
  mensagem: string;
};

/** Idempotency-Key estável: o mesmo contato gera sempre a mesma chave, em qualquer retentativa. */
export const chaveDoContato = (contatoId: string) => `site-contato:${contatoId}`;

/** "12345678000195" -> "12.345.678/0001-95". Só aceita 14 dígitos; qualquer outra coisa vira "sem CNPJ". */
export function formatarCnpj(valor: string | null | undefined) {
  const d = String(valor ?? '').replace(/\D/g, '');
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : undefined;
}

const aparar = (v: string | null | undefined, max: number) => String(v ?? '').trim().slice(0, max);

/**
 * Monta o corpo do contrato a partir do contato gravado. Empresa em branco (pessoa física ou quem não preencheu) usa o
 * nome da pessoa: o contrato exige `empresa`, e é um dado que a própria pessoa informou. Mensagem acima do limite do
 * Comercial (4000) é cortada aqui; o texto inteiro continua no /admin do site.
 */
export function montarCorpoLead(c: ContatoParaLead, privacidadeVersao: string): CorpoLead {
  const nome = aparar(`${c.nome} ${c.sobrenome ?? ''}`.replace(/\s+/g, ' '), 120);
  const corpo: CorpoLead = {
    empresa: aparar(c.empresa, 200) || nome,
    contato: { nome, email: aparar(c.email, 200) },
    privacy_version: aparar(privacidadeVersao, 40)
  };
  const cnpj = formatarCnpj(c.cnpj);
  if (cnpj) corpo.cnpj = cnpj;
  const telefone = aparar(c.telefone, 40);
  if (telefone) corpo.contato.telefone = telefone;
  const servico = aparar(c.assunto, 200);
  if (servico) corpo.servico_interesse = servico;
  const mensagem = aparar(c.mensagem, 4000);
  if (mensagem) corpo.mensagem = mensagem;
  return corpo;
}

export type Resultado = {
  /** enviado: entregue (200/201/202); pendente: tentar de novo; rejeitado: não adianta repetir */
  status: 'enviado' | 'pendente' | 'rejeitado';
  codigo: string;
  /** vale registrar no log como alerta (credencial/permissão/chave divergente) */
  alerta?: boolean;
  /** recuo mais longo (credencial/permissão: espera correção humana) */
  lento?: boolean;
};

/**
 * 201 recebido, 200 repetição idempotente e 202 "em análise" são todos entrega feita (202 NÃO é erro: o Comercial
 * guardou o lead e decide a empresa à mão). 409 = chave já usada com outro conteúdo: não se repete (defeito).
 * 401/403 esperam correção humana. 5xx, 408, 429 e falha de rede repetem.
 */
export function classificar(status: number | null): Resultado {
  if (status === 200 || status === 201 || status === 202) return { status: 'enviado', codigo: 'ok' };
  if (status === null || status >= 500 || status === 408 || status === 429) return { status: 'pendente', codigo: 'indisponivel' };
  if (status === 401 || status === 403) return { status: 'pendente', codigo: 'credencial', alerta: true, lento: true };
  if (status === 409) return { status: 'rejeitado', codigo: 'chave_conflitante', alerta: true };
  return { status: 'rejeitado', codigo: status === 400 || status === 422 ? 'malformado' : `http_${status}`, alerta: true };
}

/** Segundos até a próxima tentativa: exponencial com teto e jitter; credencial usa piso/teto maiores. */
export function recuoSegundos(tentativas: number, lento = false, aleatorio = Math.random()) {
  const base = lento ? 900 : 5;
  const teto = lento ? 3600 : 900;
  return Math.min(teto, base * 2 ** Math.min(tentativas, 12)) * (1 + aleatorio * 0.2);
}

export type ConfigComercial = { url: URL; ca: Buffer; cert: Buffer; key: Buffer };

/**
 * Lê a configuração do ambiente. Devolve null quando a integração está desligada (sem COMERCIAL_API_URL) e também
 * quando está mal configurada (URL não-https, certificado ilegível): o site segue funcionando e o erro vai ao log
 * uma vez. Nunca lança, porque o site não pode cair por causa de uma integração opcional.
 */
export function lerConfigComercial(env: NodeJS.ProcessEnv = process.env, aviso: (m: string) => void = console.warn): ConfigComercial | null {
  const bruto = env.COMERCIAL_API_URL?.trim();
  if (!bruto) return null;
  try {
    const url = new URL(bruto);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('COMERCIAL_API_URL exige https sem credenciais');
    const ler = (nome: string) => {
      const caminho = env[`COMERCIAL_MTLS_${nome}`];
      if (!caminho) throw new Error(`COMERCIAL_MTLS_${nome} ausente`);
      return readFileSync(caminho);
    };
    return { url, ca: ler('CA'), cert: ler('CERT'), key: ler('KEY') };
  } catch (falha) {
    aviso(`integração com o Comercial desligada: ${falha instanceof Error ? falha.message : 'configuração inválida'}`);
    return null;
  }
}

export type RespostaHttp = { status: number | null; corpo?: any };
export type Transporte = (metodo: 'GET' | 'POST' | 'DELETE', caminho: string, corpo?: unknown, chave?: string) => Promise<RespostaHttp>;

/** Transporte mTLS (identidade institucional-api). Nunca lança: falha de rede/timeout vira { status: null }. */
export function transporteMtls(cfg: ConfigComercial, timeoutMs = 10_000): Transporte {
  return (metodo, caminho, corpo, chave) =>
    new Promise((resolver) => {
      try {
      const conteudo = corpo === undefined ? undefined : JSON.stringify(corpo);
      const req = https.request(
        new URL(caminho, cfg.url),
        {
          ca: cfg.ca,
          cert: cfg.cert,
          key: cfg.key,
          rejectUnauthorized: true,
          method: metodo,
          agent: false,
          headers: {
            accept: 'application/json',
            ...(conteudo === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(conteudo) }),
            ...(chave ? { 'idempotency-key': chave } : {})
          }
        },
        (res) => {
          const partes: Buffer[] = [];
          res.on('data', (p: Buffer) => partes.push(p));
          res.on('end', () => {
            let analisado: any;
            try {
              analisado = JSON.parse(Buffer.concat(partes).toString('utf8'));
            } catch {
              analisado = undefined;
            }
            resolver({ status: res.statusCode ?? null, corpo: analisado });
          });
          res.on('error', () => resolver({ status: null }));
        }
      );
      const prazo = setTimeout(() => req.destroy(), timeoutMs);
      req.once('close', () => clearTimeout(prazo));
      req.on('error', () => resolver({ status: null }));
      req.end(conteudo);
      } catch {
        // certificado/chave ilegível: tratado como destino indisponível, nunca derruba o site
        resolver({ status: null });
      }
    });
}

/** comercial.lead.create: entrega o lead. Devolve o resultado classificado e o que o Comercial respondeu (id e estado). */
export async function enviarLead(transporte: Transporte, corpo: CorpoLead, chave: string) {
  const r = await transporte('POST', LEAD_PATH, corpo, chave);
  const lead_id = typeof r.corpo?.lead_id === 'string' && UUID.test(r.corpo.lead_id) ? r.corpo.lead_id : null;
  const estado = typeof r.corpo?.status === 'string' ? r.corpo.status.slice(0, 40) : null;
  return { http: r.status, ...classificar(r.status), lead_id, estado };
}

/** comercial.lead.read: o site só enxerga o ESTADO do pedido (nada de cliente, proposta ou preço). */
export async function lerEstadoLead(transporte: Transporte, leadId: string) {
  if (!UUID.test(leadId)) return { http: 0, estado: null as string | null };
  const r = await transporte('GET', `${LEAD_PATH}/${leadId}`);
  return { http: r.status, estado: r.status === 200 && typeof r.corpo?.state === 'string' ? (r.corpo.state as string) : null };
}

/** O Comercial devolve 204 também quando a eliminação já foi aplicada. */
export async function eliminarLead(transporte: Transporte, leadId: string) {
  if (!UUID.test(leadId)) return 'nao_confirmada';
  const resposta = await transporte('DELETE', `${LEAD_PATH}/${leadId}`);
  if (resposta.status === 204) return 'concluida';
  if (resposta.status === 409 && resposta.corpo?.code === 'lead_linked') return 'vinculada';
  return 'nao_confirmada';
}
