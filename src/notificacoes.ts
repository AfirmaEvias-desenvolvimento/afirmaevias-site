// Fila persistente: o banco grava o aviso na mesma transação do formulário.
// O corpo nunca copia nome, mensagem, currículo ou dados do titular.
// O envio sai só pelo módulo de e-mail (src/email.ts: SDK do Resend, remetente EMAIL_FROM).
import { pool } from './db.js';
import { config, producao } from './config.js';
import { configuracaoEmail, enviarEmail, type EnviarEmail } from './email.js';

type Tipo = 'contato' | 'candidatura' | 'relato' | 'lgpd';
const modelos: Record<Tipo, { assunto: string; caminho: string; destino: string }> = {
  contato: { assunto: 'Novo contato recebido pelo site', caminho: '/admin/dados/contatos', destino: 'EMAIL_CONTATO' },
  candidatura: { assunto: 'Novo currículo recebido pelo site', caminho: '/admin/dados/candidaturas', destino: 'EMAIL_RH' },
  relato: { assunto: 'Novo relato de integridade recebido', caminho: '/admin/dados/relatos', destino: 'EMAIL_COMPLIANCE' },
  lgpd: { assunto: 'Novo pedido LGPD recebido', caminho: '/admin/dados/lgpd', destino: 'EMAIL_ENCARREGADO' }
};
const destinosPadrao: Record<Tipo, string> = {
  contato: 'comercial@afirmaevias.com.br', candidatura: 'comercial@afirmaevias.com.br',
  relato: 'comercial@afirmaevias.com.br', lgpd: 'privacidade@afirmaevias.com.br'
};
type Linha = { id: string; tipo: Tipo; tentativas: number; reserva: string };
type Banco = { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> };
let rodando = false;

// Uma reserva por vez, com SKIP LOCKED e expiração, permite vários processos e recuperação após queda.
// Sem RESEND_API_KEY ou EMAIL_FROM não reserva nada: os avisos ficam na fila até o envio ser configurado.
export async function processarFilaAvisos(banco: Banco = pool, enviar: EnviarEmail = enviarEmail) {
  if (!configuracaoEmail().configurado || rodando) return;
  rodando = true;
  try {
    for (let i = 0; i < 20; i++) {
      const { rows } = await banco.query(`UPDATE avisos_email_fila SET reserva = gen_random_uuid(),
        proxima_tentativa = now() + interval '2 minutes' WHERE id = (
          SELECT id FROM avisos_email_fila WHERE proxima_tentativa <= now()
          ORDER BY criado_em LIMIT 1 FOR UPDATE SKIP LOCKED
        ) RETURNING id, tipo, tentativas, reserva`);
      const aviso = rows[0] as Linha | undefined;
      if (!aviso) break;
      const modelo = modelos[aviso.tipo];
      // Só códigos técnicos vão para o log: o nome do erro do Resend (o detalhe sem a chave já saiu em email_falhou).
      let motivo = 'excecao_no_envio';
      try {
        const resultado = await enviar({
          para: [process.env[modelo.destino] ?? destinosPadrao[aviso.tipo]],
          assunto: producao ? modelo.assunto : `[teste] ${modelo.assunto}`,
          html: `<p>Há um novo registro. Consulte o painel com acesso controlado.</p><p><a href="${config.siteUrl.replace(/\/$/, '')}${modelo.caminho}">Abrir no painel</a></p>`
        }, { idempotencia: `site-aviso/${aviso.id}`, ref: `aviso:${aviso.id}` });
        if (!resultado.ok) {
          motivo = resultado.motivo === 'erro_resend' ? resultado.erro.nome : resultado.motivo;
          throw new Error(motivo);
        }
        motivo = 'erro_ao_baixar_da_fila';
        await banco.query('DELETE FROM avisos_email_fila WHERE id = $1 AND reserva = $2', [aviso.id, aviso.reserva]);
      } catch {
        const tentativas = aviso.tentativas + 1;
        const espera = Math.min(3600, 30 * 2 ** Math.min(tentativas - 1, 7));
        await banco.query(`UPDATE avisos_email_fila SET tentativas = $3, reserva = NULL,
          proxima_tentativa = now() + $4 * interval '1 second' WHERE id = $1 AND reserva = $2`,
          [aviso.id, aviso.reserva, tentativas, espera]);
        console.error(JSON.stringify({ codigo: 'aviso_email_falhou', fila: aviso.id, tentativas, erro: motivo }));
      }
    }
  } catch (erro) {
    console.error(JSON.stringify({ codigo: 'aviso_email_fila_erro', erro: erro instanceof Error ? erro.name : 'desconhecido' }));
  } finally { rodando = false; }
}

export function iniciarFilaAvisos() {
  const { configurado, faltando } = configuracaoEmail();
  if (!configurado) {
    console.warn(`E-mail desligado (falta ${faltando.join(' e ')}): os avisos ficam na fila do banco até configurar o envio e reiniciar`);
    return;
  }
  const intervalo = Math.max(1000, Number(process.env.AVISOS_FILA_INTERVALO_MS) || 60_000);
  setInterval(() => void processarFilaAvisos(), intervalo).unref();
  void processarFilaAvisos();
}
