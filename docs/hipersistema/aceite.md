# Aceite, testes e passagem entre repositórios

Contrato `AEVIAS-HIPERSISTEMA-1.0`. Estes critérios serão executados na implementação. Os testes das aplicações não foram rodados na entrega deste planejamento. Usar exclusivamente fixtures fictícias em testes; scripts que hoje alcançam serviços locais reais precisam ser adaptados antes de entrar na suíte nova.

## T01. Entrega mínima por etapa

Para marcar uma tarefa concluída, anexar a `docs/hipersistema/execucao.md`: ID da tarefa, arquivos alterados, migrations novas, comando executado, exit code, resumo de testes, ambiente/destino sem segredo, versão/hash do contrato e limitações. Não usar contagens antigas de testes como prova atual.

Release readiness (arquivo proposto `artifacts/hipersistema/release.json`, gerado pelo executor, não preenchido com sucesso fictício):

```json
{
  "app_code": "rh",
  "milestone": "RH_READY_V1",
  "git_commit": "<commit da implementação>",
  "contract_version": "AEVIAS-HIPERSISTEMA-1.0",
  "contract_sha256": "<hash>",
  "image_digest": "<digest>",
  "migrations": ["<IDs reais>"],
  "test_environment": "isolated",
  "contract_tests": "passed",
  "integration_tests": "passed",
  "restore_test": "passed",
  "known_limits": [],
  "produced_at": "<UTC>"
}
```

Cada repositório define scripts novos `test:hipersistema`, `test:contract`, `test:integration:core` e `preflight:hipersistema` conforme seu package manager. Eles ainda não existem; criá-los como parte da entrega. Os nomes comuns permitem ao próximo executor repetir verificações sem descobrir uma sequência distinta por projeto. Nenhum desses scripts carrega `.env` de produção por padrão.

## T02. Fixtures comuns

Bundle AUTH/RH deve conter pessoas/identidades sintéticas: administrador operacional, RH, gestor limitado ao time A, funcionário A, funcionário B, funcionário desligado, terceiro válido, cliente externo de regional A, cliente externo de regional B, identidade sem grant, pessoa sem vínculo, identidade com perfil local inativo e duas identidades com e-mail conflitante no histórico. Senhas aleatórias em runtime, e-mails `.invalid`, nenhuma conta do operador.

Estrutura organizacional com duas unidades, troca de cargo em data intermediária, desligamento futuro/efetivo e readmissão. Objetos de Controle/Lab com assinaturas/trilha válidas e exemplos de anomalias históricas catalogadas. Ponto com marcação tardia, lote repetido, recibo perdido, ajuste posterior, funcionário desativado e mudança de papel. Institucional com contato/candidatura/relato anônimo distintos.

## T03. Matriz de segurança e disponibilidade

| ID | Cenário | Resultado necessário |
|---|---|---|
| SEC-01 | Sem sessão / token inválido / ID token usado em API | 401; nenhum dado de negócio |
| SEC-02 | Token correto para outro app/issuer | Recusado; não consultar/perfilar por e-mail |
| SEC-03 | Sem grant AUTH, mesmo com perfil local admin | 403 `app_not_allowed` |
| SEC-04 | RH bloqueia pessoa, AUTH ainda tem sessão ativa | 403 `person_blocked`; dados/progresso preservados |
| SEC-05 | Perfil local ausente/inativo | 403; sem auto-provisionamento |
| SEC-06 | Papel rebaixado no RH ou app, sessão antiga | Próxima decisão usa papel atual; não esperar expiração |
| SEC-07 | Serviço tenta conceder grant de outro app | 403 e auditoria, nenhuma mudança |
| SEC-08 | Mesmo e-mail, `sub` diferente | Não religa automaticamente; conflito/vínculo pendente |
| SEC-09 | Cliente externo sem employee_id | Entra só no app concedido e escopo local; folha RH negada |
| SEC-10 | Certificate inválido/expirado/SAN de outro app | mTLS ou autorização recusa; header forjado não substitui certificado |
| SEC-11 | Key compartilhada antiga/GoTrue legado/JWT Ponto 365d | Nenhum endpoint de produção aceita após o corte |
| SEC-12 | Troca de senha/logout global/remover grant | Sessões e refresh afetados recusados na próxima decisão |
| SEC-13 | Alteração `cargo=admin`/user_metadata/functional_role livre | Nenhuma elevação de privilégio |
| SEC-14 | Requisição mutável via cookie sem CSRF/origem válida | Recusada; callback OIDC valida state/nonce/PKCE |
| SEC-15 | Código/ticket/refresh reutilizado | Replay recusado e família de refresh revogada conforme política |
| DEP-01 | AUTH cai antes do startup | RH/apps não ficam ready; sem login local |
| DEP-02 | AUTH cai após login | Próxima operação: 503, sem gravação de negócio; live continua |
| DEP-03 | RH cai após login | Consumidores 503; AUTH continua funcional |
| DEP-04 | Ponto/Lab/Controle/site cai | AUTH/RH core continuam ready; conector correspondente stale |
| DEP-05 | AUTH volta e pessoa foi desligada | Bloqueio RH persiste; sessão antiga não reabre acesso |
| DEP-06 | Gateway saudável, upstream indisponível | ready 503; não confundir 200 da borda com core saudável |
| DEP-07 | Chamadas lentas/concurrency alta | Timeout/orçamento limitado, sem pools/filas ilimitados |
| DEP-08 | Endpoint público com core fora | 503/manutenção sem expor dados; visitante não recebe login obrigatório |
| DEP-09 | SSE/stream iniciado antes de revogação | Encerra no intervalo definido; não continua entregando dados indefinidamente |

