// Contrato AEVIAS-HIPERSISTEMA-1.0 (lado produtor 'institucional'): validação dos DTOs com os schemas oficiais.
// O pacote em contracts/vendor/auth-v1 é cópia de aevias-auth/contracts/v1 (só manifest.json e schemas.json, que são o
// que o produtor usa); nunca é editado. O sha256 do manifesto é o `contract_sha256` que o RH confere em
// /internal/capabilities, e schemas.json é conferido contra o manifesto na subida: byte divergente derruba o listener.
// Este módulo não importa config nem banco, para os testes usarem sem DATABASE_URL.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import AjvModule from 'ajv/dist/2020.js';
import formatsModule from 'ajv-formats';

const raiz = new URL('../contracts/vendor/auth-v1/', import.meta.url);
const ler = (nome: string) => readFileSync(new URL(nome, raiz));

const manifesto = JSON.parse(ler('manifest.json').toString('utf8'));
export const CONTRACT_VERSION = manifesto.contract_version as string;
export const CONTRACT_HASH = manifesto.sha256 as string;

const bytesSchemas = ler('schemas.json');
const esperado = manifesto.files['schemas.json'];
if (
  bytesSchemas.length !== esperado.bytes ||
  createHash('sha256').update(bytesSchemas).digest('hex') !== esperado.sha256
)
  throw new Error('contracts/vendor/auth-v1/schemas.json diverge do manifesto');

const schemas = JSON.parse(bytesSchemas.toString('utf8'));
const Ajv = AjvModule as unknown as typeof AjvModule.default;
const formatos = formatsModule as unknown as typeof formatsModule.default;
const ajv = new Ajv({ strict: false, allErrors: false });
formatos(ajv);
ajv.addSchema(schemas);

export function valido(nome: string, valor: unknown): boolean {
  return !!ajv.validate({ $ref: `${schemas.$id}#/$defs/${nome}` }, valor);
}

/** Erro de feed com o corpo exato do schema `Error` do contrato (sem dado pessoal, sem detalhe interno). */
export class ErroFeed extends Error {
  constructor(
    public status: number,
    public code: string,
    public categoria: 'permission' | 'schema' | 'network' | 'conflict' | 'unknown' = 'permission',
    public mensagem = 'Operação não permitida.'
  ) {
    super(code);
  }
  corpo(requestId: string) {
    return {
      error: this.mensagem,
      code: this.code,
      errorCategory: this.categoria,
      request_id: requestId,
      retryable: this.status >= 500 || this.status === 429
    };
  }
}

/** Valida uma RESPOSTA nossa: se o produtor montar algo fora do schema, vira 503 em vez de vazar dado fora do contrato. */
export function resposta<T>(nome: string, valor: T): T {
  if (!valido(nome, valor)) throw new ErroFeed(503, 'dependency_contract_mismatch', 'schema', 'Serviço indisponível. Tente novamente.');
  return valor;
}
