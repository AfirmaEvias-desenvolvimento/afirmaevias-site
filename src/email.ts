// Único ponto de envio de e-mail do Site: SDK oficial do Resend (API HTTPS, nenhum outro transporte).
// Lê RESEND_API_KEY e EMAIL_FROM do ambiente a cada envio. EMAIL_FROM é o ÚNICO remetente: não existe remetente
// fixo no código nem por quem chama. Sem uma das duas variáveis nada sai e o resultado é 'nao_configurado'; quem
// chama mantém a própria semântica (a fila de avisos, src/notificacoes.ts, deixa tudo no banco).
// A chave nunca vai para log, erro ou resultado: o que vem do Resend passa por semSegredos().
import { Resend, type CreateEmailOptions } from 'resend';

/** Anexo: `conteudo` em bytes (Buffer) ou já em base64 (string), como a API do Resend espera. */
export type Anexo = { nome: string; conteudo: Buffer | string; tipo?: string };
export type Mensagem = {
  para: string | string[];
  assunto: string;
  responderPara?: string | string[];
  anexos?: Anexo[];
} & ({ html: string; texto?: string } | { html?: string; texto: string });
export type ErroEmail = { nome: string; status: number | null; mensagem: string };
export type ResultadoEmail =
  | { ok: true; id: string }
  | { ok: false; motivo: 'nao_configurado'; faltando: string[] }
  | { ok: false; motivo: 'erro_resend'; erro: ErroEmail };
export type OpcoesEnvio = {
  /** Idempotency-Key do Resend: a mesma chave numa retentativa não duplica o e-mail (dentro da janela do provedor). */
  idempotencia?: string;
  /** Prazo da chamada HTTP ao Resend; padrão 8 s. */
  tempoLimiteMs?: number;
  /** Identificador técnico para o log (ex.: "aviso:<id da fila>"), sem dado pessoal. */
  ref?: string;
  /** Só para testes: endereço de uma API falsa local no lugar da API oficial do Resend. */
  baseUrl?: string;
};
export type EnviarEmail = (mensagem: Mensagem, opcoes?: OpcoesEnvio) => Promise<ResultadoEmail>;

const TEMPO_LIMITE_PADRAO = 8000;
const ler = (env: NodeJS.ProcessEnv, nome: string) => (env[nome] ?? '').trim();

/** Diz se o envio está ligado e, se não, quais variáveis faltam (só nomes; nunca devolve a chave). */
export function configuracaoEmail(env: NodeJS.ProcessEnv = process.env): { configurado: boolean; faltando: string[] } {
  const faltando = ['RESEND_API_KEY', 'EMAIL_FROM'].filter((nome) => !ler(env, nome));
  return { configurado: faltando.length === 0, faltando };
}

/** Tira a chave (e qualquer coisa com cara de credencial do Resend) de um texto que vai para log ou erro. */
export function semSegredos(texto: string, chave = ler(process.env, 'RESEND_API_KEY')): string {
  let limpo = String(texto ?? '')
    .replace(/authorization["']?\s*[:=]\s*["']?[^"',;})\]\s]+(\s+[^"',;})\]\s]+)?/gi, '[credencial removida]')
    .replace(/bearer\s+[^"',;})\]\s]+/gi, '[credencial removida]');
  if (chave) limpo = limpo.split(chave).join('[chave removida]');
  return limpo.replace(/\bre_[A-Za-z0-9_-]{6,}/g, '[chave removida]').slice(0, 300);
}

export const enviarEmail: EnviarEmail = async (mensagem, opcoes = {}) => {
  const { configurado, faltando } = configuracaoEmail();
  if (!configurado) return { ok: false, motivo: 'nao_configurado', faltando };
  const chave = ler(process.env, 'RESEND_API_KEY');
  const tempoLimite = opcoes.tempoLimiteMs ?? TEMPO_LIMITE_PADRAO;
  const sinal = AbortSignal.timeout(tempoLimite);
  const corpo = {
    from: ler(process.env, 'EMAIL_FROM'),
    to: mensagem.para,
    subject: mensagem.assunto,
    html: mensagem.html,
    text: mensagem.texto,
    replyTo: mensagem.responderPara,
    attachments: mensagem.anexos?.length
      ? mensagem.anexos.map((a) => ({ filename: a.nome, content: a.conteudo, contentType: a.tipo }))
      : undefined
  } as CreateEmailOptions;
  let erro: ErroEmail;
  try {
    const resend = new Resend(chave, opcoes.baseUrl ? { baseUrl: opcoes.baseUrl } : undefined);
    const { data, error } = await resend.emails.send(corpo, { idempotencyKey: opcoes.idempotencia, signal: sinal });
    if (!error && data?.id) return { ok: true, id: data.id };
    erro = error
      ? { nome: String(error.name || 'erro_resend'), status: error.statusCode ?? null, mensagem: semSegredos(error.message, chave) }
      : { nome: 'resposta_sem_id', status: null, mensagem: 'O Resend respondeu sem o id da mensagem.' };
  } catch (e) {
    erro = { nome: e instanceof Error ? e.name : 'desconhecido', status: null, mensagem: semSegredos(e instanceof Error ? e.message : String(e), chave) };
  }
  if (sinal.aborted) erro = { nome: 'tempo_esgotado', status: null, mensagem: `Sem resposta do Resend em ${tempoLimite} ms.` };
  console.error(JSON.stringify({ codigo: 'email_falhou', ...(opcoes.ref ? { ref: opcoes.ref } : {}), erro: erro.nome, status: erro.status, mensagem: erro.mensagem }));
  return { ok: false, motivo: 'erro_resend', erro };
};