Revogação não desfaz transação que já confirmou antes do bloqueio. Testes de corrida devem demonstrar e registrar esse limite; usar barreiras no teste para provar a revalidação antes de operações sensíveis. Não simular sucesso de chamada AUTH perdida.

## T04. Banco, migração e recuperação

- DB-01: runtime de cada app só conecta ao próprio banco e não executa DDL, não cria role, não altera trilhas/assinaturas protegidas. Testar com roles reais.
- DB-02: RH inicia com Ponto desligado e sem rede/credencial para o banco do Ponto. A busca de `public.users` desaparece do runtime e setup RH; referências históricas/testes de migração são identificadas.
- DB-03: aplicar migrations duas vezes, lock concorrente, checksum adulterado e interrupção. Nenhuma migration antiga editada; destino tem versão esperada.
- DB-04: restauração com PK, contagem, sequência e ciphertext preservados; chaves faltantes impedem promover ambiente, não silenciam erro.
- DB-05: comparação de assinatura/trilha antes/depois sem novas divergências; diferenças históricas enumeradas separadamente. Não aceitar recalcular a cadeia como correção.
- DB-06: migração não faz seed, não trunca e não altera `public` do Ponto para criar o novo RH. Origem permanece disponível para conferência.
- DB-07: restore de backup anterior ao desligamento seguido de ledger/replay mantém usuário bloqueado; replay não ressuscita conteúdo eliminado.
- DB-08: restore isolado sem envio real de e-mail (Resend)/integração externa; medir RPO/RTO, checksums dos arquivos e descriptografia controlada.

## T05. Coleta, consistência e produtividade futura

- INT-01: snapshot + eventos após H reproduzem estado da origem sem lacuna/duplicata.
- INT-02: duas transações confirmam fora da ordem de início; cursor não salta a mais lenta. Provar a garantia de commit da sequência.
- INT-03: falha depois de gravar projeção e antes da resposta/checkpoint; replay não duplica; checkpoint/projeção são atômicos.
- INT-04: evento duplicado, fora de ordem, versão antiga e revisão/tombstone; estado correto, histórico preservado.
- INT-05: batida de ontem recebida hoje e ajuste de mês passado entram no RH; sem cursor por data da atividade.
- INT-06: schema desconhecido em um item entra em quarentena rastreável; backlog aplicado não é confundido com backlog recebido.
- INT-07: nenhum payload exporta CPF/GPS/selfie/salário/relato/currículo binário por acidente. Testar serialização com campos extras proibidos na origem.
- INT-08: evento do funcionário A executado por supervisor B mantém ambos papéis; coleta não atribui todo trabalho ao aprovador.
- INT-09: funcionário desligado continua em consultas históricas permitidas e nos fatos anteriores ao desligamento. Readmissão distingue episódio novo.
- INT-10: origem indisponível mostra idade real dos dados; RH não apresenta “zero produção” quando não houve coleta.
- INT-11: cursor expirado retorna 410 e resnapshot; idempotência de comando com corpo divergente retorna 409.
- INT-12: conector novo é ativado por registro/configuração e contrato já entregue, sem alterar middleware/readiness RH e sem exigir SQL no banco do produtor.

