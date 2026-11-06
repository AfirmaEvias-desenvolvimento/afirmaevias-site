// Fila de saída dos leads para o Comercial (conexão 1). A linha da fila nasce NA MESMA instrução SQL que grava o
// contato (ver routes/forms.ts), então não existe contato sem fila quando a integração está ligada. Aqui só se
// envia, com recuo exponencial; o corpo é montado do contato no momento do envio (a fila não duplica dado pessoal).
import { consultar } from './db.js';
import {
  chaveDoContato,
  enviarLead,
  lerConfigComercial,
  montarCorpoLead,
  recuoSegundos,
  transporteMtls,
  type ConfigComercial,
  type Transporte
} from './comercial.js';

let cfg: ConfigComercial | null | undefined;
/** Configuração lida uma vez (e o aviso de má configuração sai uma vez só). */
export function configComercial() {
  if (cfg === undefined) cfg = lerConfigComercial();
  return cfg;
}
export const comercialLigado = () => configComercial() !== null;
export { chaveDoContato };

let emAndamento = false;

/**
 * Uma rodada: reivindica as pendências vencidas (a "reserva" de 2 min impede duas rodadas/instâncias de enviarem a
 * mesma linha), envia cada uma e grava o resultado. Nunca lança. Sem integração ligada não faz nada.
 */
export async function processarFilaComercial(limite = 20, transporte?: Transporte) {
  const resumo = { enviado: 0, pendente: 0, rejeitado: 0 };
  const c = configComercial();
  if (!c || emAndamento) return resumo;
  emAndamento = true;
  try {
    const enviar = transporte ?? transporteMtls(c);
    const linhas = await consultar<{ id: string; contato_id: string; chave: string; privacidade_versao: string; tentativas: number }>(
      `UPDATE leads_comercial SET proxima_tentativa = now() + interval '2 minutes'
        WHERE id IN (SELECT id FROM leads_comercial WHERE status = 'pendente' AND proxima_tentativa <= now()
                      ORDER BY criado_em LIMIT $1 FOR UPDATE SKIP LOCKED)
        RETURNING id, contato_id, chave, privacidade_versao, tentativas`,
      [limite]
    );
    for (const linha of linhas) {
      try {
        const [contato] = await consultar(
          'SELECT nome, sobrenome, email, telefone, empresa, cnpj, assunto, mensagem FROM contatos WHERE id = $1',
          [linha.contato_id]
        );
        // contato apagado (retenção/LGPD) entre a reserva e o envio: nada a entregar
        if (!contato) {
          await consultar('DELETE FROM leads_comercial WHERE id = $1', [linha.id]);
          continue;
        }
        const r = await enviarLead(enviar, montarCorpoLead(contato, linha.privacidade_versao), linha.chave);
        // sem dado pessoal no log: só o que identifica a linha da fila e o motivo
        if (r.alerta) console.error(JSON.stringify({ codigo: `comercial_lead_${r.codigo}`, http: r.http, fila: linha.id }));
        const tentativas = linha.tentativas + 1;
        await consultar(
          `UPDATE leads_comercial SET status = $2, tentativas = $3, ultimo_http = $4, ultimo_codigo = $5,
                  lead_id = COALESCE($6, lead_id), estado = COALESCE($7, estado),
                  enviado_em = CASE WHEN $2 = 'enviado' THEN now() ELSE enviado_em END,
                  proxima_tentativa = CASE WHEN $2 = 'pendente' THEN now() + $8 * interval '1 second' ELSE proxima_tentativa END,
                  atualizado_em = now()
            WHERE id = $1`,
          [linha.id, r.status, tentativas, r.http, r.codigo, r.lead_id, r.estado, recuoSegundos(tentativas, r.lento)]
        );
        resumo[r.status]++;
      } catch (falha) {
        // erro de banco numa linha não derruba as outras; a reserva de 2 min a recoloca na fila sozinha
        console.error(JSON.stringify({ codigo: 'comercial_fila_erro', fila: linha.id, erro: falha instanceof Error ? falha.name : 'desconhecido' }));
      }
    }
  } catch (falha) {
    console.error(JSON.stringify({ codigo: 'comercial_fila_erro', erro: falha instanceof Error ? falha.name : 'desconhecido' }));
  } finally {
    emAndamento = false;
  }
  return resumo;
}

/** Liga a rodada periódica (e uma ao subir). Sem integração ligada não agenda nada. */
export function iniciarFilaComercial() {
  if (!comercialLigado()) return;
  const intervalo = Math.max(1000, Number(process.env.COMERCIAL_FILA_INTERVALO_MS) || 60_000);
  setInterval(() => void processarFilaComercial(), intervalo).unref();
  void processarFilaComercial();
}
