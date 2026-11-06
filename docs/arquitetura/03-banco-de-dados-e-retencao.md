# 03 — Banco de dados e retenção

> Fontes: `db/schema.sql`, `src/db.ts`, `src/migrate.ts`, `src/regras-retencao.ts`
> e `src/retencao.ts`.

## Conexão e schema

`DATABASE_URL` é obrigatória. O pool admite oito conexões e encerra conexões
ociosas após 30 segundos. Em produção, `src/db.ts` habilita SSL com
`rejectUnauthorized: false`; isso não equivale a validar o certificado do servidor.

O schema usa `pgcrypto`, UUIDs, datas `TIMESTAMPTZ` e índices para listagem,
busca de sessão e acompanhamento de prazos. `src/migrate.ts` aplica o SQL inteiro
de forma idempotente e cria o administrador informado em `ADMIN_*` caso o e-mail
ainda não exista. Não altera a senha de uma conta existente.

Não existe histórico numerado de migrations. Alterações futuras de colunas
precisam de SQL explícito: `CREATE TABLE IF NOT EXISTS` não modifica tabelas
já criadas.

## Inventário

| Tabela | Conteúdo principal | Relação / observação |
|---|---|---|
| `admin_usuarios` | Nome, e-mail, bcrypt, papel e ativo | Contas exclusivas do painel |
| `admin_sessoes` | Token, usuário, IP, navegador e expiração | FK para usuário; exclusão em cascata |
| `tentativas_login` | E-mail digitado, IP e data | Freio temporário por conta |
| `contatos` | Identificação, mensagem, origem, aceite, status, observação e dados técnicos | Sem vínculo com contas externas |
| `leads_comercial` | Estado de entrega do contato ao Comercial (chave, tentativas, `lead_id` devolvido) | Só com a integração ligada; sem cópia dos dados do contato; cascata com `contatos` (ver `docs/hipersistema/conexao-1-comercial.md`) |
| `eliminacoes_comercial` | `lead_id`, datas, origem, status e UUIDs de operadores | Pendência de eliminar no Comercial o lead de contato já apagado; sem dado pessoal; criada por gatilho em `contatos` |
| `candidaturas` | Identificação, área, mensagem, aceite, status e arquivo | Currículo em `arquivo_dados BYTEA` |
| `relatos_integridade` | Protocolo, categoria, texto, anonimato, identificação opcional e resposta | Não possui colunas de IP ou navegador |
| `solicitacoes_lgpd` | Protocolo, tipo, identificação, documento opcional, detalhes, resposta e prazo | Guarda o IP do envio |
| `consentimentos_cookies` | ID do visitante, categorias, versão da política, hash de IP e navegador | Uma linha por registro de escolha |
| `auditoria` | Ator, ação, entidade, detalhes, IP e data | FK de usuário vira NULL se a conta for excluída |

As cinco coleções públicas não possuem chaves estrangeiras entre si. Uma pessoa
pode aparecer em mais de uma coleção sem haver cadastro unificado de titular.
Não existem tabelas compartilhadas com Controle, Laboratório, Ponto ou auth.

## Arquivos e cópias

O currículo fica no PostgreSQL junto da candidatura. O detalhe administrativo
consulta o catálogo do banco para excluir colunas `bytea`; somente a rota de
download lê o binário. Os PDFs institucionais em `public/documentos/` são
arquivos públicos distintos dos anexos de candidatos.

Exportações CSV e arquivos baixados tornam-se cópias fora do banco. O descarte
na aplicação não elimina essas cópias, caixas de e-mail, logs ou backups de
provedores. O repositório não contém rotina de backup/restauração do banco.

## Retenção implementada

| Dados | Regra automática |
|---|---|
| Candidaturas e currículo | Exclui após 12 meses de `criado_em` |
| Contatos | Exclui após 24 meses de `criado_em`; se o lead já tinha sido entregue ao Comercial, o gatilho cria a pendência em `eliminacoes_comercial` (a eliminação lá é manual) |
| IP e user-agent de contatos e candidaturas | Define NULL após 6 meses, nas linhas cujo IP ainda não é NULL |
| Solicitações LGPD | Exclui após 5 anos de `criado_em` |
| Consentimentos | Exclui após 5 anos de `criado_em` |
| Tentativas de login | Exclui após 24 horas de `criado_em` |
| Auditoria | Exclui após 12 meses de `criado_em` |
| Sessões | Limpa expiradas a cada hora; autenticação já recusa sessão vencida |
| Relatos de integridade | Não têm descarte automático implementado |

A retenção roda na inicialização e a cada 24 horas por `setInterval` no processo
do site. Cada regra executa separadamente; uma falha é registrada e não impede
as seguintes. Não há agendador externo, eleição de líder nem trava entre
réplicas. A exclusão manual pelo painel exige papel `admin`.

Há duas distinções entre política e execução: a política fala em 24 meses após
o último contato, mas a rotina usa a criação do registro; para relatos, o texto
publicado prevê apuração mais cinco anos, enquanto o schema não possui uma data
específica de encerramento usada pelo descarte. Esses pontos exigem alinhamento
entre regra de negócio, política e implementação.

`config.versaoPolitica` registra `2026-10-20` nas escolhas de cookies. O texto
publicado tem versão editorial `1.1`, atualizado em 20/10/2026. Ao mudar a política,
conferir também a versão registrada, as regras de retenção e os testes.
