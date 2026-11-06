// Sobe SÓ o listener de serviço (mTLS) do Comercial HS contra um banco DESCARTÁVEL, para a prova da conexão 1.
// Usa o código de produção do HS (migrar + construirIntegracao + rota /api/integracao/v1/comercial/leads), o AUTH e o RH reais.
// Não é a aplicação inteira do HS: sem porta pública, sem login, sem rotinas. Quem o chama é o scripts/e2e-conexao-1.mjs.
//
// Precisa do tsx do HS (o servidor dele é TypeScript):
//   node --import <HS>/server/node_modules/tsx/dist/esm/index.mjs scripts/e2e/subir-comercial-hs.mjs
// Variáveis (todas obrigatórias, o orquestrador define): HS_DIR, DATABASE_URL, INTEGRACAO_PORT, AUTH_CONSUMERS_DIR,
// AUTH_INTERNAL_URL, RH_INTERNAL_URL.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const faltando = ['HS_DIR', 'DATABASE_URL', 'INTEGRACAO_PORT', 'AUTH_CONSUMERS_DIR', 'AUTH_INTERNAL_URL', 'RH_INTERNAL_URL'].filter((n) => !process.env[n]);
if (faltando.length) { console.error(`variáveis ausentes: ${faltando.join(', ')}`); process.exit(2); }
// recusa banco que não seja local: este script grava dados de teste
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL)) { console.error('recusado: DATABASE_URL não é local'); process.exit(2); }

const hs = process.env.HS_DIR;
const cert = (arq) => join(process.env.AUTH_CONSUMERS_DIR, 'comercial', arq);
Object.assign(process.env, {
  JWT_SECRET: 'e'.repeat(48), AUTH_MODE: 'local',
  COMERCIAL_MTLS_CA: cert('ca.crt'), COMERCIAL_MTLS_CERT: cert('api.crt'), COMERCIAL_MTLS_KEY: cert('api.key'),
  INTEGRACAO_TLS_CERT: cert('web.crt'), INTEGRACAO_TLS_KEY: cert('web.key'),   // certificado de SERVIDOR (o api.crt é só de cliente)
  LAB_API_URL: '', NPS_API_URL: '', PROJETOS_API_URL: '', CONTROLE_API_URL: '',
});
const src = (p) => import(pathToFileURL(join(hs, 'server', 'src', p)).href);

await (await src('migrate.ts')).migrar(() => {});
const app = await (await src('integracao-entrada.ts')).construirIntegracao({ https: true, logger: true });
await app.listen({ port: Number(process.env.INTEGRACAO_PORT), host: '127.0.0.1' });
console.log(`HS listener no ar: ${process.env.INTEGRACAO_PORT}`);
const parar = async () => { await app.close(); process.exit(0); };
process.once('SIGINT', parar);
process.once('SIGTERM', parar);
