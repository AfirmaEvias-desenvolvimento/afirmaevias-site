// Conexão 1 (Institucional → Comercial): corpo do contrato, classificação das respostas, recuo, configuração
// desligada por padrão e o transporte mTLS de verdade (certificados gerados com openssl, servidor HTTPS local que
// exige certificado de cliente). Não precisa de Postgres nem do Comercial.
import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import {
  LEAD_PATH,
  chaveDoContato,
  classificar,
  enviarLead,
  formatarCnpj,
  lerConfigComercial,
  lerEstadoLead,
  montarCorpoLead,
  recuoSegundos,
  transporteMtls,
  IDEMPOTENCY_KEY
} from './comercial.js';

const contato = {
  nome: 'Maria',
  sobrenome: 'Silva',
  email: 'maria@exemplo.test',
  telefone: '(41) 99999-0000',
  empresa: 'Construtora Exemplo Ltda',
  cnpj: '11222333000181',
  assunto: 'Controle tecnológico',
  mensagem: 'Preciso de um orçamento para uma obra rodoviária.'
};

// ------------------------------------------------------------------ corpo
test('o corpo leva só as chaves do contrato, nesta forma', () => {
  const corpo = montarCorpoLead(contato, '2026-10-20');
  assert.deepEqual(corpo, {
    empresa: 'Construtora Exemplo Ltda',
    cnpj: '11.222.333/0001-81',
    contato: { nome: 'Maria Silva', email: 'maria@exemplo.test', telefone: '(41) 99999-0000' },
    servico_interesse: 'Controle tecnológico',
    mensagem: 'Preciso de um orçamento para uma obra rodoviária.',
    privacy_version: '2026-10-20'
  });
});

test('nada além do contrato: ip, navegador, status e campos extras do contato nunca entram no corpo', () => {
  const comExtras = { ...contato, ip: '203.0.113.9', user_agent: 'Mozilla', status: 'novo', observacao: 'interno', id: 'x' };
  const texto = JSON.stringify(montarCorpoLead(comExtras, '2026-10-20'));
  for (const proibido of ['203.0.113.9', 'Mozilla', 'interno', '"status"', '"ip"', 'user_agent']) assert.ok(!texto.includes(proibido), proibido);
  assert.deepEqual(Object.keys(montarCorpoLead(comExtras, 'v1')).sort(), ['cnpj', 'contato', 'empresa', 'mensagem', 'privacy_version', 'servico_interesse']);
});

test('campos opcionais em branco são omitidos (o contrato é estrito: nem null nem string vazia)', () => {
  const corpo = montarCorpoLead({ nome: 'João', email: 'j@x.test', mensagem: 'Quero saber de ensaios de solo.' }, '2026-10-20');
  assert.deepEqual(Object.keys(corpo).sort(), ['contato', 'empresa', 'mensagem', 'privacy_version']);
  assert.deepEqual(Object.keys(corpo.contato).sort(), ['email', 'nome']);
});

test('sem empresa, o nome da pessoa ocupa o campo obrigatório', () => {
  const corpo = montarCorpoLead({ ...contato, empresa: '   ', cnpj: '' }, '2026-10-20');
  assert.equal(corpo.empresa, 'Maria Silva');
  assert.equal('cnpj' in corpo, false);
});

test('CNPJ: só 14 dígitos viram CNPJ; o resto é omitido em vez de mandar lixo', () => {
  assert.equal(formatarCnpj('11.222.333/0001-81'), '11.222.333/0001-81');
  assert.equal(formatarCnpj('11222333000181'), '11.222.333/0001-81');
  assert.equal(formatarCnpj('123'), undefined);
  assert.equal(formatarCnpj(null), undefined);
});

test('mensagem acima do limite do Comercial (4000) é cortada, e campos longos respeitam os limites do contrato', () => {
  const corpo = montarCorpoLead({ ...contato, mensagem: 'a'.repeat(5000), assunto: 'b'.repeat(500), empresa: 'c'.repeat(500) }, 'v'.repeat(80));
  assert.equal(corpo.mensagem!.length, 4000);
  assert.equal(corpo.servico_interesse!.length, 200);
  assert.equal(corpo.empresa.length, 200);
  assert.equal(corpo.privacy_version.length, 40);
});

test('a Idempotency-Key é estável por contato e cabe no formato aceito', () => {
  const id = '3f2b8c1e-5a7d-4e0f-9b6a-1c2d3e4f5a6b';
  assert.equal(chaveDoContato(id), chaveDoContato(id));
  assert.notEqual(chaveDoContato(id), chaveDoContato('3f2b8c1e-5a7d-4e0f-9b6a-1c2d3e4f5a6c'));
  assert.match(chaveDoContato(id), IDEMPOTENCY_KEY);
});

