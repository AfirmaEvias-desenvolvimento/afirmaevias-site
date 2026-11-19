// Primeiro administrador do painel SEM senha em variável de ambiente (Railway). Localmente nada muda: o ecossistema
// continua criando o admin pela migração com ADMIN_EMAIL/ADMIN_PASSWORD, que só existem no site.env deste PC.
//
// Na Railway a senha de uma pessoa não pode ficar em variável. Este comando roda dentro do contêiner do `site`
// (`railway ssh --service site`), com o DATABASE_URL do runtime (site_app), e só depois que o dono DESIGNAR a pessoa:
//
//   node dist/admin-inicial.js --email <e-mail> --nome "<nome>" --designacao "<referência da designação do dono>"
//
// A senha é lida da entrada padrão (sem eco no terminal), nunca de argumento, variável ou arquivo. O comando recusa se já
// existir qualquer administrador ativo, grava a criação na trilha de auditoria com a designação e não imprime a senha.
// A pessoa troca a senha depois em /admin/usuarios ("Minha senha").
import { pathToFileURL } from 'node:url';
import { emailValido, limpar } from './utils.js';

export type PedidoAdmin = { email: string; nome: string; designacao: string };
type Banco = { query: (sql: string, parametros?: unknown[]) => Promise<{ rows: any[] }> };

const USO = 'uso: node dist/admin-inicial.js --email <e-mail> --nome "<nome>" --designacao "<referência da designação do dono>"';

/** Lê e confere os argumentos. Lança Error com mensagem legível (sem dado sensível) se algo estiver errado. */
export function lerPedido(argv: readonly string[]): PedidoAdmin {
  const valores: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const chave = argv[i];
    if (!['--email', '--nome', '--designacao'].includes(chave)) throw new Error(`opção desconhecida: ${chave}\n${USO}`);
    const valor = argv[i + 1];
    if (valor === undefined || valor.startsWith('--')) throw new Error(`${chave} sem valor\n${USO}`);
    valores[chave.slice(2)] = valor;
    i++;
  }
  const email = limpar(valores.email, 200);
  const nome = limpar(valores.nome, 120);
  const designacao = limpar(valores.designacao, 200);
  if (!emailValido(email)) throw new Error(`--email inválido\n${USO}`);
  if (!nome) throw new Error(`--nome obrigatório\n${USO}`);
  if (designacao.length < 10) throw new Error(`--designacao obrigatória (10 a 200 caracteres: quem designou, quando e por qual meio)\n${USO}`);
  return { email, nome, designacao };
}

/** Mesma regra do painel (/admin/usuarios). */
export function conferirSenha(senha: string) {
  if (senha.length < 10) throw new Error('A senha precisa de pelo menos 10 caracteres.');
  return senha;
}

/**
 * Cria o admin numa transação: recusa se já houver admin ativo ou se o e-mail já existir; grava a trilha.
 * `gerarHash` é o bcrypt do painel (src/auth.ts), injetado para o teste.
 */
export async function criarAdminInicial(banco: Banco, pedido: PedidoAdmin, senha: string, gerarHash: (s: string) => Promise<string>) {
  conferirSenha(senha);
  const hash = await gerarHash(senha);
  await banco.query('BEGIN');
  try {
    // trava a tabela contra duas execuções simultâneas (as duas veriam "nenhum admin" e criariam dois)
    await banco.query('LOCK TABLE admin_usuarios IN SHARE ROW EXCLUSIVE MODE');
    const ativos = await banco.query(`SELECT 1 FROM admin_usuarios WHERE papel = 'admin' AND ativo LIMIT 1`);
    if (ativos.rows.length) throw new Error('Já existe administrador ativo: os demais usuários são criados por ele em /admin/usuarios.');
    const mesmo = await banco.query('SELECT 1 FROM admin_usuarios WHERE lower(email) = lower($1)', [pedido.email]);
    if (mesmo.rows.length) throw new Error('Esse e-mail já tem conta no painel: nada foi criado.');
    const criado = await banco.query(
      `INSERT INTO admin_usuarios (nome, email, senha_hash, papel) VALUES ($1,$2,$3,'admin') RETURNING id`,
      [pedido.nome, pedido.email, hash]
    );
    await banco.query(
      `INSERT INTO auditoria (usuario_id, usuario_email, acao, entidade, entidade_id, detalhes, ip) VALUES (NULL, NULL, 'usuario.criado', 'admin_usuarios', $1, $2, NULL)`,
      [criado.rows[0].id, JSON.stringify({ email: pedido.email, papel: 'admin', origem: 'admin-inicial', designacao: pedido.designacao })]
    );
    await banco.query('COMMIT');
    return criado.rows[0].id as string;
  } catch (falha) {
    await banco.query('ROLLBACK').catch(() => {});
    throw falha;
  }
}

/** Lê uma linha da entrada padrão; num terminal, sem eco. */
async function lerSenha(): Promise<string> {
  const entrada = process.stdin;
  if (!entrada.isTTY) {
    const partes: Buffer[] = [];
    for await (const parte of entrada) partes.push(parte as Buffer);
    return Buffer.concat(partes).toString('utf8').replace(/\r?\n$/, '');
  }
  process.stderr.write('Senha inicial (não aparece na tela): ');
  entrada.setRawMode(true);
  entrada.resume();
  return new Promise((resolver, rejeitar) => {
    let senha = '';
    const aoLer = (bytes: Buffer) => {
      for (const c of bytes.toString('utf8')) {
        if (c === '\r' || c === '\n') return fim(null);
        if (c === '\u0003') return fim(new Error('cancelado'));
        if (c === '\u007f' || c === '\b') senha = senha.slice(0, -1);
        else senha += c;
      }
    };
    const fim = (falha: Error | null) => {
      entrada.off('data', aoLer);
      entrada.setRawMode(false);
      entrada.pause();
      process.stderr.write('\n');
      if (falha) rejeitar(falha);
      else resolver(senha);
    };
    entrada.on('data', aoLer);
  });
}

async function principal() {
  const pedido = lerPedido(process.argv.slice(2));
  const senha = conferirSenha(await lerSenha());
  const { pool } = await import('./db.js');
  const { gerarHashSenha } = await import('./auth.js');
  const cliente = await pool.connect();
  try {
    await criarAdminInicial(cliente, pedido, senha, gerarHashSenha);
    console.log('administrador inicial criado (a designação ficou na trilha de auditoria)');
  } finally {
    cliente.release();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal().catch((falha) => {
    console.error(falha instanceof Error ? falha.message : 'falha ao criar o administrador inicial');
    process.exit(1);
  });
}
