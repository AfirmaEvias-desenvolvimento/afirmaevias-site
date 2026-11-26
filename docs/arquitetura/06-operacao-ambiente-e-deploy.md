# 06 — Operação, ambiente e deploy

> Fontes: `.env.example`, `package.json`, `src/config.ts`, `src/server.ts`,
> `src/migrate.ts` e `railway.json`. Comandos executados na raiz do repositório,
> a pasta que contém `package.json`.

## Execução local no PowerShell

Pré-requisitos: Node >= 22, npm e PostgreSQL acessível com permissão para aplicar
o schema e criar a extensão `pgcrypto`. O repositório não fornece PostgreSQL
embarcado nem um ambiente Docker do site.

```powershell
Copy-Item .env.example .env
# Editar .env: DATABASE_URL e credenciais iniciais próprias, sem usar o exemplo.
npm ci
node --env-file=.env --import tsx src/migrate.ts
node --env-file=.env --import tsx --watch src/server.ts
```

O site atende em `http://localhost:3000` por padrão. Os scripts `npm run dev` e
`npm run migrate:dev` também existem, mas não carregam `.env` explicitamente.
Use-os quando as variáveis já estiverem exportadas no processo. A simples
existência do arquivo `.env` não o carrega: não há `dotenv` na aplicação.

## Variáveis

| Variável | Uso / padrão |
|---|---|
| `DATABASE_URL` | Obrigatória; conexão PostgreSQL |
| `NODE_ENV` | Padrão `development`; se ausente e houver indicador Railway, assume `production` |
| `RAILWAY_ENVIRONMENT_NAME` / `RAILWAY_ENVIRONMENT` | Indicadores usados para inferir produção; não são credenciais |
| `PORT` | Porta HTTP, padrão 3000 |
| `SITE_URL` | Base de sitemap, SEO e links dos avisos; padrão `https://www.afirmaevias.com.br` |
| `SESSION_SECRET` | Assinatura do cookie; deve permanecer estável entre processos e deploys |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Criação inicial pela migration se ambos existirem e o e-mail não estiver cadastrado |
| `ADMIN_NOME` | Nome inicial, padrão `Administrador` |
| `RESEND_API_KEY` | Chave só de envio do Resend (segredo). Com `EMAIL_FROM`, liga os avisos; sem uma das duas o envio fica desligado e os avisos ficam na fila do banco |
| `EMAIL_FROM` | Único remetente de todo e-mail (`src/email.ts`), sem padrão no código; domínio verificado no Resend. No ecossistema: `SAE <sae@afirmaevias.com.br>` |
| `EMAIL_CONTATO`, `EMAIL_RH`, `EMAIL_COMPLIANCE` | Destinos, padrão `comercial@afirmaevias.com.br` |
| `EMAIL_ENCARREGADO` | Destino dos avisos de titular, padrão `privacidade@afirmaevias.com.br` |
| `WALLPAPER_STATS_TOKEN` | Bearer de `GET /api/wallpaper/usuarios` (Painel Infra), o mesmo valor em todos os sistemas; ausente ou com menos de 32 caracteres, a rota responde sempre 401 |

Sem `SESSION_SECRET`, desenvolvimento usa valor fixo de desenvolvimento;
produção gera segredo aleatório por inicialização e avisa no log. Reiniciar
invalida cookies anteriores nesse caso; múltiplas réplicas também não conseguem
validar entre si cookies assinados com segredos diferentes.

`ADMIN_PASSWORD` não é mecanismo de redefinição: alterar a variável não muda
a senha já persistida. A troca da própria senha ocorre pelo painel.

## Build e Railway

```powershell
npm run build
# Com variáveis já injetadas no ambiente:
npm run migrate
npm start
```

O build executa `tsc`; `postbuild` copia `src/views` para `dist/views`. O artefato
de execução precisa de `dist/`, `public/`, `db/schema.sql` e dependências.
Iniciar na raiz mantém corretos os caminhos de arquivos usados pelo processo.

O arquivo `railway.json` declara Nixpacks, `npm run build`, inicialização por
`npm run migrate && npm start`, healthcheck `/health` com timeout de 30 segundos
e reinício por falha com até cinco tentativas. A migration roda antes do HTTP;
um erro nela impede o comando seguinte de iniciar o site.

O README descreve provisionar o serviço e PostgreSQL e apontar o domínio via
Cloudflare. O arquivo não comprova que a conta em produção tenha banco, DNS,
backup, região ou disparo automático de deploy configurados. Esses dados devem
ser conferidos nos painéis pelos responsáveis pela operação.

## Tarefas e encerramento

| Evento | Ação |
|---|---|
| Inicialização | Inicia retenção sem bloquear o início do servidor |
| A cada hora | Remove sessões expiradas |
| A cada 24 horas | Aplica regras de retenção |
| `SIGTERM` / `SIGINT` | Fecha Fastify, espera requisições e encerra o pool |
| Encerramento acima de dez segundos | Finaliza o processo com erro |

Os timers usam `unref()`. Falhas da retenção são registradas por regra; a
chamada periódica de limpeza de sessões suprime erros. O `/health` verifica
somente conectividade de consulta ao banco, não entrega de e-mail, validade dos
documentos, existência das caixas ou sucesso da retenção.

## Diagnóstico básico

| Sintoma | Conferência |
|---|---|
| Processo acusa `DATABASE_URL` ausente | Verificar injeção das variáveis ou uso de `--env-file` |
| Migration não inicia | Verificar conexão, permissões e disponibilidade do schema |
| Painel desloga após reinício | Conferir estabilidade de `SESSION_SECRET` e expiração de 12 horas |
| Formulário aparece no painel, mas não chega e-mail | Conferir `RESEND_API_KEY`, `EMAIL_FROM` e destino; no log, "E-mail desligado" ao subir, `email_falhou` (erro do Resend) e `aviso_email_falhou` (retentativa); testar com `node --import tsx scripts/testar-email.mjs <destinatário>` |
| `/health` falha | Conferir aplicação e conexão com PostgreSQL |
| CSS parece antigo | Conferir novo deploy, uso do helper `asset` e URL versionada |
| Dados antigos continuam no banco | Conferir logs de retenção, data `criado_em` e regras aplicáveis |

O repositório não automatiza backup, restauração, retenção de logs da hospedagem
ou descarte nas caixas de e-mail. O procedimento operacional deve definir esses
itens e validar restauração antes de depender de uma cópia de segurança.
