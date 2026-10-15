# Checkout Efí e split

O checkout online desta primeira etapa usa a API de cobranças Efí para cartão
de crédito. A loja recebe a parte do pedido configurada no split; o saldo da
transação fica na conta Efí da DoixP. O Pix do delivery continua sendo manual e
vai diretamente para a chave da loja. Nas vendas presenciais, crédito e débito
são registrados como maquininha e cobrados no terminal do estabelecimento.

## Requisitos da conta

- Uma conta Efí da DoixP com a API Cobranças habilitada e autorização para
  marketplace/split.
- Uma conta Efí para cada loja recebedora, com o `payee_code` copiado do painel.
- Aprovação da Efí para emissão de cobranças de cartão não presente.
- Confirmação comercial da taxa da plataforma antes de ativar produção.
- Confirmação da tarifa de processamento aplicável à conta Efí e à modalidade de parcelamento.

O split só pode transferir valores entre contas Efí. O `payee_code` da loja é
guardado na configuração daquele estabelecimento; `client_id` e `client_secret`
da plataforma ficam nos secrets do servidor.

## Variáveis do servidor

Secrets de Cloudflare Pages/Workers (ou `.dev.vars` local):

- `EFI_CLIENT_ID`
- `EFI_CLIENT_SECRET`

Variáveis não secretas em `wrangler.toml`:

- `EFI_ENVIRONMENT`: `sandbox` ou `production`; mantenha `sandbox` durante a
  homologação.
- `EFI_NOTIFICATION_URL`: URL HTTPS pública da rota de notificação. Para
  produção, use `https://doixp.com/api/public/efipay/checkout/notificacao`; em
  homologação, aponte para o ambiente que estiver sendo testado.
- `EFI_PLATFORM_FEE_BPS`: taxa da plataforma em basis points. O exemplo usa `2`
  (0,02%), herdado da preparação anterior de pagamentos. Confirme a taxa real
  antes de habilitar produção.

O checkout fica indisponível se faltarem credenciais, se a taxa não estiver
entre 1 e 9999 bps, ou se a loja ainda não tiver um `payee_code` válido.

## Fluxo de confirmação

O servidor cria um link Efí para cartão de crédito com o identificador do pedido
em `custom_id`. O pedido fica em `aguardando_pagamento`. A notificação da Efí
contém apenas um token; o servidor consulta esse token e, em seguida, consulta a
cobrança diretamente para conferir status `paid`, valor e pedido antes de liberar
o pedido para a cozinha. A tela de acompanhamento também pode consultar o status
da cobrança enquanto permanece aberta.

Os itens de produtos recebem split percentual entre a loja e a DoixP. A taxa de
entrega da loja é repassada integralmente à loja; a taxa de entrega da plataforma
continua fora do checkout Efí nesta primeira etapa. A futura divisão de frete
com o entregador deve ser implementada como uma regra de split própria, depois
que a conta e a operação de entregas estiverem prontas.

A tarifa de processamento Efí é atribuída às contas recebedoras no split
(`mode = 2`); como a loja é a recebedora deste checkout, ela assume a tarifa da
transação. A tarifa pública de referência é 3,49% no crédito à vista; no
parcelado, a tarifa varia conforme o número de parcelas e o prazo de
recebimento. Essa cobrança é independente da taxa de serviço da plataforma,
configurada em `EFI_PLATFORM_FEE_BPS`.

## Ativação

1. Cadastre `EFI_CLIENT_ID` e `EFI_CLIENT_SECRET` como secrets e mantenha
   `EFI_ENVIRONMENT=sandbox`.
2. Confirme a aprovação da API Cobranças e do split na conta Efí da DoixP.
3. Informe o `payee_code` de cada loja em **Configurações → Pagamentos Efí**.
4. Homologue criação, aprovação, recusa, expiração, notificações repetidas e
   conferência do valor em sandbox.
5. Defina e aprove formalmente a taxa da plataforma; só então altere o ambiente
   para `production` e configure os secrets de produção.

Nunca coloque credenciais em `VITE_*`, no APK, em arquivos versionados ou em
conversas. O `payee_code` não substitui a autorização de marketplace da Efí.
