import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, consultarUm, consultar } from './db.js';
import { config } from './config.js';
import { gerarHashSenha } from './auth.js';
import { vagas } from './content.js';
import { publicarConfiguracao } from './integracao-produtor.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));

async function rodar() {
  const caminhos = [
    path.resolve(aqui, '../db/schema.sql'),
    path.resolve(aqui, '../../db/schema.sql')
  ];
  const caminho = caminhos.find((c) => fs.existsSync(c));
  if (!caminho) throw new Error('schema.sql nao encontrado');

  const sql = fs.readFileSync(caminho, 'utf8');
  await pool.query(sql);
  console.log('schema aplicado');

  // Feed do RH: o trigger precisa da versao do aviso vigente e das areas de vaga publicadas (so elas saem como area_code).
  await publicarConfiguracao(pool, config.versaoPolitica, vagas.areas);

  if (config.admin.email && config.admin.senha) {
    const existente = await consultarUm(
      'SELECT id FROM admin_usuarios WHERE lower(email) = lower($1)',
      [config.admin.email]
    );
    if (!existente) {
      const hash = await gerarHashSenha(config.admin.senha);
      await consultar(
        `INSERT INTO admin_usuarios (nome, email, senha_hash, papel) VALUES ($1,$2,$3,'admin')`,
        [config.admin.nome, config.admin.email, hash]
      );
      console.log(`admin criado: ${config.admin.email}`);
    }
  }

  await pool.end();
}

rodar().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
