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
-- O Comercial (C12) nao tem exclusao de lead: quando o site apaga um contato cujo lead JA foi entregue, o lead continua la.
-- Esta tabela e a PENDENCIA que obriga um humano do Comercial a elimina-lo pelo painel dele e a marcar aqui como concluida.
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
