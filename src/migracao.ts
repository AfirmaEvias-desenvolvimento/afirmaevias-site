// Arquivos SQL da migração (db/schema.sql e db/runtime.sql) e a etapa de GRANTs do papel de runtime. Não importa config
// nem banco, para os testes usarem com um Postgres temporário. Quem chama é src/migrate.ts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));

/** db/<nome> ao lado de dist/ (imagem e build) ou de src/ (tsx). */
export function lerSql(nome: 'schema.sql' | 'runtime.sql') {
  const caminhos = [path.resolve(aqui, '../db', nome), path.resolve(aqui, '../../db', nome)];
  const caminho = caminhos.find((c) => fs.existsSync(c));
  if (!caminho) throw new Error(`${nome} nao encontrado`);
  return fs.readFileSync(caminho, 'utf8');
}

/** `--runtime` liga a etapa de GRANTs (serviço site-migrate da Railway). Sem ela, a migração é a de sempre. */
export const pedeRuntime = (argv: readonly string[] = process.argv.slice(2)) => argv.includes('--runtime');

/**
 * Aplica db/runtime.sql como o dono do banco: confere o papel site_app (existe, sem privilégio demais) e concede só DML.
 * Falha (exceção do Postgres) se o papel não existir; nesse caso nada do arquivo é aplicado: o arquivo vai numa única
 * mensagem de consulta simples, que o Postgres executa como uma transação só (o DO de conferência vem primeiro).
 */
export async function aplicarRuntime(banco: { query: (sql: string) => Promise<unknown> }) {
  await banco.query(lerSql('runtime.sql'));
}
