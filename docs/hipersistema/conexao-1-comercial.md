# Conexão 1 — Institucional → Comercial (C12)

O formulário de contato do site vira um **lead** no Comercial HS, por mTLS com a identidade `institucional-api`. Desligada por padrão; o site funciona sozinho se o Comercial estiver fora do ar.

## O que atravessa

`POST /api/integracao/v1/comercial/leads` (capacidade `comercial.lead.create`), `Idempotency-Key: site-contato:<id do contato>` (estável por contato). Corpo estrito do contrato do Comercial: `empresa`, `cnpj` (opcional), `contato {nome, email, telefone?}`, `servico_interesse` (= "Assunto", opcional), `mensagem`, `privacy_version` (versão do aviso aceito no envio). Nada mais: IP, navegador, status e observações do painel não saem do site. Empresa em branco usa o nome da pessoa (o contrato exige `empresa`); mensagem acima de 4000 caracteres é cortada no envio (o texto inteiro fica no `/admin`). `GET .../leads/:id` (`comercial.lead.read`) devolve só o estado (`lerEstadoLead`, ainda sem tela no painel).

## Como funciona no site

- `src/comercial.ts`: corpo do contrato, classificação das respostas, recuo, cliente mTLS (modelo `sl-notify.ts` do RH). Não importa config nem banco.
- `src/comercial-fila.ts`: fila em `leads_comercial`. A linha nasce **na mesma instrução SQL** que grava o contato (`routes/forms.ts`), só com a integração ligada. O corpo é montado do contato no envio (a fila não duplica dado pessoal) e `ON DELETE CASCADE` acompanha a retenção de 24 meses.
- 200/201/202 = entregue (202 é "em análise", não erro); 409 e demais 4xx = rejeitado (não repete, alerta no log); 401/403 = repete devagar com alerta; 5xx/rede/408/429 = repete com recuo exponencial.
- Log sem dado pessoal: só código, status HTTP e id da fila.

## Ligar

`COMERCIAL_API_URL` (https, listener de serviço do Comercial) + `COMERCIAL_MTLS_CA/CERT/KEY` (identidade `institucional-api`). Sem qualquer um deles a integração fica desligada (aviso único no log). Opcional: `COMERCIAL_FILA_INTERVALO_MS` (padrão 60000).

O listener do Comercial precisa servir **certificado de servidor** (não o `api.crt`, que é só de cliente): `INTEGRACAO_TLS_CERT/KEY` no Comercial HS (ver correção na branch `feat/teste-conexao-1` dele).

## Botão "Área do cliente"

Já no topo e no rodapé (`PORTAL_CLIENTE_URL`, https; vazio desliga).

## Prova

`npm run e2e:conexao-1` exercita o Site e o listener do Comercial HS com bancos descartáveis, usando AUTH e RH por mTLS. Requer a capacidade de eliminação no AUTH, disponível na porta 9446 por padrão, e o RH na porta 9545. O repositório do Comercial HS fica ao lado ou é indicado em `HS_DIR`.

## Política de Privacidade (versão 1.2, 06/11/2026) — TEXTO PROPOSTO, REVISAR COM O JURÍDICO

O dono autorizou ("pode criar") o texto que faltava. Está em `src/content.ts` (`privacidade`, nova seção "Seu pedido de contato ou de orçamento e o sistema comercial da Afirma E-vias") e diz, em linguagem clara: quais dados do formulário seguem ao sistema comercial da própria Afirma E-vias (nome, e-mail, telefone, empresa, CNPJ, assunto, mensagem), a finalidade (atender o pedido e elaborar a proposta), a base legal (art. 7º, V, a mesma já usada para contatos comerciais), que o controlador continua sendo a Afirma E-vias, a retenção (24 meses do recebimento, o mesmo prazo do site; prazos próprios se virar proposta/contrato) e o canal de direitos (Portal do titular; o pedido de eliminação alcança a cópia no Comercial). Também mudaram: lista de dados (CNPJ, assunto), base legal do contato, "Com quem compartilhamos", prazos e o rótulo do aceite nos dois formulários ("...inclusive pelo sistema comercial da empresa, para atender o meu pedido").

