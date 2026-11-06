// Prova ponta a ponta da conexão 1 (Institucional → Comercial) com o AUTH e o RH REAIS e o listener de serviço REAL do Comercial HS.
//
//   site (processo real: node dist/server.js, banco descartável) --mTLS institucional-api--> listener do Comercial HS
//   (código de produção, banco descartável) --> AUTH real (service-authorize-peer) e RH real (service-context)
//
// Nada de produção é tocado: os dois bancos são Postgres embutidos em pasta temporária (porta livre) que somem ao fim; o AUTH e o RH
// só recebem consultas de autorização. Pré-requisitos locais: AUTH em https://localhost:9446, RH em https://localhost:9545, o
// repositório do Comercial HS ao lado (com node_modules) e o material do AUTH em <aevias-auth>/.local-v1/consumers/<app>/.
//   npm run e2e:conexao-1
// Variáveis: HS_DIR, AUTH_CONSUMERS_DIR, AUTH_INTERNAL_URL, RH_INTERNAL_URL, E2E_HS_PORT, E2E_SITE_PORT.
// Saída: tabela de verificações no console e .data/e2e/resultado-conexao-1.json. Código de saída 1 se algo falhar.
import { spawn, execSync } from 'node:child_process';
import { createHash, randomUUID, X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const raiz = resolve(fileURLToPath(new URL('..', import.meta.url)));
const hsDir = resolve(process.env.HS_DIR ?? join(raiz, '..', '..', 'aevias_comercial_HS'));
const authDir = resolve(process.env.AUTH_CONSUMERS_DIR ?? join(raiz, '..', '..', 'aevias-auth', '.local-v1', 'consumers'));
const AUTH = process.env.AUTH_INTERNAL_URL ?? 'https://localhost:9446';
const RH = process.env.RH_INTERNAL_URL ?? 'https://localhost:9545';
const cert = (app, arq) => join(authDir, app, arq);
for (const a of ['institucional', 'comercial', 'ponto', 'rh']) for (const f of ['api.crt', 'api.key', 'ca.crt']) if (!existsSync(cert(a, f))) { console.error(`Material ausente: ${cert(a, f)}`); process.exit(2); }
for (const f of ['scripts/pg-embutido.mjs', 'server/node_modules/tsx/dist/esm/index.mjs']) if (!existsSync(join(hsDir, f))) { console.error(`Comercial HS incompleto (${join(hsDir, f)}): defina HS_DIR e rode npm install lá.`); process.exit(2); }

// ───────── verificações ─────────
const resultados = [];
let secao = '';
const titulo = (t) => { secao = t; console.log(`\n== ${t}`); };
function ok(descricao, cond, detalhe = '') {
  resultados.push({ secao, descricao, ok: !!cond, detalhe: String(detalhe) });
  console.log(`${cond ? 'OK   ' : 'FALHA'} ${descricao}${detalhe ? `  [${detalhe}]` : ''}`);
  return !!cond;
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
async function ate(descricao, fn, { limite = 60_000, passo = 500 } = {}) {
  const fim = Date.now() + limite;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > fim) throw new Error(`tempo esgotado: ${descricao}`); await dormir(passo); }
}
const portaLivre = () => new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const sha = (app) => createHash('sha256').update(new X509Certificate(readFileSync(cert(app, 'api.crt'))).raw).digest('hex');

// ───────── cliente mTLS "cru": prova o destino sem passar pelo código do site ─────────
const ca = readFileSync(cert('institucional', 'ca.crt'));
const agentes = new Map();
const agente = (quem) => {
  if (!agentes.has(quem)) agentes.set(quem, new https.Agent({ ca, ...(quem ? { cert: readFileSync(cert(quem, 'api.crt')), key: readFileSync(cert(quem, 'api.key')) } : {}), keepAlive: false }));
  return agentes.get(quem);
};
function cru(quem, metodo, url, corpo, cabecalhos = {}) {
  return new Promise((resolver) => {
    const conteudo = corpo === undefined ? undefined : typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
    const req = https.request(new URL(url), { method: metodo, agent: agente(quem), headers: { accept: 'application/json', ...(conteudo !== undefined ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(conteudo) } : {}), ...cabecalhos } }, (res) => {
      const partes = [];
      res.on('data', (p) => partes.push(p));
      res.on('end', () => { const t = Buffer.concat(partes).toString(); let c; try { c = JSON.parse(t); } catch { c = t; } resolver({ status: res.statusCode, corpo: c }); });
    });
    req.setTimeout(15_000, () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolver({ status: 0, erro: e.code ?? e.message }));
    req.end(conteudo);
  });
}

