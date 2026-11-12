// Texto de privacidade da conexão 1 (TEXTO PROPOSTO, revisar com o jurídico) e garantias de que a eliminação LGPD não
// deixa dado pessoal na tabela de pendências. Não precisa de Postgres: confere o conteúdo, a versão e o schema.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { privacidade } from './content.js';
import { montarCorpoLead } from './comercial.js';

process.env.DATABASE_URL ??= 'postgres://sem-uso:sem-uso@127.0.0.1:1/sem-uso'; // config.ts exige a variável; nada conecta
const { config } = await import('./config.js');

const raiz = process.cwd();
const ler = (...p: string[]) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const textoPolitica = JSON.stringify(privacidade);

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
function iso(data: string) {
  const m = data.match(/^(\d{1,2}) de (\S+) de (\d{4})$/);
  assert.ok(m, `data fora do padrão: ${data}`);
  return `${m![3]}-${String(MESES.indexOf(m![2]) + 1).padStart(2, '0')}-${m![1].padStart(2, '0')}`;
}

test('a política cita o compartilhamento do contato com o sistema comercial da própria Afirma E-vias', () => {
  const secao = privacidade.secoes.find((s) => /sistema comercial/i.test(s.titulo));
  assert.ok(secao, 'falta a seção sobre o sistema comercial');
  const texto = (secao!.paragrafos ?? []).join(' ');
  // dados enviados
  for (const dado of ['nome', 'e-mail', 'telefone', 'empresa', 'CNPJ', 'assunto', 'mensagem']) assert.ok(texto.includes(dado), `não cita ${dado}`);
  // finalidade, base legal, retenção, direitos, mesmo controlador
  assert.match(texto, /atenda a sua solicitação e elabore a proposta/);
  assert.match(texto, /art\. 7º, V/);
  assert.match(texto, /24 meses/);
  assert.match(texto, /Portal do titular/);
  assert.match(texto, /eliminação/);
  assert.match(texto, /continua sendo a controladora/);
});

test('a política lista o CNPJ entre os dados coletados e manda o pedido para o sistema comercial na base legal e nos prazos', () => {
  assert.match(textoPolitica, /CNPJ \(opcional\)/);
  assert.match(textoPolitica, /registrar o pedido no sistema comercial da Afirma E-vias/);
  assert.match(textoPolitica, /Contatos comerciais: 24 meses contados do recebimento do formulário, também na cópia mantida no sistema comercial/);
});

test('versão do aviso: subiu para 1.2 e a versão enviada ao Comercial (privacy_version) é a mesma data', () => {
  assert.equal(privacidade.versao, '1.2');
  assert.equal(config.versaoPolitica, iso(privacidade.atualizadoEm), 'config.versaoPolitica e content.privacidade.atualizadoEm divergem');
  assert.notEqual(config.versaoPolitica, '2026-10-20', 'a versão anterior não pode continuar valendo para o texto novo');
  const corpo = montarCorpoLead({ nome: 'Maria', email: 'm@exemplo.test', mensagem: 'x' }, config.versaoPolitica);
  assert.equal(corpo.privacy_version, config.versaoPolitica);
});

test('o formulário grava o lead na fila com config.versaoPolitica (a versão aceita no envio)', () => {
  const forms = ler('src', 'routes', 'forms.ts');
  assert.match(forms, /INSERT INTO leads_comercial \(contato_id, chave, privacidade_versao\)/);
  assert.match(forms, /chaveDoContato\(''\),\s*config\.versaoPolitica,\s*ligado/);
});

test('os formulários avisam, ao lado do aceite, que o pedido segue para o sistema comercial', () => {
  for (const arq of [['src', 'views', 'pages', 'contato.ejs'], ['src', 'views', 'partials', 'chamada-contato.ejs']]) {
    assert.match(ler(...arq), /inclusive pelo sistema comercial da empresa/, arq.join('/'));
  }
});

test('o texto novo está marcado no código como proposto, a revisar com o jurídico', () => {
  assert.match(ler('src', 'content.ts'), /TEXTO PROPOSTO, REVISAR COM O JURÍDICO/);
});

// ------------------------------------------------- tabela de pendências
test('a tabela de pendências não tem coluna de dado pessoal (só lead_id opaco, datas, origem, status e UUIDs de operadores)', () => {
  const schema = ler('db', 'schema.sql');
  const bloco = schema.match(/CREATE TABLE IF NOT EXISTS eliminacoes_comercial \(([\s\S]*?)\n\);/)?.[1];
  assert.ok(bloco, 'tabela eliminacoes_comercial ausente do schema');
  const colunas = bloco!
    .split('\n')
    .map((l) => l.trim().match(/^([a-z_]+)\s+(UUID|TEXT|TIMESTAMPTZ)\b/i))
    .filter(Boolean)
    .map((m) => [m![1], m![2].toUpperCase()]);
  assert.deepEqual(
    colunas.map((c) => c[0]),
    ['id', 'lead_id', 'pedido_em', 'origem', 'registrado_por', 'status', 'concluida_em', 'concluida_por']
  );
  // texto livre só nas duas colunas com CHECK de valores fixos: nada de campo onde caiba nome, e-mail ou mensagem
  const textos = colunas.filter((c) => c[1] === 'TEXT').map((c) => c[0]);
  assert.deepEqual(textos, ['origem', 'status']);
  for (const col of textos) assert.match(bloco!, new RegExp(`${col}\\s+TEXT[^\\n]*CHECK \\(${col} IN`), `${col} sem CHECK de valores fixos`);
  const pessoais = /\b(nome|sobrenome|email|e_mail|telefone|empresa|cnpj|cpf|mensagem|assunto|ip|user_agent|observacao|detalhes)\b/i;
  for (const [nome] of colunas) assert.ok(!pessoais.test(nome), `coluna pessoal: ${nome}`);
});

test('o gatilho só registra lead entregue (lead_id preenchido) e cobre qualquer exclusão de contato', () => {
  const schema = ler('db', 'schema.sql');
  assert.match(schema, /CREATE TRIGGER contatos_eliminacao_comercial BEFORE DELETE ON contatos/);
  assert.match(schema, /WHERE l\.contato_id = OLD\.id AND l\.lead_id IS NOT NULL/);
  assert.match(schema, /ON CONFLICT \(lead_id\) DO NOTHING/);
});

test('o painel exclui contato pela transação com pendência, lista as pendências e só admin conclui', () => {
  const admin = ler('src', 'routes', 'admin.ts');
  assert.match(admin, /excluirContatoPeloPainel\(id, request\.usuario\.id\)/);
  assert.match(admin, /app\.get\('\/eliminacoes-comercial'/);
  assert.match(admin, /app\.post\('\/eliminacoes-comercial\/:id\/concluir'[\s\S]*?papel !== 'admin'/);
  const tela = ler('src', 'views', 'admin', 'eliminacoes-comercial.ejs');
  assert.match(tela, /Eliminar no Comercial/);
  assert.match(tela, /p\.lead_id/);
  // a tela não consulta nem mostra dado do contato
  assert.doesNotMatch(tela, /\b(email|telefone|cnpj|mensagem)\b/i);
});
