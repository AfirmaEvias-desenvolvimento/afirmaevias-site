# RAILWAY-PRONTO — afirmaevias-site (Site institucional)

Fase 0 (preparação do código para a Railway), feita em 19/11/2026. Nenhum deploy foi feito. O Site não estava no plano
original do guia do Chrome e entra agora com os serviços `site` e `site-migrate` e o Postgres `pg-site`.

- **Repositório:** `AfirmaEvias-desenvolvimento/afirmaevias-site`, branch `main`.
- **Commit da Fase 0:** `2058ae78cf149835cac026cf83d7df602744658a` (o código; este arquivo foi atualizado no commit seguinte só para registrar o hash).
- **Imagem:** não construída localmente (Docker não roda nesta máquina, falta o WSL). Build (`npm ci` + `npm run build`),
  dependências de produção, layout da imagem, migração com `--runtime` e subida com `site_app` + `PUBLIC_HTTP=1` +
  `HOST=::` foram conferidos fora do Docker, numa cópia temporária, com Postgres embutido.
- **Comportamento local:** sem `PUBLIC_HTTP`/`HOST` e sem `--runtime`, o site continua exatamente como antes
  (`trustProxy: true` atrás da borda TLS local, `0.0.0.0`, migração sem GRANTs).
- **Projeto Railway antigo do site:** existe um projeto anterior (`noble-surprise`) que fez deploy deste repositório até
  27/10/2026 com Nixpacks e o `railway.json` da raiz. **Esse arquivo não foi alterado** e não há `Dockerfile` na raiz,
  para não mudar o build daquele projeto. A imagem nova fica em `deploy/railway/Dockerfile`. Não mexa no projeto antigo.
- **Correção de 19/11/2026 (1º deploy no `aevias-hipersistema`):** a Railway aplicou o **build** do `railway.json` da raiz ao serviço novo
  (saiu Nixpacks e falhou), e o campo Config-as-code do painel não pode mais ser preenchido. Por isso o `build` da raiz passou a ser
  `DOCKERFILE` + `deploy/railway/Dockerfile`. O `deploy` da raiz ficou igual, e `npm run migrate && npm start` funciona na imagem.
  Nos serviços novos vale o start command do painel (embrulho), como já acontece com o RH. O projeto antigo não faz deploy
  deste repositório desde 27/10 (GitHub Deployments); se voltar a fazer, sai pela imagem do Dockerfile.

## O que o Site é (levantamento)

- Fastify 5 + EJS (SSR), Postgres próprio, sem build de front. Páginas públicas anônimas e formulários (contato, currículo,
  relato de integridade, portal do titular LGPD, consentimento de cookies).
- **Painel `/admin` com login PRÓPRIO** (e-mail e senha bcrypt em `admin_usuarios`, sessão em `admin_sessoes`, cookie
  `ae_sessao`). **Não usa o AUTH** para login; papéis `admin` e `editor`. Sem MFA.
- **Uploads:** currículos (PDF/DOC/DOCX até 5 MB) ficam no Postgres (`bytea`). **Nada é gravado em disco: sem volume.**
- Não depende de AUTH nem de RH para servir páginas e formulários.

## Serviços Railway

**O Config-as-code não é aplicado em serviço novo: configure tudo no painel com os valores abaixo.** Em
**Settings → Config-as-code**, deixe o campo vazio. **Nunca** aponte para o `railway.json` da raiz (é o do projeto antigo:
Nixpacks e `npm run migrate && npm start`). Se a Railway mostrar esse arquivo aplicado, remova-o. Os arquivos
`deploy/railway/site.json` e `deploy/railway/site-migrate.json` trazem os mesmos valores, só como referência.

| Campo no painel | `site` | `site-migrate` |
|---|---|---|
| Source | repo `afirmaevias-site`, branch `main` | o mesmo |
| Builder | Dockerfile | Dockerfile |
| **Dockerfile Path** (`RAILWAY_DOCKERFILE_PATH`) | `deploy/railway/Dockerfile` | `deploy/railway/Dockerfile` |
| Contexto | raiz do repositório (padrão) | raiz |
| `<COMANDO>` | `node dist/server.js` | `node dist/migrate.js --runtime` |
| **Custom Start Command** (digitar exatamente) | ver bloco 1 abaixo | ver bloco 2 abaixo |
| **Healthcheck Path** | `/health/live` (timeout 120 s) | **nenhum** (apague se vier preenchido) |
| **Restart Policy** | On Failure, 5 tentativas | **Never** |
| Replicas | 1 (limites de login e de formulário ficam em memória) | 1 |
| Portas | `8080` (`PORT`, HTTP atrás da borda). Opcional: `9557` (feed do RH, mTLS, só rede privada) | nenhuma |
| **Domínio público** | **sim**: Settings → Networking → Generate Domain, **porta-alvo `8080`** | não |
| Volume | nenhum | nenhum |
| Private Networking | ligado (host `site.railway.internal`) | ligado |

