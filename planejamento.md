# Planejamento de integração — Institucional

**Ordem 6 · contrato `AEVIAS-HIPERSISTEMA-1.0` · 21/10/2026 · a executar.**

Raiz Git correta: `afirmaevias-site/afirmaevias-site`, não a pasta externa de mesmo nome. Ler este plano e `docs/hipersistema/contratos.md`, `docs/hipersistema/operacao-vps.md` e `docs/hipersistema/aceite.md`. Ler também README e documentação de implantação, segurança, privacidade e testes existentes. Não converter o site para SPA nem criar outro produto.

## Resultado e dependências

Painel administrativo usa login exclusivo no AUTH, com autorização atual do AUTH e contexto funcional do RH. Páginas e formulários públicos continuam anônimos, sem exigir conta de visitantes: a dependência deles é técnica, por identidade do serviço. Conforme decisão do usuário de dependência estrita, AUTH ou RH indisponível implica manutenção/503 também nas operações públicas. Assets de manutenção e endpoints de liveness permanecem disponíveis.

O site envia ao RH somente dados contratados de recrutamento e atividade administrativa. Relatos anônimos, solicitações de privacidade, cookies e conteúdo de mensagens não viram métricas de produtividade. RH coleta por API; não recebe senha PostgreSQL do site. Pré-requisitos: `AUTH_READY_V1` e `RH_READY_V1`; desenvolvimento local pode usar simuladores versionados, mas isso não satisfaz o gate de integração real.

## Diagnóstico e pontos de edição

| Caminho existente | Situação e trabalho |
|---|---|
| `src/auth.ts` | bcrypt local, sessão `ae_sessao` de 12 h; substituir autenticação por OIDC/BFF e sessão vinculada ao AUTH |
| `src/routes/admin.ts` | Login/senha locais; leitura ampla por usuário autenticado e algumas operações restritas a admin; criar matriz explícita por coleção e ação |
| `src/routes/*`, `src/views/*` | Preservar SSR EJS, formulários e identidade visual; ajustar login/erros e estado de manutenção |
| `src/db.ts`, `db/schema.sql` | Banco próprio já existe; introduzir migrations versionadas sem reaplicar seed de administrador |
| `src/config.ts`, inicialização Fastify | Validar segredos/issuer/certificados e revisar proxy confiável; localizar uso exato na revisão inicial |
| `src/audit.ts` | Preservar auditoria original; exportação mínima separada de logs e dados pessoais |
| `package.json` | `npm run build`, `npm test`; acrescentar scripts comuns de contrato/integração/preflight |
| Documentação existente de VPS/segurança | Atualizar para AUTH/RH e compose do hipersistema, mantendo histórico das decisões |

Há tabelas `admin_usuarios`, `admin_sessoes`, `contatos`, `candidaturas`, `relatos_integridade`, `solicitacoes_lgpd`, `consentimentos_cookies`, `auditoria` e `tentativas_login`. `admin_usuarios.senha_hash` hoje é obrigatório; apenas trocar o formulário não elimina autenticação local. Currículos são binários no PostgreSQL. O código de papel atual é `admin`/`editor`; conservar os identificadores durante a transição, mas reduzir exposição por coleção.

## I01 — Baseline, migrations e isolamento

- [ ] Inventariar rotas públicas/admin, operações SQL, uploads, notificações e acesso por papel. Registrar contagens e hashes estruturais sem copiar nomes, currículos ou relatos para documentação.
- [ ] Acrescentar mecanismo de migrations numeradas e tabela de controle. Criar baseline que reconhece esquema existente validado e aborta em divergência; em banco vazio, cria o esquema equivalente. Não registrar baseline cega nem recriar tabelas existentes.
- [ ] Separar `migrate`, `start` e bootstrap. Retirar criação automática por `ADMIN_*` do startup final; bootstrap antigo só pode existir como ferramenta histórica inacessível ao runtime.
- [ ] Criar roles exclusivas do banco `inst_db`, runtime sem DDL e sem conexão aos outros cinco bancos. Não mover currículos para outro armazenamento nesta etapa sem necessidade comprovada.
- [ ] Criar migrations aditivas: vínculo de `admin_usuarios` com `auth_user_id`, `person_id` e estado; sessão BFF; outbox/feed; reconciliação e idempotência dos formulários. PKs e autoria histórica permanecem.
- [ ] Tornar `senha_hash` anulável na transição e depois impedir seu uso; não transportar hashes bcrypt para RH nem presumir compatibilidade de importação no AUTH.

**Aceite:** instalação vazia e upgrade de fixture do esquema atual produzem comportamento equivalente; rerun idempotente; nenhum admin novo aparece por simples reinício; dados/binários preservados.

## I02 — Login único e migração dos administradores

