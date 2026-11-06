// Eliminação LGPD x lead já entregue ao Comercial, contra um Postgres de verdade (o embutido do repositório do Comercial HS,
// em pasta temporária e porta livre, que some ao fim). PULA se esse repositório não estiver ao lado (HS_DIR) ou se o
// Postgres embutido não subir: o contrato é de banco (gatilho BEFORE DELETE), então só um banco prova.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';

const hsDir = path.resolve(process.env.HS_DIR ?? path.join(process.cwd(), '..', '..', 'aevias_comercial_HS'));
const pgEmbutido = path.join(hsDir, 'scripts', 'pg-embutido.mjs');
const temPg = fs.existsSync(pgEmbutido) && fs.existsSync(path.join(hsDir, 'node_modules', 'embedded-postgres'));
const portaLivre = () =>
  new Promise<number>((r) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as any).port as number;
      s.close(() => r(p));
    });
  });

const LEAD_A = '11111111-1111-4111-8111-111111111111';
const LEAD_D = '44444444-4444-4444-8444-444444444444';
const LEAD_ORFAO = '99999999-9999-4999-8999-999999999999';
const EMAIL = (n: string) => `titular-${n}@exemplo.test`;

test(
  'banco real: apagar contato com lead entregue cria pendência; sem lead entregue não cria; nada pessoal na tabela',
  { skip: !temPg && 'repositório do Comercial HS (Postgres embutido) não encontrado; defina HS_DIR' },
  async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-elim-'));
    const porta = await portaLivre();
    const { iniciarPg } = await import(pathToFileURL(pgEmbutido).href);
    let servidor: any;
    try {
      servidor = await iniciarPg({ dir, porta, banco: 'site_elim' });
    } catch (falha) {
      t.skip(`Postgres embutido não subiu: ${falha instanceof Error ? falha.message : falha}`);
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    }
    process.env.DATABASE_URL = `postgres://comercial:comercial@127.0.0.1:${porta}/site_elim`;
    process.env.NODE_ENV = 'development';
    const { pool, consultar } = await import('./db.js');
    const { aplicarRetencao } = await import('./retencao.js');
    const { excluirContatoPeloPainel, registrarPendenciaOrfa, listarPendencias, concluirPendencia, contarPendenciasAbertas } = await import('./eliminacao-comercial.js');
    try {
      const schema = fs.readFileSync(path.join(process.cwd(), 'db', 'schema.sql'), 'utf8');
      await pool.query(schema);
      await pool.query(schema); // idempotente: roda a cada deploy

      const [{ id: operador }] = await consultar(
        `INSERT INTO admin_usuarios (nome, email, senha_hash, papel) VALUES ('Operador', 'operador@exemplo.test', 'x', 'admin') RETURNING id`
      );
      const contato = async (n: string, extra = '') =>
        (await consultar(`INSERT INTO contatos (nome, email, telefone, empresa, cnpj, assunto, mensagem, consentimento ${extra ? ', criado_em' : ''})
                          VALUES ($1, $2, '(41) 99999-0000', 'Empresa ' || $1, '11222333000181', 'Assunto', 'Mensagem do titular ' || $1, TRUE ${extra ? ', now() - interval ' + extra : ''}) RETURNING id`, [`Pessoa ${n}`, EMAIL(n)]))[0].id as string;
      const fila = (contatoId: string, status: string, leadId: string | null) =>
        consultar(`INSERT INTO leads_comercial (contato_id, chave, privacidade_versao, status, lead_id) VALUES ($1::uuid, 'site-contato:' || $1::uuid::text, '2026-11-06', $2, $3::uuid)`, [contatoId, status, leadId]);

      // A: entregue; B: fila ainda pendente; C: rejeitada pelo Comercial; D: entregue e com mais de 24 meses; E: sem fila (integração desligada)
      const A = await contato('A');
      await fila(A, 'enviado', LEAD_A);
      const B = await contato('B');
      await fila(B, 'pendente', null);
      const C = await contato('C');
      await fila(C, 'rejeitado', null);
      const D = await contato('D', `'25 months'`);
      await fila(D, 'enviado', LEAD_D);
      const E = await contato('E');

      await t.test('exclusão pelo painel de contato entregue: pendência com o lead_id, origem painel e quem pediu', async () => {
        const r = await excluirContatoPeloPainel(A, operador);
        assert.deepEqual(r, { apagado: true, leadEntregue: true });
        assert.equal((await consultar('SELECT 1 FROM contatos WHERE id = $1', [A])).length, 0, 'contato apagado');
        assert.equal((await consultar('SELECT 1 FROM leads_comercial WHERE contato_id = $1', [A])).length, 0, 'fila apagada em cascata');
        const [p] = await consultar('SELECT * FROM eliminacoes_comercial WHERE lead_id = $1', [LEAD_A]);
        assert.ok(p, 'pendência criada');
        assert.equal(p.status, 'pendente');
        assert.equal(p.origem, 'painel');
        assert.equal(p.registrado_por, operador);
        assert.equal(p.concluida_em, null);
      });

      await t.test('sem lead entregue (fila pendente, rejeitada ou inexistente) não gera pendência', async () => {
        for (const id of [B, C, E]) {
          const r = await excluirContatoPeloPainel(id, operador);
          assert.equal(r.apagado, true);
          assert.equal(r.leadEntregue, false);
        }
        assert.equal((await consultar('SELECT count(*)::int AS n FROM eliminacoes_comercial'))[0].n, 1, 'só a pendência do contato A');
        assert.deepEqual(await excluirContatoPeloPainel(A, operador), { apagado: false, leadEntregue: false }, 'repetir não duplica nem falha');
        assert.equal((await consultar('SELECT count(*)::int AS n FROM eliminacoes_comercial'))[0].n, 1);
      });

      await t.test('a retenção automática (24 meses) também cria a pendência, com origem retencao', async () => {
        await aplicarRetencao();
        assert.equal((await consultar('SELECT 1 FROM contatos WHERE id = $1', [D])).length, 0, 'contato antigo apagado pela retenção');
        const [p] = await consultar('SELECT * FROM eliminacoes_comercial WHERE lead_id = $1', [LEAD_D]);
        assert.ok(p, 'pendência da retenção');
        assert.equal(p.origem, 'retencao');
        assert.equal(p.registrado_por, null);
        assert.equal(p.status, 'pendente');
      });

      await t.test('lead aceito pelo Comercial depois de o contato ter sido apagado (corrida) também vira pendência, sem duplicar', async () => {
        await registrarPendenciaOrfa(LEAD_ORFAO);
        await registrarPendenciaOrfa(LEAD_ORFAO);
        await registrarPendenciaOrfa('nao-e-uuid');
        assert.equal((await consultar('SELECT count(*)::int AS n FROM eliminacoes_comercial WHERE lead_id = $1', [LEAD_ORFAO]))[0].n, 1);
      });

      await t.test('NENHUM dado pessoal na tabela de pendências', async () => {
        const linhas = await consultar('SELECT * FROM eliminacoes_comercial');
        assert.equal(linhas.length, 3);
        const dump = JSON.stringify(linhas).toLowerCase();
        for (const n of ['a', 'b', 'c', 'd', 'e']) {
          assert.ok(!dump.includes(EMAIL(n)), `e-mail de ${n} vazou`);
          assert.ok(!dump.includes(`pessoa ${n}`), `nome de ${n} vazou`);
          assert.ok(!dump.includes(`mensagem do titular ${n}`), `mensagem de ${n} vazou`);
        }
        for (const dado of ['99999-0000', '11222333000181', 'exemplo.test', 'empresa ', 'assunto']) assert.ok(!dump.includes(dado), `${dado} na tabela`);
        const colunas = (await consultar(`SELECT column_name FROM information_schema.columns WHERE table_name = 'eliminacoes_comercial' ORDER BY ordinal_position`)).map((c) => c.column_name);
        assert.deepEqual(colunas, ['id', 'lead_id', 'pedido_em', 'origem', 'registrado_por', 'status', 'concluida_em', 'concluida_por']);
      });

      await t.test('listagem e conclusão: só sai de pendente uma vez e mostra quem concluiu', async () => {
        assert.equal(await contarPendenciasAbertas(), 3);
        const lista = await listarPendencias();
        assert.equal(lista.length, 3);
        assert.ok(lista.every((p) => p.status === 'pendente'));
        const alvo = lista.find((p) => p.lead_id === LEAD_A)!;
        assert.equal(alvo.registrado_por_nome, 'Operador');
        assert.equal(await concluirPendencia(alvo.id, operador), LEAD_A);
        assert.equal(await concluirPendencia(alvo.id, operador), null, 'concluir de novo não repete');
        assert.equal(await contarPendenciasAbertas(), 2);
        const depois = (await listarPendencias()).find((p) => p.id === alvo.id)!;
        assert.equal(depois.status, 'concluida');
        assert.equal(depois.concluida_por_nome, 'Operador');
        assert.ok(depois.concluida_em);
        assert.equal(await concluirPendencia('nao-e-uuid', operador), null);
      });
    } finally {
      await pool.end().catch(() => {});
      await servidor.stop().catch(() => {});
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);
