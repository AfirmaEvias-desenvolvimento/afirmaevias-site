# Site Afirma E-vias

Site institucional refeito do zero. Node 22 + Fastify 5 + TypeScript + EJS + PostgreSQL.
Sem WordPress, sem build de frontend, sem CMS: o conteúdo mora em `src/content.ts`.

## Documentação do sistema

A [documentação de arquitetura](docs/arquitetura/README.md) descreve o sistema,
as rotas, os dados, o acesso ao painel, a operação e os testes, com referências
ao código. Foi organizada a partir dos documentos do repositório `aevias_controle`
e conferida com a implementação deste site em 21/10/2026.

O [mapa de terceiros e sistemas relacionados](docs/arquitetura/05-terceiros-e-sistemas-relacionados.md)
detalha Railway, Resend, Cloudflare, GitHub, YouTube, canal externo de denúncias,
redes sociais e a relação do site com Ponto, Controle, Laboratório e `aevias-auth`.

## Telas

**Institucionais públicas (12)**

| Rota | Tela |
|---|---|
| `/` | Home |
| `/afirma-evias` | A empresa (linha do tempo 2002 → 2016 → 2024 → hoje) |
| `/servicos` | Serviços (8 áreas de atuação com índice fixo) |
| `/aplicativo` | Aplicativo Afirma E-vias |
| `/acreditacao-e-certificacao` | ISO 9001, política da qualidade, missão/visão/valores, comunicado 17025 |
| `/programa-de-integridade` | Compliance, canal externo e canal de relato direto |
| `/trabalhe-com-a-gente` | Envio de currículo |
| `/contato` | Formulário e endereços |
| `/politica-de-privacidade` | **novo** — política LGPD completa |
| `/termos-de-uso` | **novo** |
| `/portal-do-titular` | **novo** — requisições do art. 18 da LGPD com protocolo |
| `/acessibilidade` | Declaração de acessibilidade |

Mais `/protocolo/:codigo` (consulta pública), `/robots.txt`, `/sitemap.xml`, `/health`,
a página extra `/bruno_magalhaes` (não indexável, com YouTube), 404 e página de erro.

**Painel**

`/admin/login`, `/admin` (visão geral), `/admin/dados/contatos`, `/admin/dados/candidaturas`,
`/admin/dados/relatos`, `/admin/dados/lgpd`, `/admin/dados/consentimentos`, cada uma com tela de
detalhe, mais `/admin/usuarios` e `/admin/auditoria`.

As listas, detalhes e exportações do painel são geradas a partir do objeto `colecoes`
em `src/routes/admin.ts`. Para expor uma tabela nova no painel, adicione uma entrada lá —
não precisa escrever rota nem view.

## Rodar local

```powershell
Copy-Item .env.example .env  # preencha DATABASE_URL, SESSION_SECRET, ADMIN_*
npm ci
node --env-file=.env --import tsx src/migrate.ts
node --env-file=.env --import tsx --watch src/server.ts  # http://localhost:3000
```

Os scripts `npm run dev` e `npm run migrate:dev` pressupõem variáveis já
carregadas no processo. Veja [operação e ambiente](docs/arquitetura/06-operacao-ambiente-e-deploy.md).

## Deploy no Railway

**Projeto `aevias-hipersistema` (Fase 0, 19/11/2026):** veja [`RAILWAY-PRONTO.md`](RAILWAY-PRONTO.md). Lá a imagem é
`deploy/railway/Dockerfile`, com os serviços `site` e `site-migrate` (`node dist/migrate.js --runtime`), o papel
restrito `site_app`, `PUBLIC_HTTP=1`/`HOST=::` e o primeiro admin sem senha em variável (`dist/admin-inicial.js`).
O roteiro abaixo é o do projeto Railway antigo (Nixpacks, `railway.json` da raiz), que não mudou.

1. Suba o repositório e crie o serviço a partir dele.
2. Adicione o plugin **PostgreSQL** no mesmo projeto — ele injeta `DATABASE_URL` sozinho.
3. Configure as variáveis:
   - `SESSION_SECRET` — gere com `openssl rand -hex 32`
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NOME` — cria o primeiro admin na primeira migration
   - `SITE_URL` — `https://www.afirmaevias.com.br`
   - `NODE_ENV=production`
4. O `railway.json` já define `npm run migrate && npm start` como start command e `/health` como healthcheck.
5. Aponte o domínio no Cloudflare para o serviço (CNAME para o host do Railway).

A aplicação do schema é idempotente e roda a cada deploy. Alterações de tabelas
existentes exigem SQL explícito; não há histórico numerado de migrations.

## O que falta

Depende de dado que só a empresa tem:

- **Registro no CREA** da pessoa jurídica e do responsável técnico. A Lei 5.194/1966,
  art. 63 exige em toda publicidade de firma de engenharia. Não está em lugar nenhum do site.
- **Nome do Encarregado (DPO).** O e-mail já está publicado; o art. 41, §1º da LGPD pede
  a identidade, não só o contato. Campo `emailEncarregado` em `src/content.ts`.
- **Data do comunicado ISO/IEC 17025** e decisão sobre exibir o aviso na Home e em Serviços.
- **Data de validade do certificado ISO 9001**, para exibir junto ao link do PDF.
- **A caixa `privacidade@afirmaevias.com.br` precisa existir.** O site já a publica como
  canal do titular; se ninguém lê, o prazo de 15 dias da LGPD corre em silêncio.

Configuração de ambiente:

