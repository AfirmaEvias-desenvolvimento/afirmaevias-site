// A rotina de retenção apaga dado de produção — currículo, contato,
// consentimento — sozinha, a cada 24h e no boot. Não dá para executá-la aqui
// sem um Postgres, mas o erro que realmente assusta é estrutural: uma regra
// perder o recorte de data numa edição futura e passar a apagar a tabela
// inteira, em silêncio, no próximo deploy.
//
// Estes testes varrem as regras e cobram essa forma.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { REGRAS } from './regras-retencao.js';
import { privacidade, cookies } from './content.js';

test('há regras cadastradas', () => {
  assert.ok(REGRAS.length > 0, 'nenhuma regra de retenção');
});

test('toda regra tem rótulo legível e SQL', () => {
  for (const regra of REGRAS) {
    assert.ok(regra.rotulo && regra.rotulo.length > 5, `rótulo fraco: ${regra.rotulo}`);
    assert.ok(regra.sql && regra.sql.trim().length > 0, `SQL vazio em ${regra.rotulo}`);
  }
});

// O teste que justifica o arquivo.
test('toda regra recorta por data — nenhuma varre a tabela inteira', () => {
  for (const { rotulo, sql } of REGRAS) {
    assert.match(sql, /\bWHERE\b/i, `sem WHERE: ${rotulo}`);
    assert.match(sql, /criado_em\s*<\s*now\(\)\s*-\s*interval/i, `sem recorte por data: ${rotulo}`);
  }
});

test('nenhuma regra usa comando destrutivo além de DELETE e UPDATE', () => {
  for (const { rotulo, sql } of REGRAS) {
    assert.match(sql.trim(), /^(DELETE|UPDATE)\b/i, `comando inesperado: ${rotulo}`);
    for (const proibido of ['DROP', 'TRUNCATE', 'ALTER']) {
      assert.ok(!new RegExp(`\\b${proibido}\\b`, 'i').test(sql), `${proibido} em ${rotulo}`);
    }
  }
});

// UPDATE sem SET vira sintaxe inválida; DELETE com SET é sinal de regra
// montada errado. Barato de conferir e pega troca de comando por engano.
test('UPDATE anonimiza e DELETE não tenta escrever', () => {
  for (const { rotulo, sql } of REGRAS) {
    if (/^UPDATE/i.test(sql.trim())) {
      assert.match(sql, /\bSET\b/i, `UPDATE sem SET: ${rotulo}`);
    } else {
      assert.ok(!/\bSET\b/i.test(sql), `DELETE com SET: ${rotulo}`);
    }
  }
});

// Os prazos aqui precisam espelhar a seção "Por quanto tempo guardamos" da
// política. Se um deles mudar sem o outro, o site promete uma coisa e o
// sistema faz outra — que é exatamente o problema que a rotina veio resolver.
test('os prazos declarados continuam sendo os da política', () => {
  const esperado: Record<string, string> = {
    candidaturas: '12 months',
    contatos: '24 months',
    solicitacoes_lgpd: '5 years',
    consentimentos_cookies: '5 years',
    tentativas_login: '24 hours',
    auditoria: '12 months'
  };

  for (const [tabela, prazo] of Object.entries(esperado)) {
    const daTabela = REGRAS.filter((r) => new RegExp(`\\b${tabela}\\b`).test(r.sql));
    assert.ok(daTabela.length > 0, `nenhuma regra para ${tabela}`);
    const temPrazo = daTabela.some((r) => new RegExp(`interval\\s*'${prazo}'`, 'i').test(r.sql));
    assert.ok(temPrazo, `${tabela} deveria usar interval '${prazo}'`);
  }
});

// O Marco Civil pede 6 meses de guarda de log de acesso; passado o prazo o IP
// deixa de ser necessário e a linha é anonimizada em vez de apagada.
test('IP e user-agent são anonimizados aos 6 meses, não apagados', () => {
  const anonimiza = REGRAS.filter((r) => /SET\s+ip\s*=\s*NULL/i.test(r.sql));
  assert.ok(anonimiza.length >= 2, 'esperava anonimização em contatos e candidaturas');
  for (const regra of anonimiza) {
    assert.match(regra.sql, /user_agent\s*=\s*NULL/i, `deixou o user-agent: ${regra.rotulo}`);
    assert.match(regra.sql, /interval\s*'6 months'/i, `prazo diferente de 6 meses: ${regra.rotulo}`);
  }
});

// A trilha de auditoria do painel e apagada aos 12 meses: a política precisa
// dizer isso, senão o site faz uma coisa e promete outra.
test('a política declara a trilha de auditoria e os prazos que a rotina aplica', () => {
  const texto = JSON.stringify(privacidade);
  assert.match(texto, /Trilha de auditoria do painel administrativo[^"]*12 meses/);
  assert.match(texto, /Currículos: 12 meses/);
  assert.match(texto, /Contatos comerciais: 24 meses/);
});

// O banner só pode oferecer categoria que o site realmente usa. Sem analytics
// nem pixel (o teste de terceiros cobra isso), só o essencial existe.
test('o banner de cookies só oferece categorias obrigatórias', () => {
  const opcionais = cookies.categorias.filter((c) => !c.obrigatorio);
  assert.deepEqual(opcionais, [], 'categoria opcional sem ferramenta que a use');
});