Bloco 1, Custom Start Command do `site`:

```sh
sh -c 'umask 077 && mkdir -p /tmp/arq && for v in $(env | grep -o "^[A-Z0-9_]*_CONTEUDO=" | tr -d =); do printenv "$v" > "/tmp/arq/$v"; done && exec node dist/server.js'
```

Bloco 2, Custom Start Command do `site-migrate`:

```sh
sh -c 'umask 077 && mkdir -p /tmp/arq && for v in $(env | grep -o "^[A-Z0-9_]*_CONTEUDO=" | tr -d =); do printenv "$v" > "/tmp/arq/$v"; done && exec node dist/migrate.js --runtime'
```

Imagem: `node:22-bookworm-slim` (a linha do `engines` e do CI), `USER node` (UID 1000), `WORKDIR /app`. Tem `sh`, `grep`,
`tr`, `printenv` e `env` (conferidos no próprio build), e `/tmp` é gravável pelo `node`. Não precisa de `RAILWAY_RUN_UID`.

Saúde:
- `GET /health/live` (novo): só diz que o processo responde; não consulta banco, AUTH nem RH. É o healthcheck da Railway.
- `GET /health` (o de sempre): `SELECT 1` no banco. Serve de prontidão pela rede privada
  (`http://site.railway.internal:8080/health`).

## Postgres `pg-site`

- **New → Database → PostgreSQL**, nome `pg-site`, imagem `ghcr.io/railwayapp-templates/postgres-ssl:18` (major 18, como
  os demais). **Sem domínio público e sem TCP Proxy.** Em produção o site conecta com SSL (`rejectUnauthorized: false`,
  `src/db.ts`), que essa imagem aceita.
- No próprio `pg-site`, crie a variável `SITE_APP_PASSWORD` = segredo novo, 64 hex (`${{secret(64, "0123456789abcdef")}}`).
- Banco `afirmaevias` (o mesmo nome do local), papel de runtime `site_app`.

### SQL manual (Apêndice A do site; antes do primeiro `site-migrate`, como `postgres`)

Forma preferida, com a senha vinda da variável do próprio Postgres (nada de senha digitada nem colada):

```sh
railway ssh --service pg-site
psql -v ON_ERROR_STOP=1 -v pw="$SITE_APP_PASSWORD" -U "$PGUSER" -d postgres <<'SQL'
CREATE DATABASE afirmaevias ENCODING 'UTF8' TEMPLATE template0;
CREATE ROLE site_app LOGIN PASSWORD :'pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
SQL
```

Se só houver a aba **Data/Query** do painel, rode o mesmo SQL trocando `:'pw'` por `'<valor de SITE_APP_PASSWORD>'`
(sem registrar o valor em lugar nenhum):

```sql
CREATE DATABASE afirmaevias ENCODING 'UTF8' TEMPLATE template0;
CREATE ROLE site_app LOGIN PASSWORD '<SENHA>' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
```

**Depois da migração não há SQL manual:** o `site-migrate` aplica os GRANTs (`db/runtime.sql`) a cada deploy.

## Migração (`site-migrate`)

```sh
node dist/migrate.js --runtime
```

1. Aplica `db/schema.sql` (idempotente; cria `pgcrypto`, tabelas, funções e gatilhos), como o dono.
2. Com `--runtime`, aplica `db/runtime.sql`: confere que `site_app` existe e não tem superusuário, `CREATEDB`,
   `CREATEROLE`, replicação nem `BYPASSRLS` e não é dono de tabela; revoga `CREATE` no schema `public`; concede só
   `SELECT/INSERT/UPDATE/DELETE` nas tabelas, uso das sequences e `EXECUTE` nas funções. Tudo numa transação.
3. Publica a versão do aviso de privacidade e as áreas de vaga (configuração do feed do RH).
4. Sem `ADMIN_EMAIL`/`ADMIN_PASSWORD` (não crie essas variáveis na Railway), **não cria admin**.

- Idempotente: pode rodar a cada deploy. Termina com código 0 ("schema aplicado" e "privilegios do site_app aplicados").
- Sem o papel: para com "Papel site_app ausente" e código 1. A URL e a senha não aparecem no log.
- Aviso esperado no log do migrate: "SESSION_SECRET nao configurada" (o migrate não usa sessão; ignore, não copie o
  segredo para ele).