- **`RESEND_API_KEY`** e **`EMAIL_FROM`** — sem as duas os avisos por e-mail ficam desligados
  (na fila do banco) e os registros seguem apenas no `/admin`. Veja "Avisos por e-mail" abaixo.
- **`SESSION_SECRET`** — sem ela o segredo é sorteado a cada boot e o painel desloga
  a cada redeploy.
- **Backup do banco.** Não há automação no repositório; confirmar a configuração
  no provedor e o procedimento de restauração. O banco guarda currículos, relatos de
  integridade e requisições LGPD.

Decisão de arquitetura em aberto:

- **Currículos são gravados como `bytea` no Postgres.** Funciona, mas o banco cresce com
  cada anexo e o backup fica pesado. Vale mover para storage externo antes do volume subir.

## Avisos por e-mail

`src/notificacoes.ts` avisa a equipe quando chega contato, currículo, relato de integridade
ou requisição LGPD. O envio sai só por `src/email.ts`, o único módulo que manda e-mail:
usa o SDK oficial do Resend (pacote `resend`, versão exata no `package.json`) e o remetente
é sempre o `EMAIL_FROM`. Não há SMTP nem remetente fixo no código.

| Variável | Para que serve | Padrão |
|---|---|---|
| `RESEND_API_KEY` | Chave só de envio do Resend. Liga o envio. | — |
| `EMAIL_FROM` | Único remetente, de domínio verificado no Resend. No ecossistema: `SAE <sae@afirmaevias.com.br>` | — |
| `EMAIL_CONTATO` | Destino dos contatos comerciais | `comercial@` |
| `EMAIL_RH` | Destino dos currículos | `comercial@` |
| `EMAIL_COMPLIANCE` | Destino dos relatos de integridade | `comercial@` |
| `EMAIL_ENCARREGADO` | Destino das requisições LGPD | `privacidade@` |

Sem `RESEND_API_KEY` ou sem `EMAIL_FROM`, o site sobe normalmente, avisa no log
("E-mail desligado (falta ...)") e os avisos ficam na fila do banco (`avisos_email_fila`)
até o envio ser configurado e o serviço reiniciado. Erro devolvido pelo Resend vai para o
log (`email_falhou`, com nome, status e mensagem, sem a chave) e o aviso volta para a fila
com recuo até 1 hora (`aviso_email_falhou`).

Os avisos não incluem identidade nem conteúdo dos formulários: dizem só que há um
registro novo do tipo e trazem o link da lista no painel. Não há currículo anexo. O
[mapa de terceiros](docs/arquitetura/05-terceiros-e-sistemas-relacionados.md) detalha os
campos e o comportamento em caso de falha.

Teste de envio real (manda 1 e-mail para cada destinatário e imprime o id do Resend ou o erro):

```powershell
$env:RESEND_API_KEY = '<chave>'; $env:EMAIL_FROM = 'SAE <sae@afirmaevias.com.br>'
node --import tsx scripts/testar-email.mjs pessoa@afirmaevias.com.br outra@exemplo.com
```

Sem as variáveis, o script não envia nada e sai com código 3.

## Descarte automático

`src/retencao.ts` roda ao subir e a cada 24 h: currículos em 12 meses, contatos em
24 meses, requisições e consentimentos em 5 anos, auditoria em 12 meses, tentativas
de login em 24 h e remoção de IP e user-agent de contatos/candidaturas em 6 meses.
Os recortes usam `criado_em`. Relatos de integridade não têm descarte automático.

Mudanças de prazo exigem revisar `src/regras-retencao.ts`, a política em
`src/content.ts` e os testes. O [documento de retenção](docs/arquitetura/03-banco-de-dados-e-retencao.md)
registra as diferenças entre o marco de contagem publicado e o implementado.

## Decisões de marca

A paleta vem direto do Manual de Marca v1.0: `#00233B`, `#566E3D`, `#BFCF99`,
`#EFEBDC`, `#F2F1EF`, `#FFFFFF`.

A tipografia é a exceção. O manual pede Exo para títulos e rótulos e Poppins para
texto corrido; o site usa **Poppins em tudo**. A Exo foi testada e tirava a
sobriedade que um site institucional de engenharia precisa ter. A hierarquia é
feita por peso, corpo e letter-spacing, não por troca de família. A logo continua
sendo o arquivo oficial e não foi tocada.

O grafismo do manual (o elemento que nasce da junção dos "i") virou o elemento estrutural do
site: a faixa de traços que abre cada herói, marca os itens de lista, separa as seções e fecha
o rodapé. É a única liberdade visual tomada — o resto é disciplina de espaçamento e tipo.

Nenhuma cor fora da paleta foi usada, a logo não recebe sombra, contorno nem elemento gráfico,
e ela nunca aparece sobre bege.

## LGPD — o que já está implementado

- Banner de cookies com a categoria Necessários; não há analytics ou marketing instalados.
- Cada escolha é gravada em `consentimentos_cookies` com a versão da política e hash do IP — prova de consentimento.
- Aceite nos formulários de contato e currículo; confirmação de titularidade no portal; relato com opção anônima.
- Portal do titular com protocolo, prazo de 15 dias calculado no banco e alerta no painel quando faltam menos de 5 dias.
- Botão de exclusão definitiva no painel (só perfil admin), registrado na trilha de auditoria.
- Trilha de auditoria para autenticação, alterações, exclusões, downloads, exportações e gestão de contas; leitura simples não gera evento.
- Rotina de retenção por data, com limites descritos na documentação de banco.

Falta o processo humano: definir quem é o Encarregado e criar o e-mail `privacidade@afirmaevias.com.br`.
