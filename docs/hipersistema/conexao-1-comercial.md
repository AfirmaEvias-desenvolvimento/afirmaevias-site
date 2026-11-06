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

`npm run e2e:conexao-1` (51 verificações): site real + listener real do Comercial HS em bancos descartáveis, AUTH e RH reais. Requer AUTH em 9446 e RH em 9545 no ar e o repositório do Comercial HS ao lado (`HS_DIR`).

## Pendências (decisão do dono)

- Política de Privacidade: citar o Comercial como destino interno do contato (mesmo controlador); hoje o texto não menciona.
- Pedido LGPD de eliminação: o site apaga o contato e a fila, mas o lead já entregue continua no Comercial (apagar lá é manual).
- Estado do lead (`lerEstadoLead`) ainda não aparece no painel do site.