// ------------------------------------------------------ classificação / recuo
test('201, 200 e 202 contam como entregue; 202 (em análise) não é erro', () => {
  for (const s of [200, 201, 202]) assert.equal(classificar(s).status, 'enviado', String(s));
});

test('rede/5xx/408/429 repetem; 401/403 repetem devagar com alerta; 409 e demais 4xx não se repetem', () => {
  for (const s of [null, 500, 502, 503, 408, 429]) assert.equal(classificar(s).status, 'pendente', String(s));
  for (const s of [401, 403]) {
    const r = classificar(s);
    assert.deepEqual([r.status, r.alerta, r.lento], ['pendente', true, true]);
  }
  assert.deepEqual([classificar(409).status, classificar(409).codigo], ['rejeitado', 'chave_conflitante']);
  for (const s of [400, 404, 422]) assert.equal(classificar(s).status, 'rejeitado', String(s));
});

test('recuo cresce, respeita o teto e o modo lento tem piso maior', () => {
  assert.equal(recuoSegundos(1, false, 0), 10);
  assert.equal(recuoSegundos(2, false, 0), 20);
  assert.equal(recuoSegundos(30, false, 0), 900);
  assert.equal(recuoSegundos(1, true, 0), 1800);
  assert.equal(recuoSegundos(30, true, 0), 3600);
  assert.ok(recuoSegundos(3, false, 0.99) <= 40 * 1.2);
});

// ------------------------------------------------------------ configuração
test('desligado por padrão: sem COMERCIAL_API_URL não há integração (e nada é avisado)', () => {
  const avisos: string[] = [];
  assert.equal(lerConfigComercial({}, (m) => avisos.push(m)), null);
  assert.equal(lerConfigComercial({ COMERCIAL_API_URL: '  ' }, (m) => avisos.push(m)), null);
  assert.deepEqual(avisos, []);
});

test('URL http, com credencial ou sem certificados mantém desligado, avisa e nunca lança', () => {
  const avisos: string[] = [];
  const aviso = (m: string) => avisos.push(m);
  assert.equal(lerConfigComercial({ COMERCIAL_API_URL: 'http://comercial:9548' }, aviso), null);
  assert.equal(lerConfigComercial({ COMERCIAL_API_URL: 'https://u:p@comercial:9548' }, aviso), null);
  assert.equal(lerConfigComercial({ COMERCIAL_API_URL: 'https://comercial:9548' }, aviso), null);
  assert.equal(
    lerConfigComercial({ COMERCIAL_API_URL: 'https://comercial:9548', COMERCIAL_MTLS_CA: '/nao/existe', COMERCIAL_MTLS_CERT: '/nao/existe', COMERCIAL_MTLS_KEY: '/nao/existe' }, aviso),
    null
  );
  assert.equal(avisos.length, 4);
});

// -------------------------------------------------------- transporte mTLS real
function openssl(args: string[], cwd: string) {
  execFileSync('openssl', args, { cwd, stdio: 'pipe' });
}
const temOpenssl = (() => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
})();

