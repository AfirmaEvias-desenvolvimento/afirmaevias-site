# Operação, bancos, migração e VPS

Contrato `AEVIAS-HIPERSISTEMA-1.0`. Documento de execução futura; não contém credenciais nem autoriza uma migração de produção nesta entrega. Os scripts citados como novos são entregáveis dos planos, não comandos atualmente disponíveis.

## O01. Infraestrutura escolhida

VPS Linux com Docker Engine/Compose, reverse proxy TLS, seis aplicações e **seis instâncias/volumes Postgres separados** na configuração de referência. Mesmo host inicial é permitido; cada serviço tem banco, role, backup e rede próprios. Isso isola credenciais e operação dos bancos, mas **não fornece alta disponibilidade contra queda da VPS**. RH e AUTH são dependências comuns por decisão do usuário.

Usar imagens compiladas e fixadas por digest; Node inicialmente compatível com a linha 22 já adotada pelos projetos, com patch e suporte conferidos na implementação. Não executar Vite/tsx watch em produção. APIs do Controle/Lab precisam de build TS para JS, dependências de runtime, recursos e migrations incluídos na imagem. Gerar SBOM, lockfile e relatório de vulnerabilidades com tratamento dos riscos efetivamente alcançáveis.

Não consolidar os seis bancos em schemas de um mesmo database. Preservar schemas internos existentes (`rh`, `laboratorio`, schema efetivo do Controle, `public` do Ponto/site) **dentro de seus bancos exclusivos**. Nomes físicos sugeridos usam underscore para SQL; aliases Compose preservam os nomes das imagens do usuário:

| App | Alias de banco | Database | Credencial runtime | Credencial migration |
|---|---|---|---|---|
| AUTH | `auth-db` | `aevias_auth` | Roles internas separadas do GoTrue e provider | `auth_migrator` |
| RH | `rh-db` | `aevias_rh` | `rh_app` | `rh_migrator` |
| Ponto | `ponto-db` | `aevias_ponto` | `ponto_app` | `ponto_migrator` |
| Controle | `controle-db` | `aevias_controle` | `controle_app` | `controle_migrator` |
| Laboratório | `lab-db` | `aevias_laboratorio` | `app_laboratorio` | `laboratorio_migrator` |
| Institucional | `inst-db` | `aevias_institucional` | `institucional_app` | `institucional_migrator` |

GoTrue pode precisar de privilégios específicos para suas migrations oficiais; limitar ao auth-db e executar upgrade controlado. Nenhum consumidor recebe esses privilégios. Jobs pg-boss usam role própria com DDL somente no schema da fila; preferir criação/upgrade do schema na etapa de migration e runtime restrito depois. Não entregar `DATABASE_URL` de owner à API por conveniência.

## O02. Redes, domínios e serviços

- Só reverse proxy publica 80/443; 80 redireciona/ACME. SSH restrito à rede administrativa/chave. Postgres, listeners internos, GoTrue/admin e métricas não têm porta pública.
- Uma rede privada por banco conecta somente seu app, migration/job autorizado e backup. Uma rede de integração conecta as APIs internas com mTLS. Não montar socket Docker em aplicações.
- Proxies removem cabeçalhos de identidade/IP fornecidos externamente; confiar em número/endereço explícito de proxies. Não usar `trustProxy:true` indiscriminado em listener acessível diretamente.
- Domínios derivados de `BASE_DOMAIN`: `auth`, `rh`, `ponto`, `controle`, `lab`; Institucional usa host já configurado da empresa. O plano não altera DNS. Ambiente de teste usa hosts locais dedicados e CA de teste; issuer de teste nunca é aceito em produção.
- Manter API same-origin com BFF para web. Android tem cliente/origem configurados explicitamente; nenhuma CORS `*` com credenciais.
- Não compartilhar cookie entre subdomínios. SSO vem da sessão central AUTH e redirects, não de cookie global legível por todos.
- Arquivos de negócio privados passam por endpoint autorizado do app ou por concessão de download curta, escopada ao objeto e mediada pela API. O bucket/pasta não é público. Para bloqueio estrito, não entregar URL direta reutilizável que continue servindo quando o core caiu; usar proxy autenticado e validar antes da transmissão. Transferência já em curso segue o limite de C04.
- Certificados mTLS distintos por processo, rotação com sobreposição limitada e revogação no registro de serviços. Root CA offline/protegida, chave intermediária só no mecanismo operacional; scripts geram material local de teste sem credencial reutilizável em produção.