## T06. Offline e regressão dos domínios

- OFF-01: fila anterior à atualização sobrevive à migração de stores, reboot/app fechado e perda de rede.
- OFF-02: cair AUTH/RH durante sync preserva lote/arquivos; retry usa mesmos IDs e não duplica gravação já confirmada.
- OFF-03: 401, 403 e 429 não descartam permanentemente a fila; bloqueio de pessoa cria estado recuperável, sem envio de outra conta.
- OFF-04: logout, troca de issuer, conta ou ambiente não mistura/projeta dados de outra identidade.
- OFF-05: dispositivo sem rede registra somente material provisório permitido; não aprova, assina ou confirma NSR offline.
- OFF-06: desligamento com fila pendente preserva autoria/hora, exige recuperação administrativa e não falsifica assinatura do autor.
- DOM-01 Controle: criar rascunho → foto offline → finalizar/assinar → aprovar → imprimir/verificar; isolamento regional e conflitos continuam corretos.
- DOM-02 Lab: amostra/FAS → ensaio → aprovação → certificado → revisão; numeração, competência técnica, imutabilidade e hashes preservados.
- DOM-03 Ponto: entrada/saída → atraso na sincronização → ajuste → espelho mensal; totais iguais ao motor existente, incluindo histórico de desligados.
- DOM-04 RH: quatro papéis, escopo de gestor, folha/salário cifrados, portal do próprio titular, estatísticas protegidas continuam corretos.
- DOM-05 Institucional: navegação pública, contato, candidatura e protocolo continuam possíveis sem conta enquanto core saudável; painel exige AUTH + RH + perfil local.

## T07. Teste integrado e carga

Implementar laboratório Compose isolado com prefixo exclusivo, volumes descartáveis e portas livres; nenhum script destrói volume sem verificar label/ambiente. Fixtures provam primeiro AUTH isolado, depois RH+AUTH, depois cada consumidor real. Mocks são úteis para desenvolver RH antes dos produtores, mas não fecham o gate integrado final.

Carga inicial reproduzível: 100 usuários virtuais, 30 minutos, mix 70% leitura/20% gravação idempotente/10% sync/exportação; incluir rajada de 1000 itens offline por origem com limites de lote, documentos antigos e 10 min de core degradado. Ajustar volume ao preflight medido; guardar scripts/seeds e percentis. Meta inicial p95 <=500 ms para decisão core na rede interna e <=2 s para CRUD comum, erro inesperado <1%, zero vazamento/perda/duplicação. Upload/relatório pesado têm medição própria. Meta falhou: otimizar/dimensionar e repetir somente cenários afetados; não retirar autorização online para passar carga.

Chaos em homologação: derrubar AUTH, RH, um DB e um produtor separadamente, interromper worker e reiniciar durante lote, saturar storage, simular certificado vencido, cortar acesso a offsite e restaurar imagem anterior. Registrar reação e recuperação, não executar chaos na produção sem escopo próprio.

## T08. Gate de passagem e conclusão

`AUTH_READY_V1`: protocolo/adapter/login/serviços funcionando em ambiente isolado real, não depende de RH, contratos e fixture-client publicados, revoke/grants/backup testados.

`RH_READY_V1`: banco independente, AUTH real, contexto e desligamento funcionais, coleta de todos os contratos com simuladores e registro de conectores, produtores ausentes não derrubam core. Readiness distingue core e coletores.

`<APP>_INTEGRATED_V1`: testes existentes pertinentes + matriz comum aplicável + contrato produtor/consumidor + AUTH/RH reais + restore do app e domínio preservado. Registrar/ativar o conector RH usando interface administrativa já implementada; credenciais vêm do ambiente de teste/deploy, não do Git.

`ECOSSISTEMA_HOMOLOGADO_V1`: seis releases reais, bancos isolados, desligamento ponta a ponta, regressão mobile/offline, migração de arquivos/paridade, teste de carga e restore conjunto aprovados. Ausência de exportação/credencial de origem pode bloquear cutover, nunca justificar marcar migração real concluída.

Não declarar BI de produtividade pronto. A entrega inicial fica concluída quando identidade/acesso/coleta e preservação funcionarem, com roadmap analítico separado. Eventos vazios, fake metrics, contas artificiais para pessoas reais e gráficos com números de seed não contam como integração de produção.