- [ ] Registrar client AUTH e app code **`institucional`**, hoje ausente do registro central. Redirect/logout URIs exatas por ambiente; sem wildcard e sem segredo no HTML.
- [ ] Implementar OIDC Authorization Code + PKCE, state, nonce, callback e logout no backend SSR. Sessão local guarda hash do identificador e referência à sessão/token central cifrado; cookie Secure, HttpOnly, host-only, SameSite conforme contrato, CSRF nas mutações.
- [ ] Remover POST de senha local, recuperação/troca de senha local e uso de `autenticar`/`gerarHashSenha` como login. `/admin/login` inicia AUTH; `/admin/minha-senha` direciona ao gerenciamento central e não recebe senha.
- [ ] Migrar identidades com relatório de correspondência explícita. E-mail igual é candidato à revisão, nunca prova suficiente para vincular automaticamente no login. Usuário não encontrado entra no fluxo de convite central e perfil pendente.
- [ ] Invalidar sessões antigas no corte sem excluir conteúdo. Sessão BFF não prolonga sessão AUTH; revalidar acesso por requisição. A tela de usuários passa a administrar perfil local e convites autorizados, sem gerar senhas.
- [ ] Conta desativada localmente perde acesso ao Institucional; desligamento RH revoga acesso global via AUTH. Diferenciar os dois comandos para não transformar o botão local “alternar” em demissão involuntária.
- [ ] Administradores externos sem vínculo empregatício usam identidade de pessoa externa e concessão explícita; não criar funcionário fictício para permitir login.

**Aceite:** autenticação ocorre na origem AUTH; senha local e sessão antiga não dão acesso; usuário de outro app não obtém perfil de editor automaticamente; troca de e-mail não troca autoria.

## I03 — Gate de dependências e autorização por coleção

- [ ] Aplicar C03/C04 às rotas admin, downloads e CSV; permissões resultam da interseção AUTH + RH + perfil/escopo local. Bloqueio central supera `papel=admin` local.
- [ ] Separar permissões para contatos, recrutamento, integridade, privacidade, consentimentos, auditoria e gestão de usuários. Admin técnico não recebe automaticamente leitura de relatos/solicitações de privacidade; permissões sensíveis exigem concessão explícita. Editor comum inicia sem acesso a essas coleções.
- [ ] Adotar matriz versionada com negação por padrão; migrar papéis sem ampliar acesso. Relatório de diferenças registra eventuais reduções e perfis pendentes, não concede tudo para preservar conveniência.
- [ ] Rotas públicas usam `/v1/service-authorize` e contexto de serviço RH; não enviam identidade anônima inventada nem tentam consultar funcionário por formulário/e-mail.
- [ ] Implementar liveness independente e readiness de DB/contratos/core. O health existente com `SELECT 1` não basta para a nova dependência.
- [ ] Ajustar error handler para preservar 401/403/429/503 em vez de converter todo 5xx em 500. Página de manutenção sem dados pessoais, `Retry-After` e mensagem de pendência segura.
- [ ] Desabilitar cache público de páginas operacionais que permita servir formulários/fluxos ativos contornando o gate; cache de assets estáticos é permitido. Não fazer cache de autorização positiva.
- [ ] Exigir `SESSION_SECRET` e chaves estáveis em produção, sem fallback aleatório; configurar `trustProxy` apenas para proxy conhecido. Revisar CSP/redirect sem ampliar para `*`.

**Aceite:** queda AUTH/RH interrompe admin e submissão pública; visitante não é obrigado a fazer login; editor não lê relatos/CSV sensíveis; downloads também rejeitam sessão revogada.

## I04 — Formulários, progresso e notificações confiáveis

- [ ] Preservar contato, candidatura, protocolo de integridade, solicitações de privacidade e consentimento. Nova autorização técnica não muda a semântica dos campos nem transforma visitante em empregado.
- [ ] Persistir submissão e registro de notificação/outbox na mesma transação; SMTP/Resend indisponível não pode produzir uma falsa confirmação de envio ou apagar a submissão persistida. UI diferencia recebido de notificação pendente.
- [ ] Implementar chave de idempotência por tentativa/formulário com hash do payload e conflito para chave reutilizada com conteúdo diferente. Retry após resposta perdida não duplica candidatura/protocolo.
- [ ] Verificar core antes de aceitar operação. Se uma requisição já confirmada no DB perdeu a resposta, retry retorna o mesmo resultado após revalidação; nenhuma tentativa de “desfazer” registro só por falha posterior de e-mail.
- [ ] Quando core cai antes do envio, preservar rascunho em memória da página e informar indisponibilidade; não salvar relatos/CPF/currículos automaticamente em localStorage. Refresh pode perder esse rascunho e deve ser explicado, sem promessa de persistência inexistente.
- [ ] Worker de notificações usa identidade de serviço e gate técnico. Retry exponencial e fila de falhas não repetem mensagens já confirmadas; registrar a limitação de exatamente uma vez se o provedor não oferece idempotência.
- [ ] Desligar administrador revoga acesso, mantém casos, respostas, alterações, uploads e trilha. Reatribuir pendências por comando auditado; não apagar nem reescrever autor histórico.

**Aceite:** duas tentativas com mesma chave geram um registro; queda no envio não apaga dado; 503 não informa sucesso; administrador desligado não acessa currículo antigo, mas responsável autorizado continua o atendimento.

## I05 — Feed mínimo e recrutamento no RH