Compose de referência em AUTH `infra/ecossistema/compose.yml` inclui perfis `core`, `ponto`, `controle`, `laboratorio`, `institucional`, `observabilidade`. AUTH não espera RH; RH espera AUTH; consumidores esperam ambos e banco próprio. `condition: service_healthy` só auxilia a subida: middleware continua obrigatório a cada chamada. Workers de coleta são iniciados depois de RH ready e não fazem parte da readiness do RH.

## O03. Configuração obrigatória e segredos

| Variável/configuração proposta | Consumidor | Observação |
|---|---|---|
| `APP_CODE`, `APP_ENV` | Todos | Enum fixo, sem inferir produção só por Railway |
| `AUTH_ISSUER_URL` | Todos | HTTPS e issuer exato |
| `AUTH_INTERNAL_URL` | RH/apps/workers | Base mTLS interna, distinta do GoTrue e do issuer público |
| `RH_INTERNAL_URL` | Apps/workers | Obrigatória; AUTH não a usa |
| `CORE_CONTRACT_VERSION` | Todos | `AEVIAS-HIPERSISTEMA-1.0` |
| `SERVICE_CERT_FILE`, `SERVICE_KEY_FILE`, `INTERNAL_CA_FILE` | Serviços | Arquivos montados somente leitura, fora da imagem |
| `DATABASE_URL_FILE` | Runtime | Apenas banco próprio; loader pode adaptar para variável em memória sem log |
| `MIGRATION_DATABASE_URL_FILE` | Job de migration | Nunca montado na API |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_KEY_FILE` | BFF | Chave do cliente, não do issuer |
| `SESSION_ENCRYPTION_KEY_FILE` | BFF | Cifra de tokens persistidos; rotação versionada |
| `DATA_ENCRYPTION_KEY_FILE` | RH | Preservar chave do dado existente e keyring de rotação |
| `PHOTO_ENCRYPTION_KEY_FILE` e anterior | Ponto | Independente de segredo de sessão/AUTH |
| `TWOFA_ENCRYPTION_KEY_FILE` e anterior | Controle | Não perder TOTP/evidência na troca de login |
| `FILES_DIR`, `PRIVATE_FILES_DIR`, `LOCAL_STORAGE_DIR` | Controle/Lab conforme driver | Volumes exclusivos e backup |
| `RESEND_API_KEY` (segredo) e `EMAIL_FROM` | AUTH e sistemas que enviam e-mail (API do Resend, sem SMTP) | Produção exige entrega de convite/recuperação testada |
| Configuração offsite de backup | Operação | Conta separada, chave fora do host e restore testado |

Não manter fallback de autenticação local em produção (`AUTH_COMPARTILHADO=0`, GoTrue do app, `DEV_AUTH`, contas fixas). Durante desenvolvimento, usar perfil de teste isolado com issuer/mock explícito; o build de produção recusa flags de bypass e issuer `.test`/loopback. Nunca detectar “teste” apenas pela ausência de segredo.

`scripts/preflight` (a criar por repo) valida nomes/configuração sem imprimir valores: ambiente, existência de arquivos, permissões, URL sem credenciais em logs, certificado válido, DNS/TLS, conexão do próprio banco, migrations, contrato e reachability core. Falta de configuração gera relatório de nomes ausentes e exit não zero, não perguntas repetidas nem tentativas de adivinhar senha.

## O04. Migrações e isolamento dos bancos

Cada repo terá migrations imutáveis, checksum e advisory lock de aplicação. Migrations são job explícito, separadas do `start`; retirar o `migrate && start` atual do RH/Ponto e da configuração Railway do site. Usar expand/contract: criar estrutura nova, backfill, validar, mudar leitor, retirar legado só depois da janela definida.

Runtime: `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS`, sem ownership das tabelas de domínio, sem DDL. Revogar `CONNECT`/TEMP de `PUBLIC` conforme escopo e permissões de schema; permitir só rede/role/banco esperado. Em instâncias separadas, não criar credenciais do outro app. Testar com credencial runtime real, não owner. Triggers de imutabilidade são úteis, mas um superusuário pode alterá-las: não prometer proteção absoluta contra administrador do cluster.

Apenas a ferramenta de migração offline pode receber credenciais temporárias de leitura de origem e escrita de destino. Essa exceção não vira configuração da aplicação nem credencial permanente. Remover do ambiente de destino depois da conferência.

### RH sai do banco do Ponto

1. Descobrir versões reais e contar tabelas/objetos/dependências de `rh`. Inspecionar views, funções, FKs, grants, sequences, extensões e referências a `public`, inclusive SQL nos scripts.
2. Criar rh-db separado e roles. Manter a mesma major do Postgres da origem na primeira movimentação; se o destino for novo/vazio sem origem, usar major suportada fixada na matriz de testes. Nunca restaurar dump de major mais nova em mais antiga nem copiar diretório físico entre Windows/Linux.
3. Ensaiar `pg_dump` de schema `rh`, formato custom, com cliente compatível com origem; restaurar em destino vazio. Dump de schema selecionado pode não incluir todas as dependências: manifest deve listá-las e recriar extensões/roles com migrations controladas.
4. Preservar PKs, ciphertext, chaves de cifra, auditoria, sequences e tabela de migrations; não executar seed sobre destino migrado. Criar migrations incrementais novas após restore, sem executar init duplicado.
5. Comparar contagens, hashes determinísticos por PK, constraints, referências e decifragem de fixtures controladas; relatórios públicos só contagens. Não imprimir remuneração real.
6. Congelar **escritas RH** brevemente, drenar worker, fazer dump/delta final e mudar somente a conexão RH. Ponto pode continuar se sua origem não tiver alteração estrutural; observar carga do dump.
7. Verificar com APIs/testes: RH sem credenciais nem dependência de disponibilidade Ponto, Ponto não acessa rh-db. Desabilitar `promover-admins` e `papeis` antigos em novos ambientes; migração de perfis usa exportação/API explícita.
8. Origem `rh` fica preservada e em leitura para retorno controlado, fora do alcance de runtime Ponto quando possível. Não fazer `DROP SCHEMA ... CASCADE`. Cópias antigas do Ponto podem conter RH; inventariar e proteger, não assumir que separação apagou o histórico.
9. Após nova escrita no RH separado, rollback simples da connection string perde mudanças: congelar e reconciliar delta antes de retorno ou preferir correção adiante. Só voltar direto se o destino ainda não recebeu escrita.

## O05. Arquivos, Base44 e evidência técnica

Baseline VPS: volumes privados próprios para drivers locais já presentes em Controle/Lab, com arquivos imutáveis, checksum e cópia offsite. Não comprar/provisionar storage durante o planejamento. Se o volume medido exceder capacidade, o adapter S3 existente do Controle permite storage separado; Lab precisará de adapter equivalente testado antes da troca. A escolha operacional de capacidade não muda APIs nem contratos.

Manifest de objetos: `source_system`, chave/URL de origem protegida, destino, tamanho, SHA-256, tipo detectado, status, tentativas, refs, instante e erro técnico. Transferência em staging → verificar bytes/checksum → publicar de modo atômico → atualizar vínculo de apresentação; nunca marcar concluído antes de fsync/upload confirmado. Concorrência inicial limitada e retomada idempotente.

No Controle, usar/incrementar `files:migrate inventory|coverage|links|transfer|rewrite|verify|report` existentes. Não executar `all` cegamente. Recontar usando dados atuais e cobertura do backup local. Valores antigos (~100 GB, 154 mil/210 mil URLs) são evidência histórica, não orçamento atual garantido. Não recomprimir/reencodar fotos legadas para reduzir espaço.

**Preservação de assinaturas:** não alterar `legacy_doc`, `created_by_id`, documentos canônicos, timestamps/textos/ordem JSON que entram no hash. Arquivos movidos byte a byte; mapeamento externo permite resolver URLs antigas para novo storage sem alterar o documento assinado. O `rewrite` existente só pode ser usado depois de provar por teste que não gera divergência nova em assinaturas legadas **e nas emitidas no sistema novo**. Se hashes atuais incluírem URLs, preferir resolver/mapear na apresentação. A presença de `legacy_doc` não é proteção universal para registros novos.

Lab preserva trilhas `json`/texto e certificados imutáveis; não converter `json` de trilha para `jsonb`. Tratar arquivos privados/públicos antigos de forma explícita, sem servir dados pessoais por nome adivinhável. Arquivos faltantes na própria origem geram ocorrência preservada; não inventar substituto nem apagar a referência para fechar contagem.

Gate para declarar um app independente de Base44: ausência de SDK/telemetria em runtime, zero tráfego para hosts Base44 em fluxos novos e antigos suportados, inventário reconciliado, nenhum arquivo ainda recuperável somente lá, paridade de dados/deltas e assinaturas sem divergências novas. Arquivos comprovadamente perdidos antes da migração ficam documentados separadamente. **Cancelar a conta Base44 global permanece fora do escopo enquanto outros sistemas a utilizarem.**

## O06. Backup e recuperação

A rotina NDJSON atual do AUTH não garante snapshot consistente entre tabelas e não substitui o novo plano de backup. Definir um conjunto completo de recuperação:

- Backup consistente de cada database com `pg_dump` custom para portabilidade/migração; checar exit code e manifesto. Exportar roles necessárias separadamente, sem publicar hashes de senha.
- Na VPS, backup físico/PITR via pgBackRest por instância, WAL arquivado continuamente e cifrado fora do host. `archive_timeout` inicial 60 s; alertar atraso >5 min. Testar recuperação antes de prometer RPO.
- Arquivos por restic em destino offsite cifrado; objetos são imutáveis. Upload só é considerado duravelmente confirmado conforme política: cópia offsite confirmada antes de sucesso final ou estado “pendente de proteção” claramente separado, com retry. Não prometer RPO de 5 min para fotos se só existir backup diário.
- Chaves de cifra RH/Ponto/Controle, chaves do issuer/BFF, configuração, certificados e runbooks têm backup/cofre independente. O restore precisa comprovar leitura dos dados cifrados. CA privada e credenciais offsite com acesso distinto do runtime.
- Política técnica inicial: 7 cópias diárias, 4 semanais, 3 mensais; ajustar à política de retenção aprovada antes de ligar descarte em produção. Backup não deve contrariar eliminações e retenções do domínio.

Objetivos de projeto: RPO até 5 minutos para bancos e arquivos confirmados/protegidos; RTO core até 2 horas e ecossistema até 4 horas **somente se o ensaio com volume real os comprovar**. O ensaio define tempos reais e capacidade necessários; falha no alvo é gate aberto, não número ocultado no relatório. Snapshot do provedor é camada adicional, não única cópia.

Restore de ecossistema: rede isolada → chaves/configuração → AUTH/db → RH/db → consumidores/bancos/arquivos → invalidação de sessões anteriores ao incidente → reaplicação de ledger de bloqueios e tombstones posterior ao backup → replay/reconciliação dos feeds → testes → abertura de tráfego. Não aceitar pessoa desligada só porque backup antigo a marcou ativa. Um restore pode cruzar watermarks diferentes entre bancos: reconciliar antes de operar, sem afirmar transação global do backup.

Verificação diária de recência/checksum/tamanho, restore automático semanal em ambiente isolado com dados protegidos e sem acesso externo, exercício completo mensal. Dados reais de restore não vão para ambientes de desenvolvimento comuns nem para captures de teste. Registrar IDs de backup e estatísticas sem conteúdo pessoal.

## O07. Observabilidade e capacidade

Métricas por serviço: disponibilidade live/ready, latência p50/p95/p99, pool DB, erros AUTH/RH, timeouts, sessões revogadas, recusas por motivo técnico, tamanho/idade outbox/inbox, atraso por origem, quarentena, espaço de disco, idade backup/WAL e vencimento TLS/mTLS. Logs estruturados com request ID e códigos; redigir cookies, token, authorization, querystring sensível, corpo e segredos.

Alertas iniciais: core indisponível >30 s, conector sem sucesso >5 min, revogação de desligamento pendente >30 s, disco >75%/85%, backup diário >26 h, archive lag >5 min, certificado <14 dias. Painel mostra último estado por integração; não expor inventário privado no `/health` público.

AUTH/RH atendem cada operação: teste de carga precisa incluir chamadas repetidas, rajadas de sync e autorização de arquivos/streams, não só login. Separar pools/quotas de API core e analytics/coleta. Começar com ambiente de homologação com 8 vCPU/16 GB para medir os seis processos/bancos, sem afirmar que basta para produção. Medir IOPS, memória, conexões, bytes reais e crescimento; dimensionar com 30% de folga e alertas. Não há cotação, compra ou garantia de custo neste plano.

VPS única continua sendo ponto único de falha. Evolução operacional: segundo host independente para backups/restore e, quando exigido, réplicas/Postgres/serviços com failover ensaiado. Não implementar Kubernetes/cluster distribuído como pré-requisito dos seis sistemas.

## O08. Deploy e cutover executáveis

Cada repo entrega: Dockerfile, `.dockerignore`, build reproduzível, migrations como job, manifest de release, health, scripts `preflight`, `smoke`, `backup-check`, `rollback-check` e `.env.example` sem valores sensíveis. AUTH entrega a composição que usa esses artefatos. Scripts novos devem oferecer `--dry-run`, código de saída e relatório JSON sanitizado.

Ordem:

1. Congelar versões do contrato e imagens. Ensaiar restauração/migração em destino isolado.
2. Preparar VPS/TLS/redes/cofre/backup. AUTH + banco + provider + credenciais internas. Concluir testes reais de login/revogação e recuperação.
3. RH + banco separado + core. Criar/migrar vínculos e validar bloqueios. Coletores podem estar desabilitados sem afetar readiness.
4. Migrar e integrar consumidores um por vez. Verificar perfil, grant e pessoa, fila pendente, chaves de cifra e arquivos; testar com cada papel antes de exposição.
5. Ativar conectores entregues, bootstrap consistente e replay. Um produtor ausente aparece `not_configured`/`stale`; RH core continua pronto.
6. Manutenção curta para último delta de cada fonte; uma única origem escritora por domínio. Drenar jobs e fluxos em voo. Não misturar bases locais e Railway como se fossem a mesma origem; inventariar qual contém a verdade e tratar divergências.
7. Validar paridade, liberar tráfego e monitorar. Origem antiga em leitura, acesso restrito; janela técnica de retorno 30 dias, sem autorizar descarte automático quando houver retenção/pendências.
8. Desabilitar login local/antigos tokens, rotacionar/remover HS256 dos consumidores e retirar acesso público GoTrue/admin. Não trocar chaves de cifra de dados junto com sessão sem migração própria.

Rollback: imagem anterior compatível com schema expandido, core central preservado, sem reativar login local. Se houver incompatibilidade de schema, manutenção e forward-fix ou restore + reconciliação explícita das escritas novas. **Nunca** “resolver” queda de AUTH com `AUTH_COMPARTILHADO=0`. Para retorno de dados, reconciliar filas, outbox, exclusões e bloqueios; evitar dois sistemas escritores.

Antes de executar cutover real, o agente deve apresentar o release e relatório já prontos, identificar o destino efetivo e verificar autorização existente na sessão. Aprovação adicional só quando necessária para ações reais ainda não autorizadas; não bloquear implementação/testes por decisões arquiteturais já resolvidas.

## O09. Referências operacionais

[PostgreSQL pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html) fundamenta o snapshot consistente e a exportação por banco; [backup lógico](https://www.postgresql.org/docs/16/backup-dump.html) explica restauração e diferenças para cópia física. [pgBackRest](https://pgbackrest.org/user-guide.html) é a referência para WAL/PITR e restore. [restic](https://restic.readthedocs.io/en/stable/040_backup.html) é a referência para cópias de arquivos. Configurações, metas e cronogramas desta seção são decisões propostas AEVIAS e devem ser comprovados por ensaio.
