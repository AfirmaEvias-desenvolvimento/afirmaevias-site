-- Afirma Evias | privilégios do papel de RUNTIME do site (site_app), aplicados pelo `node dist/migrate.js --runtime`.
-- Roda como o DONO do banco (o mesmo que aplica db/schema.sql), logo depois do schema, a cada deploy: idempotente.
-- O site_app só faz DML: sem superusuário, sem CREATE no schema, sem ser dono de tabela. O papel é criado antes, à mão
-- (SQL do RAILWAY-PRONTO.md), com a senha que fica só no Postgres; aqui nada de senha.
-- Sem a flag --runtime (o ecossistema local) este arquivo não é lido e nada muda.

DO $$
DECLARE
  papel pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO papel FROM pg_roles WHERE rolname = 'site_app';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Papel site_app ausente: crie-o antes (SQL do RAILWAY-PRONTO.md)';
  END IF;
  IF papel.rolsuper OR papel.rolcreatedb OR papel.rolcreaterole OR papel.rolreplication OR papel.rolbypassrls THEN
    RAISE EXCEPTION 'Papel site_app com privilégio demais (superusuário, CREATEDB, CREATEROLE, REPLICATION ou BYPASSRLS)';
  END IF;
  IF papel.rolname = current_user THEN
    RAISE EXCEPTION 'A migração precisa rodar como o dono do banco, não como site_app';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tableowner = 'site_app') THEN
    RAISE EXCEPTION 'site_app é dono de tabela no schema public: o runtime não pode ter DDL';
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO site_app', current_database());
END
$$;

-- ninguém além do dono cria objeto no schema public (o padrão do PG 15+, explícito para bancos antigos)
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM site_app;
GRANT USAGE ON SCHEMA public TO site_app;

-- DML em todas as tabelas do site (formulários, painel, retenção, fila do Comercial, avisos e feed do RH)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO site_app;
-- Painel Infra (src/wallpaper.ts): atividade_usuario_hora so precisa de INSERT (registro), SELECT (contagem) e DELETE
-- (descarte de 7 dias); sem UPDATE
REVOKE UPDATE ON atividade_usuario_hora FROM site_app;
-- BIGSERIAL do feed (integracao_stream) e qualquer outra sequence
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO site_app;
-- funções do schema (gen_random_uuid do pgcrypto, gatilhos do feed e da eliminação)
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO site_app;