**Versão:** `privacidade.versao` 1.1 -> 1.2 e `config.versaoPolitica` `2026-10-20` -> `2026-11-06`. É `config.versaoPolitica` que o formulário grava em `leads_comercial.privacidade_versao` e que vai como `privacy_version` no lead; o teste `comercial-privacidade.test.ts` exige que as duas andem juntas. Leads já na fila com a versão antiga a mantêm (é a versão aceita no momento do envio).

**Publicar o texto junto com a integração ligada** (o texto descreve o envio ao Comercial; com `COMERCIAL_API_URL` vazio o site não envia nada).

## Eliminação LGPD de lead já entregue (pendência no Comercial)

O contrato C12 usa `DELETE /api/integracao/v1/comercial/leads/:id` com a capacidade `comercial.lead.delete`. O Site envia apenas o UUID do lead. A resposta 204 confirma a exclusão ou uma repetição. Um lead vinculado a cliente ou convertido retorna 409 `lead_linked` para análise comercial. O Comercial mantém um comprovante com UUID, data e hash da chave de entrega, suficiente para impedir que um reenvio recrie o lead.

- Tabela `eliminacoes_comercial` (`db/schema.sql`): `lead_id` (UUID devolvido pelo Comercial), `pedido_em`, `origem` (`painel` | `retencao`), `registrado_por` (UUID do operador do painel; nulo na retenção), `status` (`pendente` | `concluida`), `concluida_em`, `concluida_por`. **Nenhum dado pessoal** (nem nome, e-mail, telefone, CNPJ, mensagem ou IP); há teste no schema e no banco real.
- Gatilho `BEFORE DELETE` em `contatos`: se o contato tem fila com `lead_id` preenchido (lead entregue), cria a pendência **na mesma transação**, antes de o contato sumir. Vale para a exclusão pelo painel, para a retenção de 24 meses (`regras-retencao.ts` não mudou) e para SQL manual. Fila pendente ou rejeitada (sem `lead_id`) não gera pendência.
- Painel: a exclusão de contato passa por `excluirContatoPeloPainel` (transação que informa quem pediu) e a auditoria ganha `pendenciaEliminacaoComercial`. Em `/admin/eliminacoes-comercial`, o administrador usa **Eliminar no Comercial**. O Site conclui e audita a pendência após receber 204. Falha ou vínculo comercial preserva a pendência para nova tentativa ou análise.
- Corrida rara: se o contato for apagado enquanto o envio estava em andamento e o Comercial aceitar o lead depois, `comercial-fila.ts` registra a pendência com o `lead_id` recebido (`registrarPendenciaOrfa`).

Prazo: pedido de titular tem 15 dias (protocolo); a pendência deve ser concluída dentro dele. Se o lead já virou cliente/proposta/contrato no Comercial, quem decide o que eliminar é o responsável de lá.

**Limites conhecidos:** Se a entrega original foi aceita e sua resposta se perdeu antes de o Site obter o `lead_id`, a exclusão imediata do contato não gera pendência pelo UUID do lead. O Comercial identifica essa entrega pelo `Idempotency-Key` `site-contato:<id>`. As pendências guardam somente os dados técnicos e os operadores da ação e não têm descarte automático.

## Pendências (decisão do dono)

- Revisão jurídica do texto proposto da Política de Privacidade (acima) e do rótulo do aceite; confirmar se, para pedidos com CNPJ (pessoa jurídica), o jurídico prefere acrescentar o legítimo interesse (art. 7º, IX) como base alternativa.
- Combinar com o responsável do Comercial quem trata as pendências de `/admin/eliminacoes-comercial` e em que rotina.
- Estado do lead (`lerEstadoLead`) ainda não aparece no painel do site.
