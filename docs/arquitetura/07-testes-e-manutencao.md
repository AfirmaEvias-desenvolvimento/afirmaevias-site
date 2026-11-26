# 07 — Testes e manutenção

> Fontes: `package.json`, `src/*.test.ts` e `.github/workflows/ci.yml`.

## Verificações existentes

```powershell
npm test
npm run build
```

`npm test` compila TypeScript e executa `node --test` sobre os testes compilados.
Os testes atuais não precisam de banco, chaves da Resend ou serviços externos.
`npm run build` também copia as views pelo `postbuild`.

| Arquivo | Cobertura principal |
|---|---|
| `src/utils.test.ts` | Normalização de entrada, validação, CSV, anexos, assinatura de arquivo, protocolos, hash e títulos |
| `src/retencao.test.ts` | Estrutura das regras SQL, recorte por data e correspondência de prazos com conteúdo publicado |
| `src/terceiros.test.ts` | Recursos externos nas views/CSS/JS, ausência de analytics conhecidos e CSP base |
| `src/email.test.ts` | Módulo único de e-mail com o SDK real do Resend contra uma API falsa em `127.0.0.1`: sem `RESEND_API_KEY`/`EMAIL_FROM` nada sai, remetente só `EMAIL_FROM`, `Idempotency-Key`, anexo, erro `{ data, error }` e tempo esgotado sem a chave no log, e nenhum outro arquivo de `src/` envia e-mail ou define remetente |
| `src/notificacoes.test.ts` | Fila de avisos com Postgres embutido (pula sem `HS_DIR`): gravação na transação do formulário, espera sem configuração, retentativa com a mesma chave de idempotência e aviso sem dados pessoais |
| `src/wallpaper.test.ts` | Painel Infra: 401, formato (24 horas cheias em UTC, zeros, nada pessoal), cache de 60 s, sem log, fora do rate limit e deduplicação do registro |
| `src/wallpaper-banco.test.ts` | Painel Infra com Postgres embutido (pula sem `HS_DIR`): privilégios do `site_app`, regras de contagem, `ON CONFLICT`, descarte de 7 dias, cascata, gancho da sessão e tempo da consulta |

O teste de terceiros permite explicitamente `public/js/extra.js`, que carrega
YouTube. As verificações são estáticas; não provam ausência de toda comunicação
externa possível em execução. Os testes de retenção conferem o SQL, mas não
executam exclusões em um PostgreSQL real.

## Integração contínua

A CI roda em push para `main` e em pull requests destinados a `main`, com Node 22
e `npm ci`. Executa os testes, o build, a compilação dos templates EJS e a checagem
de sintaxe dos scripts em `public/js/`.

O workflow não executa testes de navegação, migration real, login completo,
upload/download pela rede ou entrega de e-mail. O envio real é conferido à mão com
`node --import tsx scripts/testar-email.mjs <destinatário>...` (lê `RESEND_API_KEY` e
`EMAIL_FROM` do ambiente e imprime o id do Resend ou o erro, sem a chave). O workflow
também não declara o deploy; seu bloqueio por sucesso da CI depende da configuração
externa de branch e hospedagem.

## Validação funcional ao alterar fluxos

Usar banco de teste e dados fictícios para validar os caminhos afetados: envio
válido/inválido, arquivo permitido/acima do limite, persistência, protocolo,
sessão e permissões de editor/admin. Conferir manualmente download e CSV quando
essas rotas mudarem. Validar aviso ausente e falho sem perder o registro salvo.

As páginas e scripts do navegador não passam todos pelo compilador TypeScript;
a CI mantém verificações específicas de EJS e JavaScript por esse motivo.

## Atualização da documentação

| Mudança | Documento a revisar |
|---|---|
| Dependência ou estrutura | [01 — Stack](01-stack-e-estrutura.md) |
| Rota, formulário, protocolo ou exportação | [02 — Fluxos](02-backend-telas-e-fluxos.md) |
| Coluna, migration, arquivo ou retenção | [03 — Banco](03-banco-de-dados-e-retencao.md) |
| Papel, sessão, limite ou evento | [04 — Segurança](04-seguranca-acesso-e-auditoria.md) |
| Serviço externo, link operacional ou dados compartilhados | [05 — Terceiros](05-terceiros-e-sistemas-relacionados.md) |
| Variável, comando ou hospedagem | [06 — Operação](06-operacao-ambiente-e-deploy.md) |
| Teste, build ou workflow | Este documento |

Ao revisar, usar a implementação como fonte, atualizar a data do índice e
manter explícito o que depende da operação. Uma afirmação existente no README,
na política ou em documento antigo não prova que o comportamento esteja
implementado; conferir handlers, schema e configuração antes de repeti-la.