- [ ] Implementar endpoints C06 com snapshot, paginação por sequência de commit, retomada, exclusão lógica/tombstones e reconciliação. Credencial RH só lê projeções contratadas.
- [ ] Projeção de candidatura: ID do produtor, origem, status, datas, área e metadados mínimos de tratamento/consentimento. Dados de contato necessários ao recrutamento ficam em escopo separado `recruitment.read`, nunca no feed de produtividade. Conteúdo integral/currículo não integra o feed geral.
- [ ] RH recebe em `incoming_applications` com `source_app` + `source_id`, pois sua tabela atual de candidatos exige vaga. Não inventar vaga nem autoaprovar candidato. Associação a vaga/vínculo funcional é ato separado e auditado.
- [ ] Quando RH precisar de currículo, usar endpoint de arquivo específico com autorização de recrutamento, acesso mínimo auditado, sem URL pública reutilizável. Arquivo original continua no site; não replicar por conveniência no data mart.
- [ ] Projeção de atividade administrativa registra categoria não sensível, objeto opaco, ator `auth_user_id/person_id`, instante e revisão. Não enviar conteúdo de contato, relato, resposta LGPD, IP, cookies ou visitante identificado. Excluir atividades de integridade/privacidade da produtividade individual.
- [ ] Não atribuir candidatura recebida ao empregado cujo e-mail coincide, nem usar visitante como ator interno. Atribuir ação de atendimento ao administrador que realmente a executou, com ator e sujeito separados.
- [ ] Ativar source `institucional` no registro restrito do RH, apresentar capabilities e comprovar carga/replay em homologação. App não cadastra arbitrariamente outra URL no coletor.

**Aceite:** candidatura sem vaga é recebida em staging; duplicação/replay não duplica; payload de produtividade não contém nomes de candidatos/currículos/relatos; RH não consulta SQL do site.

## I06 — VPS, testes, corte e reversão

- [ ] Empacotar Node compilado + views EJS + assets em imagem reproduzível; preservar estrutura esperada de `dist`, permissões e caminhos. Runtime sem compilador/seed privilegiado.
- [ ] Implementar compose/env de exemplo sem segredo, proxy HTTPS, rede mTLS e banco dedicado. Secret de assinatura/sessão e material de cifra ficam fora imagem/Git.
- [ ] Executar `npm run build` e `npm test`, depois novos contratos, testes reais de PostgreSQL isolado e matriz comum. Testes HTTP cobrem SSR, cookies/CSRF, callbacks, CSV, currículo, uploads inválidos, gate público e filtros de coleção.
- [ ] Fazer backup consistente incluindo bytea, restore de fixture e reconciliação de binários por SHA-256; guardar comprovantes sem arquivos reais no repositório.
- [ ] Corte: congelar alterações administrativas, backup, migrations, vinculação revisada, invalidar sessão local antiga, abrir AUTH/RH, testar operador e público, ativar coletor e liberar tráfego.
- [ ] Rollback usa imagem anterior compatível com o schema aditivo **e integração central mantida**. Nunca restaurar senha local como contingência. Se não houver versão anterior segura, manutenção até reparo.
- [ ] Atualizar README, operação, catálogo de permissões e `release.json` com gates e evidências reais. Não declarar validação jurídica das páginas/textos preexistentes.

**Entrega `INSTITUCIONAL_INTEGRATED_V1`:** painel centralizado, público anônimo com dependência técnica explícita, DB isolado, feed e recrutamento mínimos consumidos pelo RH, restauração exercitada e ausência de fallback local.

## I07 — Institucional → Comercial (C12 conexão 1)

O site é a **origem**; o Comercial, em produção e com repositório congelado, é o destino. O site nunca depende do Comercial para funcionar.

- [ ] **Link "Área do cliente":** já existe alteração local, sem commit, em `src/config.ts`, `src/server.ts` e `src/views/partials/topo.ejs` (variável `PORTAL_CLIENTE_URL`; vazia, nada muda). Revisar, testar com e sem a variável e publicar só com autorização do dono. É apenas um link: sem iframe, sem sessão compartilhada.
- [ ] **Pedido de orçamento (futuro):** formulário público com aviso de privacidade versionado, gravado no banco do site e enviado por outbox a `comercial.lead.create` (mTLS + `service-authorize`). Comercial parado deixa o pedido pendente; o visitante recebe a confirmação do site, não do Comercial. Ligar só quando o Comercial implementar a rota, o que depende de liberação do dono.
- [ ] Relatos de integridade, currículos e dados do canal do titular **nunca** vão ao Comercial.

**Aceite:** site sem a variável fica idêntico ao atual; com a variável, o link abre o portal; pedido de orçamento simulado é entregue uma vez mesmo com reenvio e o site funciona com o Comercial fora do ar.

## Instrução de execução

Executar I01 → I02 → I03 → I04 → I05 → I06, mantendo checkpoints revisáveis. Implementar/testar com dados fictícios até os gates de ambiente real. Não pedir nova definição de arquitetura; se faltarem domínio, certificado ou credencial, concluir software/testes locais, registrar o item exato no preflight e não fabricar configuração de produção. Os demais sistemas dos desenhos continuam fora do escopo desta entrega.
