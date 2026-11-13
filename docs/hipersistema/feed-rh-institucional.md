# Feed do Institucional para o RH (produtor, AEVIAS-HIPERSISTEMA-1.0)

O site é **produtor** da origem `institucional` do RH: o coletor do RH (`rh-collector`) puxa, por mTLS, candidaturas
mínimas (o evento da candidatura, nunca o arquivo do currículo). O site nunca chama o RH. Desligado por padrão: sem `INTEGRACAO_PORT`
nada sobe e o site funciona como antes.

## Endpoints (listener mTLS próprio, sem rotas do site nem do /admin)

| Método e caminho | Capacidade (AUTH) | Resposta |
|---|---|---|
| `GET /internal/capabilities` | `capabilities.read` | `Capabilities` (`app_code=institucional`, `contract_sha256` do pacote vendorizado) |
| `GET /api/integracao/v1/changes?cursor&limit` | `feed.read` | `ChangesResponse` |
| `POST /api/integracao/v1/snapshots` (`Idempotency-Key`) | `feed.read` | `SnapshotCreated` |
| `GET /api/integracao/v1/snapshots/{id}?cursor&limit` | `feed.read` | `SnapshotPage` |
| `GET /api/integracao/v1/reconciliation` | `feed.read` | `Reconciliation` |
| `GET /health/live` | nenhuma (ainda exige certificado de cliente no TLS) | `{status:"live"}` |

Autorização: só a identidade de serviço `rh-collector` (SAN `urn:aevias:service:rh-collector`) passa; a cada requisição o
site pergunta ao AUTH (`POST /v1/service-authorize-peer`, como `institucional-api`, com o SHA-256 do certificado do par)
e nega em qualquer dúvida (fail-closed, sem cache positivo).

## O que é preciso para ligar (registro/certificados ficam com quem cuida do registry e do rh-collector)

1. **Porta mTLS interna do site**: `13809` no ecossistema local (ao lado da 13808 HTTP do site-app; a sequência de portas internas 48xx não é usada aqui),
   em `127.0.0.1`. `base_url` da origem no RH: `https://localhost:13809` (ou o host
   do certificado do servidor).
2. **Capacidades no AUTH**: `rh-collector` com `feed.read` e `capabilities.read` para o app `institucional`, e a
   identidade `institucional-api` registrada (com capacidade `service.authorize`) para o site consultar o AUTH. O
   `institucional-api` já existe por causa da conexão 1 (Comercial).
3. **Certificados**: servidor do listener (SAN com o host/IP da `base_url`), CA que assina os clientes, e o certificado
   cliente `institucional-api` (o mesmo `COMERCIAL_MTLS_CERT/KEY` serve).
4. **Variáveis do site** (ver `.env.example`): `INTEGRACAO_PORT`, `INTEGRACAO_HOST`, `INTEGRACAO_TLS_CERT`,
   `INTEGRACAO_TLS_KEY`, `INTEGRACAO_MTLS_CA`, `INTEGRACAO_AUTH_URL`; opcionais `INTEGRACAO_CLIENT_CERT/KEY`
   (padrão: `COMERCIAL_MTLS_CERT/KEY`), `INTEGRACAO_CURSOR_KEY` (padrão: `SESSION_SECRET`; se mudar, os cursores
   antigos viram 410 e o RH refaz o snapshot), `RELEASE_ID`.
5. **Registro da origem no RH** (`integration_sources` com `app_code=institucional`, `contract_sha256` igual ao de
   `contracts/vendor/auth-v1/manifest.json`, credencial `RH_COLLECTOR_*`). O RH confere `/internal/capabilities`.
6. A migration é o próprio `db/schema.sql` (roda a cada deploy: `migrate` cria tabelas, funções e triggers e publica a
   versão do aviso e as áreas de vaga em `integracao_config`/`integracao_areas`).

## O que sai (contrato `workforce_activity`)

| Evento | Quando | Conteúdo |
|---|---|---|
| `institucional.application.received.v1` | candidatura recebida | `status`, `area_code`, `treatment_version`, `consent_reference`, `historical_snapshot` |
| `institucional.application.status_changed.v1` | mudança de status que altera o estado do contrato | idem; versão +1 |
| qualquer um, `operation=delete` | candidatura excluída (painel, LGPD, retenção de 12 meses) | só ids, versão e datas; `payload` vazio |

Mapa de status: `novo` -> `received`; `em análise`/`entrevista` -> `screening`; `descartado`/`banco de talentos` ->
`closed`. `linked` e `withdrawn` não são gerados (o site não vincula a vaga/pessoa nem registra desistência).
`aggregate_id` = `application:<uuid>`; `source_id` = o uuid opaco. `person_id` e
`actor_auth_user_id` são sempre `null` (candidato é externo); o RH já aceita
isso para `institucional`.

## LGPD / minimização

Nunca entram: nome, e-mail, telefone, mensagem, IP, user-agent, currículo (binário ou nome), observação interna,
e-mail de quem agiu no painel, relatos de integridade, portal do titular, cookies. `area_code` só sai se o texto do
formulário bater com uma área publicada em `content.ts` (o campo é livre no servidor); senão `null`. Exclusão gera
tombstone e remove o item correspondente de snapshots ainda não consumidos; fica só a barreira de versão
(`integracao_versoes`), sem conteúdo.

## Como funciona (e por que o RH aceita)

- Outbox por **trigger** na mesma transação da mudança; sequência por contador sob row lock (ordem de commit).
- Cursor opaco e HMAC; **determinístico por posição** (o RH compara `high_watermark` por igualdade); `changes`
  devolve como `high_watermark` a posição do último item entregue.
- Snapshot em `REPEATABLE READ` com o watermark, páginas imutáveis (24 h), idempotente por `Idempotency-Key`
  (409 se o corpo mudar). Linhas anteriores ao feed entram só por snapshot (versão 1).
- Retenção técnica do outbox: 90 dias (`expurgar`, a cada 6 h); cursor mais antigo, forjado ou de outra chave = 410
  `cursor_expired` e o RH refaz o snapshot.
- Reconciliação: contagens e SHA-256 por partição (`application/<status>`) sobre ids
  opacos, versão e estado, calculados na mesma visão do snapshot.

## Testes

`npm test` (tsc + `node --test`): `src/integracao-feed.test.ts` sobe um Postgres embutido descartável (do repositório
`aevias_comercial_HS`; pula se ausente) e um listener mTLS real com certificados do openssl; um consumidor que replica
as regras do coletor do RH prova bootstrap + delta + tombstone + reconciliação.

## Escopo: só candidaturas (decisão do dono)

O Institucional envia SOMENTE as candidaturas. `institucional.admin_action.recorded.v1` deixou de ser gerado: o trigger e as funções da auditoria foram removidos pela migration (`db/schema.sql`, idempotente), que antes emite um tombstone para cada ação administrativa que já tivesse ido ao feed, para o RH não ficar com fato órfão. Currículo = o evento da candidatura; o contrato (`payload`: status, area_code, treatment_version, consent_reference) não pede o conteúdo do arquivo.
