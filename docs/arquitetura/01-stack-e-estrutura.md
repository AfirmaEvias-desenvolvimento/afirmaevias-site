# 01 — Stack e estrutura

> Fonte: `package.json`, `tsconfig.json`, `src/server.ts` e módulos relacionados.
> As versões abaixo são faixas declaradas; `package-lock.json` fixa as resoluções.

## Tecnologias

| Camada | Tecnologia | Papel |
|---|---|---|
| Runtime | Node.js >= 22 | Servidor e `fetch` nativo |
| Linguagem | TypeScript ^5.7.3, `strict: true` | Código do servidor, módulos ESM/NodeNext |
| HTTP | Fastify ^5.2.1 | Rotas, plugins, logs e tratamento de erros |
| Templates | EJS ^3.1.10 e `@fastify/view` | HTML renderizado no servidor |
| Banco | PostgreSQL via `pg` ^8.13.1 | Persistência, sessões e auditoria |
| Senhas | bcryptjs ^2.4.3 | Hash com custo 12 |
| Formulários | `@fastify/formbody` e `@fastify/multipart` | Campos e um arquivo de até 5 MiB |
| Sessão | `@fastify/cookie` | Cookie assinado, sessão persistida no banco |
| Estáticos | `@fastify/static` e `@fastify/compress` | Arquivos locais, Brotli e gzip |
| Limites | `@fastify/rate-limit` | Limites habilitados por rota |
| Desenvolvimento | npm e tsx ^4.19.2 | Instalação, scripts e modo watch |
| Testes | `node:test` e `node:assert` | Testes compilados pelo TypeScript |

A versão do servidor PostgreSQL não é fixada neste repositório. Não há ORM nem
gerador de frontend. O build compila TypeScript e copia as views para `dist/views`;
CSS e JavaScript do navegador são servidos de `public/`.

## Organização e responsabilidade

`src/server.ts` registra plugins, define contexto comum das views, aplica
cabeçalhos (`src/cabecalhos.ts`), serve `public/` (`src/estaticos.ts`), registra
as três famílias de rotas e inicia as tarefas de manutenção.
`src/config.ts` centraliza parâmetros; `src/db.ts` expõe consultas com pool.

`src/routes/site.ts` monta páginas institucionais; `forms.ts` valida e grava os
envios públicos; `admin.ts` consulta e gerencia os dados. O objeto `colecoes` em
`admin.ts` declara campos de lista, busca, detalhe, exportação e status de cada
coleção. Uma nova coleção exige conferir também permissões, schema e retenção.

## Conteúdo e apresentação

| Alteração | Arquivo principal |
|---|---|
| Textos, contatos, links externos e sistemas internos | `src/content.ts` |
| Estrutura de uma página | `src/views/pages/*.ejs` |
| Navegação, rodapé e elementos compartilhados | `src/views/partials/*.ejs` |
| Painel | `src/views/admin/*.ejs` e `public/css/admin.css` |
| Estilos públicos | `public/css/site.css` |
| Interações e animações | `public/js/site.js` |
| Preferência visual | `public/js/tema.js` |
| Escolha de cookies | `public/js/cookies.js` |
| Página extra | `src/extra.ts`, `public/js/extra.js` e `public/css/extra.css` |

As fontes Poppins, imagens e PDFs institucionais são locais. `src/assets.ts`
acrescenta uma versão derivada do conteúdo às URLs usadas pelas views; o cache
de estáticos é de 365 dias em produção e zero no desenvolvimento. Mudanças em
arquivos exigem novo deploy para renovar o cache de versões do processo.
`public/email/logo-afirma-evias.png` é usado pelos e-mails de outros sistemas
(AUTH e Comercial), não pelas views: para trocar o logotipo, mantenha o nome e
peça aos sistemas que acrescentem `?v=<n>` à URL.

`src/seo.ts` monta JSON-LD localmente. Uma URL de vocabulário como `schema.org`
no JSON-LD não é uma chamada de API nem um recurso remoto carregado pelo site.

## Armazenamento no navegador

| Chave | Meio | Finalidade |
|---|---|---|
| `ae_cookies` | localStorage | Escolha das categorias e data |
| `ae_visitante` | localStorage | Identificador aleatório da prova de escolha |
| `ae_tema` | localStorage | Preferência de tema |
| `ae_sessao` | Cookie HttpOnly assinado | Identifica a sessão do painel |

As preferências locais permanecem até limpeza pelo navegador ou pelo usuário.
A sessão do painel tem validade de 12 horas. Não existe fila offline de envios;
uma falha ao registrar consentimento não desfaz a escolha local e não tem
reenvio persistente implementado.