function criarPki(dir: string) {
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.crt', '-subj', '/CN=Teste CA', '-days', '2'], dir);
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca2.key', '-out', 'ca2.crt', '-subj', '/CN=Outra CA', '-days', '2'], dir);
  fs.writeFileSync(path.join(dir, 'srv.ext'), 'subjectAltName=DNS:localhost,IP:127.0.0.1\n');
  fs.writeFileSync(path.join(dir, 'cli.ext'), 'subjectAltName=URI:urn:aevias:service:institucional-api\n');
  const emitir = (nome: string, ext: string, ca = 'ca') => {
    openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${nome}.key`, '-out', `${nome}.csr`, '-subj', `/CN=${nome}`], dir);
    openssl(['x509', '-req', '-in', `${nome}.csr`, '-CA', `${ca}.crt`, '-CAkey', `${ca}.key`, '-CAcreateserial', '-out', `${nome}.crt`, '-days', '2', '-extfile', ext], dir);
  };
  emitir('srv', 'srv.ext');
  emitir('cli', 'cli.ext');
  emitir('estranho', 'cli.ext', 'ca2');
}

test('transporte mTLS: entrega com certificado de cliente, manda Idempotency-Key e corpo, e a recusa sem certificado é rede (null)', { skip: !temOpenssl && 'openssl indisponível' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-mtls-'));
  const vistos: { metodo?: string; url?: string; chave?: string; corpo?: string; san?: string }[] = [];
  let servidor: https.Server | undefined;
  try {
    criarPki(dir);
    const ler = (n: string) => fs.readFileSync(path.join(dir, n));
    servidor = https.createServer(
      { key: ler('srv.key'), cert: ler('srv.crt'), ca: ler('ca.crt'), requestCert: true, rejectUnauthorized: true },
      (req, res) => {
        const partes: Buffer[] = [];
        req.on('data', (p) => partes.push(p));
        req.on('end', () => {
          const peer = (req.socket as any).getPeerCertificate();
          vistos.push({ metodo: req.method, url: req.url, chave: String(req.headers['idempotency-key'] ?? ''), corpo: Buffer.concat(partes).toString(), san: peer.subjectaltname });
          const get = req.method === 'GET';
          res.writeHead(get ? 200 : 201, { 'content-type': 'application/json' });
          res.end(JSON.stringify(get ? { lead_id: '11111111-2222-4333-8444-555555555555', state: 'nova' } : { lead_id: '11111111-2222-4333-8444-555555555555', status: 'received', warnings: [] }));
        });
      }
    );
    await new Promise<void>((r) => servidor!.listen(0, '127.0.0.1', r));
    const url = new URL(`https://localhost:${(servidor.address() as AddressInfo).port}/`);

    const bom = transporteMtls({ url, ca: ler('ca.crt'), cert: ler('cli.crt'), key: ler('cli.key') }, 5000);
    const corpo = montarCorpoLead(contato, '2026-10-20');
    const r = await enviarLead(bom, corpo, 'site-contato:abc');
    assert.equal(r.http, 201);
    assert.equal(r.status, 'enviado');
    assert.equal(r.lead_id, '11111111-2222-4333-8444-555555555555');
    assert.equal(r.estado, 'received');
    assert.equal(vistos[0].metodo, 'POST');
    assert.equal(vistos[0].url, LEAD_PATH);
    assert.equal(vistos[0].chave, 'site-contato:abc');
    assert.deepEqual(JSON.parse(vistos[0].corpo!), corpo);
    assert.match(vistos[0].san ?? '', /urn:aevias:service:institucional-api/);

    const estado = await lerEstadoLead(bom, '11111111-2222-4333-8444-555555555555');
    assert.deepEqual(estado, { http: 200, estado: 'nova' });
    assert.equal((await lerEstadoLead(bom, 'nao-e-uuid')).http, 0);

    // sem certificado de cliente: o handshake falha e o transporte devolve status null (vira "pendente"), sem lançar
    const semCert = transporteMtls({ url, ca: ler('ca.crt'), cert: Buffer.alloc(0), key: Buffer.alloc(0) }, 5000);
    const recusado = await enviarLead(semCert, corpo, 'k');
    assert.equal(recusado.http, null);
    assert.equal(recusado.status, 'pendente');
    // certificado de uma CA que o servidor não conhece: idem
    const estranho = transporteMtls({ url, ca: ler('ca.crt'), cert: ler('estranho.crt'), key: ler('estranho.key') }, 5000);
    assert.equal((await enviarLead(estranho, corpo, 'k')).http, null);
    // servidor com certificado de outra CA: o cliente não confia (rejectUnauthorized)
    const desconfiado = transporteMtls({ url, ca: ler('ca2.crt'), cert: ler('cli.crt'), key: ler('cli.key') }, 5000);
    assert.equal((await enviarLead(desconfiado, corpo, 'k')).http, null);
    assert.equal(vistos.length, 2, 'só as duas chamadas autenticadas chegaram ao servidor');
  } finally {
    servidor?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('destino fora do ar: o transporte devolve null (pendente) e não lança', async () => {
  const cfg = { url: new URL('https://127.0.0.1:1/'), ca: Buffer.alloc(0), cert: Buffer.alloc(0), key: Buffer.alloc(0) };
  const r = await enviarLead(transporteMtls(cfg, 2000), montarCorpoLead(contato, 'v'), 'k');
  assert.equal(r.status, 'pendente');
  assert.equal(r.http, null);
});

// ------------------------------------------------ botão "Área do cliente"
test('o botão "Área do cliente" está no topo e no rodapé, ligado à URL configurável do portal', () => {
  for (const arq of ['topo', 'rodape']) {
    const texto = fs.readFileSync(path.join(process.cwd(), 'src', 'views', 'partials', `${arq}.ejs`), 'utf8');
    assert.match(texto, /if \(portalClienteUrl\)[^%]*%>[^]*href="<%= portalClienteUrl %>"[^]*Área do cliente/, arq);
  }
});

test('o formulário de contato tem o CNPJ opcional (sem required)', () => {
  const texto = fs.readFileSync(path.join(process.cwd(), 'src', 'views', 'pages', 'contato.ejs'), 'utf8');
  const entrada = texto.match(/<input[^>]*name="cnpj"[^>]*>/)?.[0] ?? '';
  assert.ok(entrada && !/required/.test(entrada));
});