// ───────── infraestrutura descartável ─────────
const filhos = [];
const bancos = [];
const pastas = [];
let hsFilho = null;
let saiu = 0;
const portaHs = Number(process.env.E2E_HS_PORT) || await portaLivre();
const portaSite = Number(process.env.E2E_SITE_PORT) || await portaLivre();
const portaSite2 = await portaLivre();
const HS = `https://localhost:${portaHs}`;
const LEADS = `${HS}/api/integracao/v1/comercial/leads`;

async function bancoDescartavel(nome) {
  const { iniciarPg } = await import(pathToFileURL(join(hsDir, 'scripts', 'pg-embutido.mjs')).href);
  const dir = mkdtempSync(join(tmpdir(), `${nome}-`));
  const porta = await portaLivre();
  const pgx = await iniciarPg({ dir, porta, banco: nome });
  pastas.push(dir);
  bancos.push(pgx);
  return { url: `postgres://comercial:comercial@127.0.0.1:${porta}/${nome}`, porta };
}

function subirFilho(nome, comando, args, env) {
  const f = spawn(comando, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  f.saida = '';
  f.stdout.on('data', (d) => { f.saida += d; });
  f.stderr.on('data', (d) => { f.saida += d; });
  f.nome = nome;
  filhos.push(f);
  return f;
}
const encerrar = (f) => new Promise((r) => { if (!f || f.exitCode !== null) return r(); f.once('exit', r); f.kill(); setTimeout(r, 5000); });

function subirHs(dbUrl) {
  hsFilho = subirFilho('hs', process.execPath, ['--import', pathToFileURL(join(hsDir, 'server/node_modules/tsx/dist/esm/index.mjs')).href, join(raiz, 'scripts/e2e/subir-comercial-hs.mjs')], {
    HS_DIR: hsDir, DATABASE_URL: dbUrl, INTEGRACAO_PORT: String(portaHs), AUTH_CONSUMERS_DIR: authDir, AUTH_INTERNAL_URL: AUTH, RH_INTERNAL_URL: RH,
  });
  return hsFilho;
}
let ultimoHs = null;
const hsVivo = async () => { ultimoHs = await cru('institucional', 'GET', `${HS}/health/live`); return ultimoHs.status === 200; };

function subirSite(porta, dbUrl, extra = {}) {
  return subirFilho(`site:${porta}`, process.execPath, ['dist/server.js'], {
    PORT: String(porta), DATABASE_URL: dbUrl, NODE_ENV: 'development', SESSION_SECRET: 's'.repeat(40),
    COMERCIAL_API_URL: '', COMERCIAL_MTLS_CA: '', COMERCIAL_MTLS_CERT: '', COMERCIAL_MTLS_KEY: '', PORTAL_CLIENTE_URL: undefined, ...extra,
  });
}
const siteVivo = (porta) => async () => { try { return (await fetch(`http://127.0.0.1:${porta}/health`)).ok; } catch { return false; } };
async function enviarForm(porta, campos) {
  const r = await fetch(`http://127.0.0.1:${porta}/contato`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(campos), redirect: 'manual' });
  return { status: r.status, html: await r.text() };
}

const EMAIL = `e2e-${randomUUID().slice(0, 8)}@exemplo.test`;
const NOME = 'Maria E2E';
const CNPJ_BASE = '11222333000181';
const form = (extra = {}) => ({ nome: NOME, sobrenome: 'Prova', email: EMAIL, telefone: '(41) 99999-0001', empresa: 'Construtora E2E Ltda', cnpj: '11.222.333/0001-81', assunto: 'Controle tecnológico', mensagem: 'Preciso de um orçamento para controle tecnológico de uma obra rodoviária.', consentimento: 'on', origem: 'contato', ...extra });