- Ordem: SQL do `pg-site` → `site-migrate` (Completed/Exit 0) → `site`.

## Variáveis

`pg-site` = o Postgres `pg-site`. As URLs de banco usam a rede privada.

### `site`

| Variável | Valor / origem | `_CONTEUDO`? |
|---|---|---|
| `NODE_ENV` | `production` (compartilhada) | não |
| `HOST` | `::` | não |
| `PORT` | `8080` | não |
| `PUBLIC_HTTP` | `1` (HTTP atrás da borda; confia em exatamente 1 salto de proxy) | não |
| `DATABASE_URL` | `postgresql://site_app:${{pg-site.SITE_APP_PASSWORD}}@${{pg-site.PGHOST}}:${{pg-site.PGPORT}}/afirmaevias` | não |
| `SESSION_SECRET` | segredo novo, 64 hex (sem ela o painel desloga a cada deploy) | não |
| `SITE_URL` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` (canonical, sitemap, robots e link dos avisos; ver pendência 3) | não |
| `PORTAL_CLIENTE_URL` | `https://comercial-production-95d6c4ec.up.railway.app/` (botão "Área do cliente" no Comercial deste projeto; ver pendência 4) | não |
| `COMERCIAL_API_URL` | `https://comercial.railway.internal:9555` (conexão 1: contato vira lead no Comercial) | não |
| `COMERCIAL_MTLS_CA` | `/tmp/arq/COMERCIAL_MTLS_CA_CONTEUDO` (CA nova da Railway) | caminho; `COMERCIAL_MTLS_CA_CONTEUDO` (Fase 4) |
| `COMERCIAL_MTLS_CERT` | `/tmp/arq/COMERCIAL_MTLS_CERT_CONTEUDO` (cliente `URI:urn:aevias:service:institucional-api`) | caminho; `COMERCIAL_MTLS_CERT_CONTEUDO` (Fase 4) |
| `COMERCIAL_MTLS_KEY` | `/tmp/arq/COMERCIAL_MTLS_KEY_CONTEUDO` | caminho; `COMERCIAL_MTLS_KEY_CONTEUDO` (Fase 4) |
| `RESEND_API_KEY`, `EMAIL_REMETENTE`, `EMAIL_CONTATO`, `EMAIL_RH`, `EMAIL_COMPLIANCE`, `EMAIL_ENCARREGADO` | só se o dono fornecer; sem `RESEND_API_KEY` os avisos ficam na fila do banco e tudo segue no `/admin` | não |

O `site` **pode subir antes da Fase 4**: sem os arquivos `COMERCIAL_MTLS_*`, a conexão 1 fica desligada (um aviso
"integração com o Comercial desligada" no log) e os contatos ficam só no `/admin`. Depois da Fase 4, um restart a liga.

**Feed do RH (opcional; deixe DESLIGADO por ora).** O RH da Railway está configurado sem a fonte `institucional`
(`RH_PRODUCER_CODES=controle,laboratorio`; o `RAILWAY-PRONTO.md` do `aevias-rh` deixa Site/institucional fora do registry).
Sem `INTEGRACAO_PORT` nada sobe. Para ligar no futuro (decisão do dono), acrescente no `site`:

| Variável | Valor / origem | `_CONTEUDO`? |
|---|---|---|
| `INTEGRACAO_PORT` | `9557` | não |
| `INTEGRACAO_HOST` | `::` (o padrão do código é `127.0.0.1`, que não aceita a rede privada) | não |
| `INTEGRACAO_AUTH_URL` | `${{shared.AUTH_INTERNAL_URL}}` | não |
| `INTEGRACAO_MTLS_CA` | `/tmp/arq/INTEGRACAO_MTLS_CA_CONTEUDO` (CA nova da Railway: confere o `rh-collector` e o AUTH) | caminho; `INTEGRACAO_MTLS_CA_CONTEUDO` (Fase 4) |
| `INTEGRACAO_TLS_CERT` | `/tmp/arq/INTEGRACAO_TLS_CERT_CONTEUDO` (servidor, SAN `DNS:site.railway.internal`) | caminho; `INTEGRACAO_TLS_CERT_CONTEUDO` (Fase 4) |
| `INTEGRACAO_TLS_KEY` | `/tmp/arq/INTEGRACAO_TLS_KEY_CONTEUDO` | caminho; `INTEGRACAO_TLS_KEY_CONTEUDO` (Fase 4) |
| `INTEGRACAO_CLIENT_CERT/KEY` | não crie: o padrão já é o `COMERCIAL_MTLS_CERT/KEY` (identidade `institucional-api`) | não |

