// Eliminação LGPD x lead já entregue ao Comercial (conexão 1, C12).
//
// O contrato do Comercial só tem comercial.lead.create/read: NÃO existe exclusão. Então, quando o site apaga um contato
// cujo lead já foi entregue, o lead continua lá e alguém do Comercial precisa eliminá-lo pelo painel dele. Este módulo
// guarda essa obrigação como PENDÊNCIA (tabela eliminacoes_comercial, sem dado pessoal) e a lista no /admin.
//
// A pendência nasce no banco, num gatilho BEFORE DELETE em `contatos` (db/schema.sql), não aqui: assim vale para qualquer
// caminho que apague o contato (painel, retenção de 24 meses, SQL manual) e sempre na mesma transação do DELETE.
import type { PoolClient } from 'pg';
import { pool, consultar, consultarUm, contar } from './db.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Pendencia = {
  id: string;
  lead_id: string;
  pedido_em: Date;
  origem: 'painel' | 'retencao';
  registrado_por_nome: string | null;
  status: 'pendente' | 'concluida';
  concluida_em: Date | null;
  concluida_por_nome: string | null;
};

/**
 * Exclusão de um contato pelo painel (pedido de eliminação do titular). O gatilho cria a pendência se o lead tiver sido
 * entregue; aqui só se informa quem pediu, via variáveis locais à transação. Devolve se havia lead entregue (para a
 * trilha de auditoria avisar a equipe) e se o contato existia.
 */
export async function excluirContatoPeloPainel(contatoId: string, usuarioId: string) {
  if (!UUID.test(contatoId) || !UUID.test(usuarioId)) return { apagado: false, leadEntregue: false };
  const cliente: PoolClient = await pool.connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query(`SELECT set_config('site.eliminacao_origem', 'painel', true), set_config('site.eliminacao_por', $1, true)`, [usuarioId]);
    const antes = await cliente.query(`SELECT 1 FROM leads_comercial WHERE contato_id = $1 AND lead_id IS NOT NULL`, [contatoId]);
    const apagado = await cliente.query('DELETE FROM contatos WHERE id = $1', [contatoId]);
    await cliente.query('COMMIT');
    return { apagado: (apagado.rowCount ?? 0) > 0, leadEntregue: (apagado.rowCount ?? 0) > 0 && (antes.rowCount ?? 0) > 0 };
  } catch (falha) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw falha;
  } finally {
    cliente.release();
  }
}

/**
 * Corrida rara: o contato foi apagado (retenção/painel) depois de o Comercial aceitar o lead e antes de o site gravar o
 * lead_id. O gatilho não viu o lead_id, então a fila registra a pendência com o id que acabou de receber. Idempotente.
 */
export async function registrarPendenciaOrfa(leadId: string) {
  if (!UUID.test(leadId)) return;
  await consultar(
    `INSERT INTO eliminacoes_comercial (lead_id, origem) VALUES ($1, 'retencao') ON CONFLICT (lead_id) DO NOTHING`,
    [leadId]
  );
}

export async function listarPendencias(): Promise<Pendencia[]> {
  return consultar<Pendencia>(
    `SELECT e.id, e.lead_id, e.pedido_em, e.origem, e.status, e.concluida_em,
            r.nome AS registrado_por_nome, c.nome AS concluida_por_nome
       FROM eliminacoes_comercial e
       LEFT JOIN admin_usuarios r ON r.id = e.registrado_por
       LEFT JOIN admin_usuarios c ON c.id = e.concluida_por
      ORDER BY (e.status = 'pendente') DESC, e.pedido_em DESC
      LIMIT 500`
  );
}

export const contarPendenciasAbertas = () =>
  contar(`SELECT count(*) AS total FROM eliminacoes_comercial WHERE status = 'pendente'`);

/** Marca como concluída (o responsável do Comercial já eliminou o lead lá). Só sai de 'pendente'; devolve o lead_id. */
export async function concluirPendencia(id: string, usuarioId: string) {
  if (!UUID.test(id) || !UUID.test(usuarioId)) return null;
  const linha = await consultarUm<{ lead_id: string }>(
    `UPDATE eliminacoes_comercial SET status = 'concluida', concluida_em = now(), concluida_por = $2
      WHERE id = $1 AND status = 'pendente' RETURNING lead_id`,
    [id, usuarioId]
  );
  return linha?.lead_id ?? null;
}