try {
  titulo('0. Pré-condições');
  execSync('npm run build', { cwd: raiz, stdio: 'pipe' });
  ok('site compilado (dist/server.js)', existsSync(join(raiz, 'dist/server.js')));
  const authVivo = await cru('comercial', 'POST', `${AUTH}/v1/service-authorize-peer`, { app_code: 'comercial', capability: 'comercial.lead.create', request_id: randomUUID(), service_id: 'institucional-api', certificate_sha256: sha('institucional') });
  ok('AUTH real responde por mTLS (service-authorize-peer)', authVivo.status === 200 || authVivo.status === 403, `HTTP ${authVivo.status}`);
  if (!resultados.every((r) => r.ok)) throw new Error('Pré-condições não atendidas (AUTH no ar?).');

  titulo('A. Política do AUTH real para a conexão 1');
  const autoriza = (servico, capability, hash) => cru('comercial', 'POST', `${AUTH}/v1/service-authorize-peer`, { app_code: 'comercial', capability, request_id: randomUUID(), service_id: servico, certificate_sha256: hash ?? sha(servico.replace(/-api$/, '')) });
  for (const cap of ['comercial.lead.create', 'comercial.lead.read']) {
    const r = await autoriza('institucional-api', cap);
    ok(`AUTH autoriza institucional-api para ${cap}`, r.status === 200 && r.corpo?.allowed === true, `HTTP ${r.status}`);
  }
  for (const outro of ['ponto-api', 'rh-api', 'comercial-api']) {
    for (const cap of ['comercial.lead.create', 'comercial.lead.read']) {
      const r = await autoriza(outro, cap);
      ok(`AUTH nega ${outro} para ${cap}`, r.status === 403 || r.status === 401, `HTTP ${r.status} ${r.corpo?.code ?? ''}`);
    }
  }
  const fp = await autoriza('institucional-api', 'comercial.lead.create', sha('ponto'));
  ok('AUTH nega institucional-api com a impressão digital do certificado de outro sistema', fp.status !== 200, `HTTP ${fp.status}`);

  titulo('B. Padrão do site: desligado, link "Área do cliente"');
  const dbSite = await bancoDescartavel('site_e2e1');
  const cx = new pg.Client({ connectionString: dbSite.url });
  cx.on('error', () => {});
  await cx.connect();
  await cx.query(readFileSync(join(raiz, 'db/schema.sql'), 'utf8'));
  const sq = async (sql, p) => (await cx.query(sql, p)).rows;
  const sqlTabela = await sq(`select to_regclass('leads_comercial') t, (select count(*)::int from information_schema.columns where table_name = 'contatos' and column_name = 'cnpj') cnpj`);
  ok('schema do site aplicado (tabela leads_comercial e coluna contatos.cnpj)', !!sqlTabela[0].t && sqlTabela[0].cnpj === 1);

  const siteOff = subirSite(portaSite2, dbSite.url, { PORTAL_CLIENTE_URL: 'https://localhost:3600/portal' });
  await ate('site desligado no ar', siteVivo(portaSite2), { limite: 30_000 });
  const home = await (await fetch(`http://127.0.0.1:${portaSite2}/`)).text();
  const botoes = [...home.matchAll(/<a[^>]*href="([^"]+)"[^>]*>\s*Área do cliente\s*<\/a>/g)].map((m) => m[1]);
  ok('botão "Área do cliente" aparece (topo e rodapé) apontando para o portal configurado', botoes.length >= 2 && botoes.every((h) => h === 'https://localhost:3600/portal'), botoes.join(' | '));
  const envOff = await enviarForm(portaSite2, form({ email: `off-${EMAIL}` }));
  ok('sem COMERCIAL_API_URL o formulário funciona sozinho (200, mensagem enviada)', envOff.status === 200 && /Mensagem enviada/.test(envOff.html), `HTTP ${envOff.status}`);
  const off = await sq(`select (select count(*)::int from contatos where email = $1) c, (select count(*)::int from leads_comercial) f`, [`off-${EMAIL}`]);
  ok('integração desligada: contato gravado e NENHUMA linha na fila', off[0].c === 1 && off[0].f === 0, JSON.stringify(off[0]));
  await encerrar(siteOff);

  titulo('C. Comercial fora do ar: o site grava, responde e enfileira sem perder o lead');
  const dbHs = await bancoDescartavel('hs_e2e1');
  const siteOn = subirSite(portaSite, dbSite.url, {
    COMERCIAL_API_URL: HS, COMERCIAL_MTLS_CA: cert('institucional', 'ca.crt'), COMERCIAL_MTLS_CERT: cert('institucional', 'api.crt'), COMERCIAL_MTLS_KEY: cert('institucional', 'api.key'),
    COMERCIAL_FILA_INTERVALO_MS: '2000',
  });
  await ate('site ligado no ar', siteVivo(portaSite), { limite: 30_000 });
  const t0 = Date.now();
  const env1 = await enviarForm(portaSite, form());
  ok('formulário responde 200 "Mensagem enviada" mesmo com o Comercial parado', env1.status === 200 && /Mensagem enviada/.test(env1.html), `HTTP ${env1.status} em ${Date.now() - t0} ms`);
  const contato = (await sq(`select id from contatos where email = $1`, [EMAIL]))[0];
  ok('contato gravado no banco do site', !!contato);
  const fila0 = await ate('primeira tentativa', async () => { const f = (await sq(`select * from leads_comercial where contato_id = $1`, [contato.id]))[0]; return f && f.tentativas >= 1 ? f : null; }, { limite: 20_000 });
  ok('fila: pendente após a falha de rede, com recuo agendado', fila0.status === 'pendente' && fila0.ultimo_http === null && fila0.ultimo_codigo === 'indisponivel' && new Date(fila0.proxima_tentativa) > new Date(), `${fila0.status} ${fila0.ultimo_codigo} tentativas=${fila0.tentativas}`);
  ok('chave idempotente estável: site-contato:<id do contato>', fila0.chave === `site-contato:${contato.id}`, fila0.chave);

  titulo('D. Comercial sobe: a fila entrega sozinha (mTLS institucional-api → AUTH real → RH real → lead)');
  subirHs(dbHs.url);
  await ate('listener do HS no ar', async () => { if (hsFilho.exitCode !== null) throw new Error('listener do HS encerrou: ' + hsFilho.saida.slice(-800)); return hsVivo(); }, { limite: 15_000 }).catch((e) => { throw new Error(`${e.message} (última resposta: ${JSON.stringify(ultimoHs)})`); });
  ok('listener de serviço do HS responde live por mTLS', true, HS);
  const entregue = await ate('entrega pela fila', async () => { const f = (await sq(`select * from leads_comercial where contato_id = $1`, [contato.id]))[0]; return f.status !== 'pendente' || f.tentativas >= 6 ? f : null; }, { limite: 150_000, passo: 1000 }).catch(async (e) => { const f = (await sq(`select status, tentativas, ultimo_http, ultimo_codigo, proxima_tentativa from leads_comercial where contato_id = $1`, [contato.id]))[0]; throw new Error(`${e.message} (fila: ${JSON.stringify(f)}; log do site: ${siteOn.saida.slice(-600)})`); });
  ok('fila entregou o lead: status enviado, HTTP 201, lead_id devolvido', entregue.status === 'enviado' && entregue.ultimo_http === 201 && !!entregue.lead_id, `${entregue.status} http=${entregue.ultimo_http} ${entregue.ultimo_codigo} tentativas=${entregue.tentativas}`);

  const hq = new pg.Client({ connectionString: dbHs.url });
  hq.on('error', () => {});
  await hq.connect();
  const hsq = async (sql, p) => (await hq.query(sql, p)).rows;
  const lead = (await hsq(`select * from leads where id = $1`, [entregue.lead_id]))[0];
  ok('o lead existe no banco do Comercial com os campos do contrato', lead?.empresa === 'Construtora E2E Ltda' && lead.contato_email === EMAIL && lead.contato_nome === `${NOME} Prova` && lead.contato_telefone === '(41) 99999-0001' && lead.servico_interesse === 'Controle tecnológico' && /orçamento para controle/.test(lead.mensagem) && lead.privacidade_versao === '2026-10-20', `${lead?.empresa} / ${lead?.privacidade_versao}`);
  ok('CNPJ chegou formatado e a origem é "institucional", status "nova"', lead?.cnpj === '11.222.333/0001-81' && lead.origem === 'institucional' && lead.status === 'nova', `${lead?.cnpj} ${lead?.origem} ${lead?.status}`);
  const colunasLead = Object.keys(lead ?? {});
  ok('nada além do contrato foi parar no lead (sem IP/navegador do visitante)', !JSON.stringify(lead).includes('127.0.0.1') && !colunasLead.some((c) => /^(ip|user_agent)$/.test(c)), colunasLead.join(','));
  ok('chave idempotente gravada no Comercial = a da fila', lead?.chave === entregue.chave, lead?.chave);
  const logSite = siteOn.saida;
  ok('log do site não contém dado pessoal do lead (e-mail, nome, mensagem)', !logSite.includes(EMAIL) && !logSite.includes(NOME) && !logSite.includes('orçamento para controle'));

  titulo('E. Reenvio idempotente pelo próprio site (mesma chave): o Comercial não duplica');
  await cx.query(`update leads_comercial set status = 'pendente', proxima_tentativa = now() where id = $1`, [entregue.id]);
  const reenv = await ate('reenvio', async () => { const f = (await sq(`select * from leads_comercial where id = $1`, [entregue.id]))[0]; return f.status !== 'pendente' ? f : null; }, { limite: 30_000 });
  const nLeads = (await hsq(`select count(*)::int n from leads where chave = $1`, [entregue.chave]))[0].n;
  ok('o site reenviou com a mesma chave e o Comercial devolveu o MESMO lead_id', reenv.status === 'enviado' && reenv.lead_id === entregue.lead_id, `http=${reenv.ultimo_http}`);
  ok('segue 1 só lead no Comercial para essa chave', nLeads === 1, `n=${nLeads}`);

  titulo('F. Protocolo cru contra o listener do HS (identidade institucional-api)');
  const corpo = { empresa: 'Empresa Cru E2E Ltda', cnpj: '07.526.557/0001-00', contato: { nome: 'Joao Cru', email: `cru-${EMAIL}`, telefone: '(41) 3333-0000' }, servico_interesse: 'Dosagem', mensagem: 'Teste cru do protocolo.', privacy_version: '2026-10-20' };
  const chave = `cru:${randomUUID()}`;
  const c1 = await cru('institucional', 'POST', LEADS, corpo, { 'idempotency-key': chave });
  ok('lead novo: 201 (ou 202 se a empresa precisa de análise) com lead_id', (c1.status === 201 || c1.status === 202) && !!c1.corpo?.lead_id, `HTTP ${c1.status} ${JSON.stringify(c1.corpo)}`);
  const c2 = await cru('institucional', 'POST', LEADS, corpo, { 'idempotency-key': chave });
  ok('reenvio idempotente: 200 com o mesmo lead_id', c2.status === 200 && c2.corpo?.lead_id === c1.corpo?.lead_id, `1ª=${c1.status} reenvio=${c2.status} avisos=${JSON.stringify(c1.corpo?.warnings)}`);
  const c3 = await cru('institucional', 'POST', LEADS, { ...corpo, mensagem: 'Outro texto.' }, { 'idempotency-key': chave });
  ok('mesma chave com outro conteúdo: 409 idempotency_conflict', c3.status === 409 && c3.corpo?.code === 'idempotency_conflict', `HTTP ${c3.status} ${c3.corpo?.code ?? ''}`);
  const c4 = await cru('institucional', 'POST', LEADS, corpo);
  ok('sem Idempotency-Key: 400', c4.status === 400, `HTTP ${c4.status}`);
  for (const [nome, extra] of [['preço', { preco: 10 }], ['valor', { valor_total: 1 }], ['campo desconhecido', { nota_interna: 'x' }]]) {
    const r = await cru('institucional', 'POST', LEADS, { ...corpo, ...extra }, { 'idempotency-key': `cru:${randomUUID()}` });
    ok(`corpo com ${nome} fora do contrato: 400`, r.status === 400, `HTTP ${r.status}`);
  }
  const c5 = await cru('institucional', 'POST', LEADS, { ...corpo, contato: { ...corpo.contato, cpf: '000' } }, { 'idempotency-key': `cru:${randomUUID()}` });
  ok('campo extra DENTRO de contato (cpf): 400', c5.status === 400, `HTTP ${c5.status}`);

  titulo('G. Outras identidades e TLS sem certificado');
  for (const outro of ['ponto', 'rh', 'comercial']) {
    const r = await cru(outro, 'POST', LEADS, corpo, { 'idempotency-key': `cru:${randomUUID()}` });
    ok(`${outro}-api tentando criar lead: 403`, r.status === 403, `HTTP ${r.status} ${r.corpo?.code ?? ''}`);
    const l = await cru(outro, 'GET', `${LEADS}/${c1.corpo?.lead_id}`);
    ok(`${outro}-api tentando ler lead: 403`, l.status === 403, `HTTP ${l.status}`);
  }
  const semCert = await cru(null, 'POST', LEADS, corpo, { 'idempotency-key': `cru:${randomUUID()}` });
  ok('sem certificado de cliente: TLS recusado (nenhuma resposta HTTP)', semCert.status === 0, semCert.erro ?? `HTTP ${semCert.status}`);
  const naoCriou = (await hsq(`select count(*)::int n from leads where contato_email = $1`, [`cru-${EMAIL}`]))[0].n;
  ok('as chamadas recusadas não criaram lead (só a do protocolo cru válido existe)', naoCriou === 1, `n=${naoCriou}`);

  titulo('H. comercial.lead.read: o site só vê o ESTADO');
  const le = await cru('institucional', 'GET', `${LEADS}/${entregue.lead_id}`);
  ok('GET lead: 200 só com lead_id e state', le.status === 200 && Object.keys(le.corpo).sort().join() === 'lead_id,state' && le.corpo.state === 'nova', JSON.stringify(le.corpo));
  const nf = await cru('institucional', 'GET', `${LEADS}/${randomUUID()}`);
  ok('lead inexistente: 404', nf.status === 404, `HTTP ${nf.status}`);
  const nf2 = await cru('institucional', 'GET', `${LEADS}/nao-e-uuid`);
  ok('id que não é UUID: 404', nf2.status === 404, `HTTP ${nf2.status}`);
  await hq.query(`update leads set status = 'em_analise' where id = $1`, [entregue.lead_id]);
  const { transporteMtls, lerEstadoLead } = await import(pathToFileURL(join(raiz, 'dist/comercial.js')).href);
  const viaSite = await lerEstadoLead(transporteMtls({ url: new URL(HS), ca, cert: readFileSync(cert('institucional', 'api.crt')), key: readFileSync(cert('institucional', 'api.key')) }), entregue.lead_id);
  ok('módulo do site (lerEstadoLead) enxerga a mudança de estado feita pelo comercial', viaSite.http === 200 && viaSite.estado === 'em_analise', JSON.stringify(viaSite));

  titulo('I. Contato fora da regra do Comercial não derruba o site');
  const env2 = await enviarForm(portaSite, form({ email: 'sem-empresa@exemplo.test', empresa: '', cnpj: '', assunto: '', telefone: '', nome: 'Ana', sobrenome: '' }));
  ok('contato sem empresa/CNPJ/telefone/assunto: 200 no site', env2.status === 200 && /Mensagem enviada/.test(env2.html), `HTTP ${env2.status}`);
  const f2 = await ate('entrega do contato mínimo', async () => { const f = (await sq(`select f.* from leads_comercial f join contatos c on c.id = f.contato_id where c.email = 'sem-empresa@exemplo.test'`))[0]; return f && f.status !== 'pendente' ? f : null; }, { limite: 30_000 });
  const l2 = (await hsq(`select * from leads where id = $1`, [f2.lead_id]))[0];
  ok('o Comercial aceitou (empresa = nome da pessoa) e sinalizou cnpj_ausente', f2.status === 'enviado' && l2?.empresa === 'Ana' && JSON.stringify(l2.avisos).includes('cnpj_ausente'), `${f2.status} http=${f2.ultimo_http} ${JSON.stringify(l2?.avisos)}`);
  const erroCnpj = await enviarForm(portaSite, form({ cnpj: '123' }));
  ok('CNPJ preenchido com tamanho errado: o site mostra o erro e NÃO grava', erroCnpj.status === 400 && /Confira o CNPJ/.test(erroCnpj.html), `HTTP ${erroCnpj.status}`);
  void CNPJ_BASE;
} catch (e) {
  ok(`execução interrompida: ${e.message}`, false);
  saiu = 1;
} finally {
  for (const f of filhos) await encerrar(f);
  for (const b of bancos) await b.stop().catch(() => {});
  for (const d of pastas) rmSync(d, { recursive: true, force: true });
  mkdirSync(join(raiz, '.data', 'e2e'), { recursive: true });
  writeFileSync(join(raiz, '.data', 'e2e', 'resultado-conexao-1.json'), JSON.stringify({ quando: new Date().toISOString(), resultados }, null, 2));
  const falhas = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - falhas.length}/${resultados.length} verificações OK${falhas.length ? `, ${falhas.length} FALHA(S):` : ''}`);
  for (const f of falhas) console.log(`  - [${f.secao}] ${f.descricao}  ${f.detalhe}`);
  if (falhas.length) saiu = 1;
  if (saiu && hsFilho) console.log('\n--- log do HS (fim) ---\n' + hsFilho.saida.slice(-1500));
  process.exit(saiu);
}