Não crie no `site`: `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NOME` (senha de pessoa em variável), a credencial do dono
(`${{pg-site.PGUSER}}`/`PGPASSWORD`), `AEVIAS_SENHA_PADRAO`, `AUTH_MFA`, `COOKIE_INSECURE`. `AUTH_ISSUER_URL`,
`AUTH_INTERNAL_URL` e `RH_INTERNAL_URL` não são lidas pelo site (as compartilhadas do projeto não atrapalham).

### `site-migrate`

| Variável | Valor / origem | `_CONTEUDO`? |
|---|---|---|
| `NODE_ENV` | `production` (compartilhada) | não |
| `DATABASE_URL` | `postgresql://${{pg-site.PGUSER}}:${{pg-site.PGPASSWORD}}@${{pg-site.PGHOST}}:${{pg-site.PGPORT}}/afirmaevias` (**o dono**; só aqui) | não |

O migrate do site lê `DATABASE_URL` (não `MIGRATION_DATABASE_URL`): no `site-migrate` ela é a credencial do dono, no `site`
é a do `site_app`. Nenhuma outra variável.

## Conexões do Site

| Direção | Destino / origem | Protocolo | Variáveis | Estado na Railway |
|---|---|---|---|---|
| Site → Comercial (conexão 1) | `comercial.railway.internal:9555`, `POST/GET/DELETE /api/integracao/v1/comercial/leads` | HTTPS mTLS, cliente `institucional-api`; o Comercial confere no AUTH `comercial.lead.create/read/delete` | `COMERCIAL_API_URL`, `COMERCIAL_MTLS_*` | pronto no código; depende da Fase 4 (certificado `institucional-api` não existe na PKI) |
| Site → AUTH | `auth.railway.internal:9446`, `POST /v1/service-authorize-peer` | HTTPS mTLS, cliente `institucional-api` | `INTEGRACAO_AUTH_URL` | só com o feed ligado |
| RH (`rh-collector`) → Site | `site.railway.internal:9557` (`/internal/capabilities`, `/api/integracao/v1/changes`, `snapshots`, `reconciliation`) | HTTPS mTLS; só a identidade `rh-collector` passa, e o AUTH confirma `feed.read`/`capabilities.read` no app `institucional` | `INTEGRACAO_*` | desligado (o RH não tem a fonte) |
| Site → Resend | `api.resend.com` | HTTPS (API key) | `RESEND_API_KEY`, `EMAIL_*` | desligado sem a chave |
| Site → Comercial (link) | domínio público do `comercial` | só link no navegador | `PORTAL_CLIENTE_URL` | ligado |

Não há SMTP, NPS, S&L, Projetos, Laboratório nem Controle. O Site não chama o RH (o RH é que puxa o feed). Login do
`/admin` é próprio (não passa pelo AUTH).

## O que o AUTH precisa emitir e registrar (Fase 4; o `aevias-auth` não foi alterado)

A PKI da Railway (`aevias-auth/scripts/railway-pki.mjs`) não tem nada do Site: `CLIENT_IDS` não inclui
`institucional-api` e `SERVER_SERVICES` não inclui `site`. Para ligar as conexões:

1. **Conexão 1 (necessária para os contatos virarem lead):**
   - certificado de **cliente** `institucional-api`, SAN `URI:urn:aevias:service:institucional-api`, EKU `clientAuth`,
     assinado pela CA nova da Railway → `COMERCIAL_MTLS_CERT_CONTEUDO` / `COMERCIAL_MTLS_KEY_CONTEUDO` no `site`;
   - a CA da Railway → `COMERCIAL_MTLS_CA_CONTEUDO` no `site` (o Site confia nela para o servidor
     `comercial.railway.internal`; o Comercial confia nela para o cliente `institucional-api`);
   - no registro de serviços do AUTH (`AUTH_SERVICES_CONTEUDO`): `institucional-api` com o fingerprint SHA-256 do
     certificado novo e as capacidades `comercial.lead.create`, `comercial.lead.read` e `comercial.lead.delete` no app
     `comercial` (o Comercial chama `/v1/service-authorize-peer` com o par do Site; o RH só é consultado pelo próprio
     Comercial, com `service-context.read` da identidade dele);
   - em `railway-variaveis.mjs`: gravar esses três `_CONTEUDO` no serviço `site`.
