import { pool, consultarUm, consultar } from './db.js';
import { config } from './config.js';
import { gerarHashSenha } from './auth.js';
import { vagas } from './content.js';
import { publicarConfiguracao } from './integracao-produtor.js';
import { aplicarRuntime, lerSql, pedeRuntime } from './migracao.js';

async function rodar() {
  await pool.query(lerSql('schema.sql'));
  console.log('schema aplicado');

  // Railway (serviço site-migrate): `node dist/migrate.js --runtime` concede ao papel site_app só DML (db/runtime.sql).
  // Sem a flag (ecossistema local, que roda como o dono e sem papel separado) nada muda.
  if (pedeRuntime()) {
    await aplicarRuntime(pool);
    console.log('privilegios do site_app aplicados');
  }

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
