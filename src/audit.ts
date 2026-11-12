import type { PoolClient } from 'pg';
import { pool } from './db.js';
import type { UsuarioAdmin } from './auth.js';

export async function registrarAuditoria(opcoes: {
  usuario?: Pick<UsuarioAdmin, 'id' | 'email'> | null;
  acao: string;
  entidade?: string;
  entidadeId?: string;
  detalhes?: Record<string, unknown>;
  ip?: string;
}, banco: Pick<PoolClient, 'query'> = pool) {
  await banco.query(
    `INSERT INTO auditoria (usuario_id, usuario_email, acao, entidade, entidade_id, detalhes, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      opcoes.usuario?.id ?? null,
      opcoes.usuario?.email ?? null,
      opcoes.acao,
      opcoes.entidade ?? null,
      opcoes.entidadeId ?? null,
      opcoes.detalhes ? JSON.stringify(opcoes.detalhes) : null,
      opcoes.ip ?? null
    ]
  );
}
