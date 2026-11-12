-- Afirma E-vias | schema do site institucional
-- Executado de forma idempotente pelo src/migrate.ts a cada deploy.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- usuarios
CREATE TABLE IF NOT EXISTS admin_usuarios (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome            TEXT        NOT NULL,
  email           TEXT        NOT NULL UNIQUE,
  senha_hash      TEXT        NOT NULL,
  papel           TEXT        NOT NULL DEFAULT 'editor',
  ativo           BOOLEAN     NOT NULL DEFAULT TRUE,
  ultimo_acesso   TIMESTAMPTZ,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_sessoes (
  token           TEXT PRIMARY KEY,
  usuario_id      UUID        NOT NULL REFERENCES admin_usuarios(id) ON DELETE CASCADE,
  ip              TEXT,
  user_agent      TEXT,
  expira_em       TIMESTAMPTZ NOT NULL,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessoes_expira ON admin_sessoes (expira_em);

-- ------------------------------------------------------------- formularios
CREATE TABLE IF NOT EXISTS contatos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome            TEXT        NOT NULL,
  sobrenome       TEXT,
  email           TEXT        NOT NULL,
  telefone        TEXT,
  empresa         TEXT,
  assunto         TEXT,
  mensagem        TEXT        NOT NULL,
  origem          TEXT        NOT NULL DEFAULT 'home',
  status          TEXT        NOT NULL DEFAULT 'novo',
  observacao      TEXT,
  consentimento   BOOLEAN     NOT NULL DEFAULT FALSE,
  ip              TEXT,
  user_agent      TEXT,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contatos_criado ON contatos (criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_contatos_status ON contatos (status);

-- CNPJ opcional do formulario de contato (so digitos). Vai ao Comercial como dado de empresa.
ALTER TABLE contatos ADD COLUMN IF NOT EXISTS cnpj TEXT;

-- Fila de saida dos contatos para o Comercial (conexao 1, C12). So existe linha quando a integracao esta ligada
-- (COMERCIAL_API_URL). Guarda estado de entrega, nunca copia dado pessoal: o corpo e montado de contatos no envio.
-- ON DELETE CASCADE: apagar o contato (retencao de 24 meses, painel, LGPD) apaga a fila dele.
CREATE TABLE IF NOT EXISTS leads_comercial (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contato_id         UUID        NOT NULL UNIQUE REFERENCES contatos(id) ON DELETE CASCADE,
  chave              TEXT        NOT NULL UNIQUE,
  privacidade_versao TEXT        NOT NULL,
  status             TEXT        NOT NULL DEFAULT 'pendente',
  tentativas         INTEGER     NOT NULL DEFAULT 0,
  proxima_tentativa  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_http        INTEGER,
  ultimo_codigo      TEXT,
  lead_id            UUID,
  estado             TEXT,
  enviado_em         TIMESTAMPTZ,
  criado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_leads_comercial_fila ON leads_comercial (proxima_tentativa) WHERE status = 'pendente';

CREATE TABLE IF NOT EXISTS candidaturas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome            TEXT        NOT NULL,
  sobrenome       TEXT,
  email           TEXT        NOT NULL,
  telefone        TEXT,
  area            TEXT,
  mensagem        TEXT,
  arquivo_nome    TEXT,
  arquivo_tipo    TEXT,
  arquivo_bytes   INTEGER,
  arquivo_dados   BYTEA,
  status          TEXT        NOT NULL DEFAULT 'novo',
  observacao      TEXT,
  consentimento   BOOLEAN     NOT NULL DEFAULT FALSE,
  ip              TEXT,
  user_agent      TEXT,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_candidaturas_criado ON candidaturas (criado_em DESC);

-- Relato de integridade. Pode ser anonimo: email/nome sao opcionais.
-- O protocolo e o unico dado que o relator leva embora.
CREATE TABLE IF NOT EXISTS relatos_integridade (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protocolo       TEXT        NOT NULL UNIQUE,
  titulo          TEXT        NOT NULL,
  relato          TEXT        NOT NULL,
  categoria       TEXT,
  anonimo         BOOLEAN     NOT NULL DEFAULT TRUE,
  nome            TEXT,
  email           TEXT,
  status          TEXT        NOT NULL DEFAULT 'recebido',
  resposta        TEXT,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------- LGPD
-- Requisicoes de titular (art. 18 da Lei 13.709/2018)
CREATE TABLE IF NOT EXISTS solicitacoes_lgpd (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protocolo       TEXT        NOT NULL UNIQUE,
  tipo            TEXT        NOT NULL,
  nome            TEXT        NOT NULL,
  email           TEXT        NOT NULL,
  documento       TEXT,
  detalhes        TEXT,
  status          TEXT        NOT NULL DEFAULT 'recebida',
  resposta        TEXT,
  respondida_em   TIMESTAMPTZ,
  prazo_em        TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '15 days'),
  ip              TEXT,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lgpd_status ON solicitacoes_lgpd (status, prazo_em);

-- Prova de consentimento de cookies (guardamos so o hash do IP)
CREATE TABLE IF NOT EXISTS consentimentos_cookies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitante_id    TEXT        NOT NULL,
  necessarios     BOOLEAN     NOT NULL DEFAULT TRUE,
  analiticos      BOOLEAN     NOT NULL DEFAULT FALSE,
  marketing       BOOLEAN     NOT NULL DEFAULT FALSE,
  versao_politica TEXT        NOT NULL,
  ip_hash         TEXT,
  user_agent      TEXT,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_consent_visitante ON consentimentos_cookies (visitante_id, criado_em DESC);

-- ----------------------------------------------------------------- auditoria
CREATE TABLE IF NOT EXISTS auditoria (
  id              BIGSERIAL PRIMARY KEY,
  usuario_id      UUID REFERENCES admin_usuarios(id) ON DELETE SET NULL,
  usuario_email   TEXT,
  acao            TEXT        NOT NULL,
  entidade        TEXT,
  entidade_id     TEXT,
  detalhes        JSONB,
  ip              TEXT,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auditoria_criado ON auditoria (criado_em DESC);

-- Índices que faltavam para as consultas que o painel e o descarte realmente
-- fazem: as três tabelas abaixo são listadas com ORDER BY criado_em DESC, e
-- duas delas também são varridas por data pela rotina de retenção. Sem estes
-- índices o Postgres faz varredura completa, o que só aparece quando a tabela
-- cresce — consentimentos_cookies ganha uma linha por escolha de visitante.
CREATE INDEX IF NOT EXISTS idx_relatos_criado ON relatos_integridade (criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_relatos_status ON relatos_integridade (status);
CREATE INDEX IF NOT EXISTS idx_lgpd_criado ON solicitacoes_lgpd (criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_consent_criado ON consentimentos_cookies (criado_em DESC);

-- Tentativas de login malsucedidas, para frear ataque de senha contra uma conta
-- específica. A chave é o e-mail digitado, exista ele ou não: se só contássemos
-- para contas reais, o comportamento diferente entre um e-mail existente e um
-- inventado devolveria a enumeração de usuário que o hash de espera fechou.
CREATE TABLE IF NOT EXISTS tentativas_login (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT        NOT NULL,
  ip              TEXT,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tentativas_email ON tentativas_login (email, criado_em DESC);

-- ------------------------------------------------- eliminacao no Comercial
-- Quando o site apaga um contato cujo lead JA foi entregue, esta pendencia e encerrada apos confirmacao do Comercial.
-- Nao guarda dado pessoal de proposito: so o id do lead devolvido pelo Comercial (UUID opaco), datas, origem, status e o id
-- (UUID) de quem agiu no painel. Nome, e-mail, telefone, CNPJ e mensagem NUNCA entram aqui (ha teste cobrando).
CREATE TABLE IF NOT EXISTS eliminacoes_comercial (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id          UUID        NOT NULL UNIQUE,
  pedido_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  origem           TEXT        NOT NULL CHECK (origem IN ('painel', 'retencao')),
  registrado_por   UUID        REFERENCES admin_usuarios(id) ON DELETE SET NULL,
  status           TEXT        NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'concluida')),
  concluida_em     TIMESTAMPTZ,
  concluida_por    UUID        REFERENCES admin_usuarios(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_elim_comercial_status ON eliminacoes_comercial (status, pedido_em);

-- Registra a pendencia NA MESMA transacao e ANTES de o contato sumir, por qualquer caminho (painel, retencao de 24 meses,
-- SQL manual). So existe pendencia quando o lead foi entregue (lead_id preenchido); fila pendente/rejeitada nao gera nada.
-- Quem apagou vem das variaveis de sessao 'site.eliminacao_origem' / 'site.eliminacao_por' (definidas so pelo painel, via
-- set_config local a transacao); sem elas e a retencao automatica.
CREATE OR REPLACE FUNCTION registrar_eliminacao_comercial() RETURNS trigger AS $fn$
BEGIN
  INSERT INTO eliminacoes_comercial (lead_id, origem, registrado_por)
  SELECT l.lead_id,
         CASE WHEN current_setting('site.eliminacao_origem', true) = 'painel' THEN 'painel' ELSE 'retencao' END,
         NULLIF(current_setting('site.eliminacao_por', true), '')::uuid
    FROM leads_comercial l
   WHERE l.contato_id = OLD.id AND l.lead_id IS NOT NULL
  ON CONFLICT (lead_id) DO NOTHING;
  RETURN OLD;
END
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS contatos_eliminacao_comercial ON contatos;
CREATE TRIGGER contatos_eliminacao_comercial BEFORE DELETE ON contatos
  FOR EACH ROW EXECUTE FUNCTION registrar_eliminacao_comercial();

-- ===================================================================================================================
-- Produtor de feed para o RH (origem 'institucional', contrato AEVIAS-HIPERSISTEMA-1.0, stream workforce_activity).
-- O outbox e gravado POR TRIGGER, na mesma transacao da mudanca (candidaturas e auditoria do painel), para cobrir todo
-- caminho de escrita (painel, formulario, retencao, SQL manual). Contador de sequencia sob row lock mantido ate o commit:
-- a ordem do cursor e a ordem de commit. LGPD: o evento NUNCA leva nome, e-mail, telefone, mensagem, IP, curriculo nem
-- texto livre; so ids opacos, estado, area (apenas se for uma das areas publicadas), versao do aviso e referencia de aceite.
-- ===================================================================================================================
CREATE TABLE IF NOT EXISTS integracao_stream (
  stream          TEXT   PRIMARY KEY,
  sequence        BIGINT NOT NULL DEFAULT 0,
  retained_after  BIGINT NOT NULL DEFAULT 0
);
INSERT INTO integracao_stream (stream) VALUES ('workforce_activity') ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS integracao_outbox (
  sequence      BIGINT      PRIMARY KEY,
  aggregate_id  TEXT        NOT NULL,
  event         JSONB       NOT NULL,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_integracao_outbox_criado ON integracao_outbox (criado_em);

-- Maior aggregate_version por agregado; sobrevive a exclusao como barreira tecnica (sem dado pessoal) contra ressurreicao.
CREATE TABLE IF NOT EXISTS integracao_versoes (
  aggregate_id  TEXT    PRIMARY KEY,
  version       INTEGER NOT NULL,
  deleted       BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS integracao_snapshots (
  id              UUID        PRIMARY KEY,
  consumer        TEXT        NOT NULL,
  operation_key   TEXT        NOT NULL,
  request_hash    TEXT        NOT NULL,
  request_id      UUID        NOT NULL,
  high_watermark  BIGINT      NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (consumer, operation_key)
);
CREATE TABLE IF NOT EXISTS integracao_snapshot_itens (
  snapshot_id   UUID  NOT NULL REFERENCES integracao_snapshots (id) ON DELETE CASCADE,
  aggregate_id  TEXT  NOT NULL,
  event         JSONB NOT NULL,
  PRIMARY KEY (snapshot_id, aggregate_id)
);
CREATE INDEX IF NOT EXISTS idx_integracao_snap_itens_agg ON integracao_snapshot_itens (aggregate_id);

-- Configuracao publicada pela aplicacao a cada migrate: versao do aviso de privacidade vigente e areas de vaga publicadas.
CREATE TABLE IF NOT EXISTS integracao_config (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS integracao_areas (slug TEXT PRIMARY KEY);

CREATE OR REPLACE FUNCTION integracao_slug(t TEXT) RETURNS TEXT AS $fn$
  SELECT left(trim(both '-' from regexp_replace(lower(translate(coalesce(t, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn')),
    '[^a-z0-9]+', '-', 'g')), 64)
$fn$ LANGUAGE sql IMMUTABLE;

-- Status do painel -> enum do contrato (received|screening|linked|closed|withdrawn). 'banco de talentos' encerra a
-- selecao (nao ha vinculo a vaga/pessoa), por isso 'closed'; nenhum fluxo do site gera 'withdrawn' nem 'linked'.
CREATE OR REPLACE FUNCTION integracao_status_candidatura(s TEXT) RETURNS TEXT AS $fn$
  SELECT CASE s WHEN 'em análise' THEN 'screening' WHEN 'entrevista' THEN 'screening'
                WHEN 'banco de talentos' THEN 'closed' WHEN 'descartado' THEN 'closed' ELSE 'received' END
$fn$ LANGUAGE sql IMMUTABLE;

-- Area do formulario so sai se for uma area publicada (o campo e texto livre no servidor); senao null.
CREATE OR REPLACE FUNCTION integracao_area(a TEXT) RETURNS TEXT AS $fn$
  SELECT (SELECT slug FROM integracao_areas WHERE slug = integracao_slug(a))
$fn$ LANGUAGE sql STABLE;

-- Acao do painel -> {categoria, acao} do contrato; null = nao entra no feed (login, senha, usuarios, relatos, LGPD...).
CREATE OR REPLACE FUNCTION integracao_admin_acao(p_acao TEXT, p_entidade TEXT) RETURNS TEXT[] AS $fn$
  SELECT CASE
    WHEN p_entidade = 'candidaturas' AND p_acao = 'registro.atualizado' THEN ARRAY['recruitment', 'updated']
    WHEN p_entidade = 'candidaturas' AND p_acao = 'registro.excluido'   THEN ARRAY['recruitment', 'closed']
    WHEN p_entidade = 'contatos'     AND p_acao = 'registro.atualizado' THEN ARRAY['general_service', 'updated']
    WHEN p_entidade = 'contatos'     AND p_acao = 'registro.excluido'   THEN ARRAY['general_service', 'closed']
    ELSE NULL END
$fn$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION integracao_ts(t TIMESTAMPTZ) RETURNS TEXT AS $fn$
  SELECT to_char(t AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$fn$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION integracao_emitir(p_type TEXT, p_aggregate TEXT, p_source TEXT, p_version INTEGER, p_op TEXT,
                                             p_payload JSONB, p_occurred TIMESTAMPTZ) RETURNS VOID AS $fn$
DECLARE seq BIGINT;
BEGIN
  UPDATE integracao_stream SET sequence = sequence + 1 WHERE stream = 'workforce_activity' RETURNING sequence INTO seq;
  INSERT INTO integracao_outbox (sequence, aggregate_id, event) VALUES (seq, p_aggregate, jsonb_build_object(
    'event_id', gen_random_uuid(), 'source_system', 'institucional', 'stream', 'workforce_activity',
    'sequence', seq::text, 'event_type', p_type, 'schema_version', 1, 'source_id', p_source,
    'aggregate_id', p_aggregate, 'aggregate_version', p_version, 'person_id', NULL::text, 'actor_auth_user_id', NULL::text,
    'occurred_at', integracao_ts(p_occurred), 'recorded_at', integracao_ts(now()),
    'effective_date', (p_occurred AT TIME ZONE 'America/Sao_Paulo')::date,
    'operation', p_op, 'payload', p_payload, 'trace_id', gen_random_uuid()));
  INSERT INTO integracao_versoes (aggregate_id, version, deleted) VALUES (p_aggregate, p_version, p_op = 'delete')
    ON CONFLICT (aggregate_id) DO UPDATE SET version = EXCLUDED.version, deleted = EXCLUDED.deleted;
END
$fn$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION integracao_trg_candidatura() RETURNS trigger AS $fn$
DECLARE agg TEXT; v INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    agg := 'application:' || OLD.id;
    SELECT version + 1 INTO v FROM integracao_versoes WHERE aggregate_id = agg;
    PERFORM integracao_emitir('institucional.application.status_changed.v1', agg, OLD.id::text, coalesce(v, 2), 'delete',
                              '{}'::jsonb, now());
    -- minimizacao: o item ainda nao consumido de um snapshot em andamento some junto com a candidatura
    DELETE FROM integracao_snapshot_itens WHERE aggregate_id = agg;
    RETURN OLD;
  END IF;
  agg := 'application:' || NEW.id;
  IF TG_OP = 'INSERT' THEN
    PERFORM integracao_emitir('institucional.application.received.v1', agg, NEW.id::text, 1, 'upsert', jsonb_build_object(
      'status', integracao_status_candidatura(NEW.status), 'area_code', integracao_area(NEW.area),
      'treatment_version', coalesce((SELECT valor FROM integracao_config WHERE chave = 'privacidade_versao'), 'nao-registrada'),
      'consent_reference', CASE WHEN NEW.consentimento THEN 'site:candidatura:' || NEW.id ELSE NULL END,
      'historical_snapshot', false), NEW.criado_em);
  ELSIF integracao_status_candidatura(OLD.status) IS DISTINCT FROM integracao_status_candidatura(NEW.status) THEN
    SELECT version + 1 INTO v FROM integracao_versoes WHERE aggregate_id = agg;
    PERFORM integracao_emitir('institucional.application.status_changed.v1', agg, NEW.id::text, coalesce(v, 2), 'upsert',
      jsonb_build_object('status', integracao_status_candidatura(NEW.status), 'area_code', integracao_area(NEW.area),
      'treatment_version', coalesce((SELECT valor FROM integracao_config WHERE chave = 'privacidade_versao'), 'nao-registrada'),
      'consent_reference', CASE WHEN NEW.consentimento THEN 'site:candidatura:' || NEW.id ELSE NULL END,
      'historical_snapshot', false), now());
  END IF;
  RETURN NEW;
END
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS candidaturas_integracao ON candidaturas;
CREATE TRIGGER candidaturas_integracao AFTER INSERT OR UPDATE OF status OR DELETE ON candidaturas
  FOR EACH ROW EXECUTE FUNCTION integracao_trg_candidatura();

-- Atividade administrativa por categoria. O site NAO tem identidade AUTH nem pessoa RH: ator e pessoa saem null e o
-- e-mail/IP de quem agiu NUNCA vai ao feed.
CREATE OR REPLACE FUNCTION integracao_trg_auditoria() RETURNS trigger AS $fn$
DECLARE agg TEXT; m TEXT[]; v INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    agg := 'admin_action:' || OLD.id;
    SELECT version + 1 INTO v FROM integracao_versoes WHERE aggregate_id = agg AND NOT deleted;
    IF v IS NOT NULL THEN
      PERFORM integracao_emitir('institucional.admin_action.recorded.v1', agg, OLD.id::text, v, 'delete', '{}'::jsonb, now());
    END IF;
    RETURN OLD;
  END IF;
  m := integracao_admin_acao(NEW.acao, NEW.entidade);
  IF m IS NOT NULL THEN
    PERFORM integracao_emitir('institucional.admin_action.recorded.v1', 'admin_action:' || NEW.id, NEW.id::text, 1, 'upsert',
      jsonb_build_object('category', m[1], 'action', m[2], 'historical_snapshot', false), NEW.criado_em);
  END IF;
  RETURN NEW;
END
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS auditoria_integracao ON auditoria;
CREATE TRIGGER auditoria_integracao AFTER INSERT OR DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION integracao_trg_auditoria();

-- Linhas que ja existiam antes do feed: entram so pelo snapshot (versao 1), sem evento retroativo no outbox.
INSERT INTO integracao_versoes (aggregate_id, version)
  SELECT 'application:' || c.id, 1 FROM candidaturas c ON CONFLICT DO NOTHING;
INSERT INTO integracao_versoes (aggregate_id, version)
  SELECT 'admin_action:' || a.id, 1 FROM auditoria a WHERE integracao_admin_acao(a.acao, a.entidade) IS NOT NULL
  ON CONFLICT DO NOTHING;