2. **Feed do RH (só se o dono decidir ligar):**
   - certificado de **servidor** com SAN `DNS:site.railway.internal` → `INTEGRACAO_TLS_CERT_CONTEUDO` /
     `INTEGRACAO_TLS_KEY_CONTEUDO`; a CA → `INTEGRACAO_MTLS_CA_CONTEUDO`;
   - no AUTH: `rh-collector` com `feed.read` e `capabilities.read` no app `institucional`, e `institucional-api`
     autorizado a chamar `/v1/service-authorize-peer` para o app `institucional`;
   - no RH: fonte `institucional` com URL `https://site.railway.internal:9557` e `institucional` em `RH_PRODUCER_CODES`
     (hoje fora, pelo `RAILWAY-PRONTO.md` do RH).

Quem confia em quem: tudo pela CA nova da Railway. Site → Comercial e Site → AUTH: o Site apresenta `institucional-api`
e verifica os servidores `comercial.railway.internal`/`auth.railway.internal`. RH → Site: o Site apresenta
`site.railway.internal` e exige o cliente `rh-collector`.

## Primeiro administrador do painel

Na Railway não existe `ADMIN_PASSWORD` (senha de pessoa em variável é proibida). Com o banco vazio ninguém entra no
`/admin` até o dono **designar** a pessoa. Então, uma vez:

```sh
railway ssh --service site
node dist/admin-inicial.js --email <e-mail da pessoa> --nome "<nome>" --designacao "<quem designou, quando, por qual meio>"
# a senha inicial é pedida no terminal, sem eco; mínimo de 10 caracteres
```

- Roda com o `DATABASE_URL` do runtime (`site_app`). A senha nunca vai em argumento, variável ou log.
- Recusa se já houver qualquer admin ativo, se o e-mail já existir, sem `--designacao` (10 a 200 caracteres) ou com opção
  desconhecida. Grava `usuario.criado` na trilha de auditoria com a designação (sem a senha).
- Os demais usuários (admin/editor) são criados por esse admin em `/admin/usuarios`. A pessoa troca a senha em "Minha senha".

## Pendências e decisões do dono

1. **Quem é o primeiro admin** do painel do Site na Railway (comando acima). Sem isso, ninguém entra no `/admin`.
2. **Fase 4:** emitir `institucional-api` (e, se for o caso, o servidor `site.railway.internal`) e registrar no AUTH,
   como descrito acima. Até lá, os contatos ficam só no `/admin` do Site.
3. **Site público duplicado:** o `site` terá domínio público com o mesmo conteúdo de `www.afirmaevias.com.br`, e os
   formulários gravam dados de quem os usar. Com `SITE_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}` o canonical e o sitemap
   apontam para o domínio da Railway (risco de conteúdo duplicado em buscadores). Alternativa: `SITE_URL` com o domínio
   oficial (canonical para o site oficial; os links do aviso por e-mail iriam para lá). Decidir antes de divulgar.
4. **`PORTAL_CLIENTE_URL`:** sem a variável o botão "Área do cliente" aponta para o Comercial de PRODUÇÃO antigo
   (`aevias-comercial-production.up.railway.app`). A tabela usa o `comercial` deste projeto; confirmar.
5. **Feed do RH:** ligar ou não a fonte `institucional` no RH da Railway (hoje fora).
6. **Avisos por e-mail:** `RESEND_API_KEY` e remetente verificado, só se o dono fornecer.
7. **Projeto Railway antigo (`noble-surprise`):** continua apontando para este repositório com o `railway.json` da raiz.
   Decidir se ele segue ativo; esta fase não o tocou.
8. `PUBLIC_HTTP=1` confia em 1 salto: pela borda pública o IP é o real; um serviço da rede privada que chamasse
   `site.railway.internal:8080` direto poderia escolher o próprio IP de limite/trilha. Nenhum serviço faz isso.
9. Região, plano e backup do `pg-site` (o banco guarda currículos, relatos e pedidos LGPD): decisões do usuário.

## Diferenças em relação ao guia do Chrome

- O Site não está no guia: serviços novos `site` e `site-migrate`, Postgres novo `pg-site`, variável `SITE_APP_PASSWORD`.
- Dockerfile fora da raiz (`deploy/railway/Dockerfile`), para não alterar o projeto Railway antigo do Site.
- O `site-migrate` usa `DATABASE_URL` (dono), não `MIGRATION_DATABASE_URL`.
- Healthcheck `/health/live` na porta `8080`; o domínio público aponta para `8080`.

## Commit do código

- Fase 0: `2058ae7`
