// O site promete na política que não carrega script de terceiros, e a CSP
// só libera 'self'. Este teste cobra isso nos dois lugares onde um terceiro
// poderia entrar sem ninguém notar: as views e os scripts do cliente.
//
// A única exceção declarada é a página extra /bruno_magalhaes (YouTube).
// Está numa lista explícita: se ela sair, o teste passa a exigir zero.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const raiz = process.cwd();

function arquivos(pasta: string, extensoes: string[]): string[] {
  const saida: string[] = [];
  for (const nome of fs.readdirSync(path.join(raiz, pasta), { withFileTypes: true })) {
    const rel = path.join(pasta, nome.name);
    if (nome.isDirectory()) saida.push(...arquivos(rel, extensoes));
    else if (extensoes.some((e) => nome.name.endsWith(e))) saida.push(rel);
  }
  return saida;
}

// arquivos que, por decisão registrada, falam com terceiros
const EXCECOES = new Set([
  path.join('public', 'js', 'extra.js') // player do YouTube da página extra
]);

// qualquer URL absoluta http(s) que não seja link de navegação (<a href>)
const URL_EXTERNA = /(?:src|srcset|data|poster)\s*=\s*["']https?:\/\/|@import\s+url\(\s*["']?https?:|\bimport\s*\(?\s*["']https?:|\bsrc\s*=\s*['"]https?:\/\//i;

test('nenhuma view carrega recurso (script, imagem, fonte) de outro domínio', () => {
  for (const arq of arquivos(path.join('src', 'views'), ['.ejs'])) {
    if (arq.includes(`${path.sep}admin${path.sep}`)) continue;
    const texto = fs.readFileSync(path.join(raiz, arq), 'utf8');
    assert.ok(!URL_EXTERNA.test(texto), `recurso externo em ${arq}`);
    assert.ok(!/<script[^>]+src=["']https?:/i.test(texto), `<script> externo em ${arq}`);
    assert.ok(!/<link[^>]+href=["']https?:\/\/[^"']+["'][^>]*rel=["']stylesheet/i.test(texto), `CSS externo em ${arq}`);
  }
});

test('os CSS do site não importam fonte nem imagem de outro domínio', () => {
  for (const arq of arquivos(path.join('public', 'css'), ['.css'])) {
    const texto = fs.readFileSync(path.join(raiz, arq), 'utf8');
    assert.ok(!/url\(\s*["']?https?:\/\//i.test(texto), `url() externa em ${arq}`);
    assert.ok(!/@import/i.test(texto), `@import em ${arq}`);
  }
});

test('os scripts do cliente só falam com o próprio site, salvo a exceção declarada', () => {
  for (const arq of arquivos(path.join('public', 'js'), ['.js'])) {
    if (EXCECOES.has(arq)) continue;
    const texto = fs.readFileSync(path.join(raiz, arq), 'utf8');
    const externas = texto.match(/https?:\/\/(?!(?:www\.)?afirmaevias\.com\.br)[a-z0-9.-]+/gi) ?? [];
    assert.deepEqual(externas, [], `${arq} cita domínio externo: ${externas.join(', ')}`);
  }
});

test('nenhum script de analytics ou pixel conhecido aparece no código', () => {
  const proibidos = ['googletagmanager', 'google-analytics', 'gtag(', 'fbq(', 'facebook.net', 'hotjar', 'clarity.ms', 'plausible.io', 'segment.com'];
  const lugares = [...arquivos('src', ['.ts', '.ejs']), ...arquivos('public', ['.js'])];
  for (const arq of lugares) {
    if (arq.endsWith('terceiros.test.ts')) continue;
    const texto = fs.readFileSync(path.join(raiz, arq), 'utf8').toLowerCase();
    for (const termo of proibidos) assert.ok(!texto.includes(termo), `"${termo}" em ${arq}`);
  }
});

test('a CSP só abre domínio externo na rota da página extra', () => {
  // a CSP saiu do server.ts para src/cabecalhos.ts (cabecalhosDeSeguranca)
  const fonte = fs.readFileSync(path.join(raiz, 'src', 'cabecalhos.ts'), 'utf8');
  const inicio = fonte.indexOf('const base =');
  const fim = fonte.indexOf('const comVideo');
  assert.ok(inicio >= 0 && fim > inicio, 'a política base da CSP não foi encontrada em src/cabecalhos.ts');
  const base = fonte.slice(inicio, fim);
  assert.ok(!/https?:\/\//.test(base), 'a política base da CSP não pode citar domínio externo');
});
