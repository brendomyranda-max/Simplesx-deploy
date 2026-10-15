# API local — DoixP Entregas

Base `/api`, JSON. Erros retornam `{ "error": "mensagem" }` com status 400,
401, 403, 404, 409 ou 429. Sessão em cookie HttpOnly; mutações exigem
`Content-Type: application/json` e verificam a origem quando presente.
Papéis: `support`, `merchant`, `driver`. Valores monetários em centavos inteiros.

| Método e rota | Acesso | Conteúdo / resultado |
| --- | --- | --- |
| GET `/bootstrap` | Público | `{ needsSetup }` |
| POST `/setup` | Primeiro acesso | `{ name, username, password }`; cria suporte e sessão |
| POST `/login` | Público | `{ username, password }`; retorna `{ user }` e cookie |
| POST `/driver/register` | Público | Cadastro próprio do entregador; começa aguardando aprovação do suporte |
| POST `/logout` | Sessão | `{}`; remove sessão |
| GET `/me` | Sessão | `{ user: { id, name, username, role } }` |
| GET `/state` | Sessão | `{ settings, orders, drivers, incidents, settlements }`, filtrado por papel |
| GET `/accounts` | Suporte | Lista de contas, sem senhas |
| POST `/accounts` | Suporte | `{ name, username, password, role, phone, address, lat, lng, onlineEstablishmentId? }` |
| PATCH `/settings` | Suporte | `{ extraKmCents }` |
| POST `/quote` | Sessão | `{ distanceKm, subsidy }`; total e parcelas calculados |
| POST `/orders` | Loja | Pedido conforme exemplo abaixo |
| GET `/customer/:token` | Portador do link | Valor e decisão, sem dados pessoais do comprador |
| POST `/customer/:token` | Portador do link | `{ accept: true }` ou `{ accept: false }` |
| POST `/availability` | Entregador | `{ online, lat, lng }`; coordenadas obrigatórias ao ficar online |
| POST `/location` | Entregador | `{ lat, lng }` |
| POST `/drivers/:id/review` | Suporte | `{ suspended, note }`; `false` aprova ou libera, `true` suspende |
| POST `/settlements/close` | Suporte | `{ weekStart: "2026-10-05" }`; lista de fechamentos da semana |
| POST `/settlements/:id/paid` | Suporte | `{ reference }`; registro de pagamento externo |
| GET `/privacy-public` | Público | `{ operator, contact, configured }`; contato definido no servidor |
| GET `/account-deletion` | Sessão | `{ requests }`; solicitações da própria conta |
| POST `/account-deletion` | Sessão | `{ note? }`; cria protocolo pendente, sem executar exclusão |
| GET `/deletion-requests` | Suporte | `{ requests }`; todas as solicitações de exclusão |

A solicitação de exclusão aceita observação de até 1.000 caracteres. A primeira
criação responde 201 com `{ request, created: true }`; repetições com um protocolo
pendente retornam o protocolo existente e 200 com `created: false`. O tratamento
da exclusão é humano e não há rota de apagar contas nesta versão.

Estabelecimentos exigem endereço e coordenadas no cadastro. Senhas de 10 a 128
caracteres. O cadastro de suporte adicional não é exposto pela API.
O app Android usa `/driver` e aceita somente o perfil de entregador. O suporte
usa o painel web. A loja vinculada ao delivery realiza suas ações no DoixP
Delivery por meio das rotas de integração assinadas abaixo.

## Integração assinada com o DoixP Delivery

As rotas `/integration/*` exigem `x-doixp-timestamp` em milissegundos e
`x-doixp-signature`, HMAC-SHA256 hexadecimal de `<timestamp>.<JSON exato>` com
`ENTREGAS_INTEGRATION_SECRET` (mínimo de 32 caracteres). A janela é de cinco
minutos. Somente o backend de vendas possui o segredo.

| Método e rota | Resultado |
| --- | --- |
| POST `/integration/orders` | Cria corrida idempotente para pedido confirmado |
| GET `/integration/stores/:establishmentId/orders` | Corridas da loja vinculada |
| GET `/integration/stores/:establishmentId/orders/:id` | Estado de uma corrida da loja |
| POST `/integration/stores/:establishmentId/quote` | Cotação por `distanceKm` e `subsidy` |
| POST `/integration/stores/:establishmentId/orders/:id/:action` | Ações `ready`, `pickup`, `cancel`, `report` |

No Pix atual, `POST /integration/orders` recebe `paymentMode:
"pix_confirmed_manually"`, `paymentReference`, `establishmentId`, `reference`,
dados de destino e cliente, `customerCpfLast4`, `distanceKm`, `subsidy` e a
cotação aceita (`quotedTotalCents`, `quotedMerchantCents`,
`quotedCustomerCents`). O anúncio ocorre após a loja confirmar o Pix no DoixP
Delivery. O campo `fundedDriverCents` é reservado para uma futura cobrança
confirmada pelo provedor com `paymentMode: "provider_captured"`.

Exemplo de pedido:

```json
{
  "reference": "VENDA-123",
  "customerName": "Nome do comprador",
  "customerPhone": "11999999999",
  "customerCpfLast4": "0012",
  "destinationAddress": "Rua de entrega, 10",
  "destinationLat": -23.56,
  "destinationLng": -46.64,
  "distanceKm": 7,
  "subsidy": "base",
  "ready": false
}
```

A resposta é o pedido, com `customerToken` acessível somente à loja dona para
compartilhar `/?cliente=TOKEN`. Esse link é uma credencial de autorização do frete;
compartilhe somente com o comprador. Não registra pagamento recebido.

Todas as ações abaixo usam POST `/orders/:id/:action`:

| Ação | Quem executa | Corpo |
| --- | --- | --- |
| `ready` | Loja dona | `{}` |
| `accept` | Entregador online, disponível e ativo | `{}` |
| `pickup` | Loja dona | `{ "code": "012345" }` informado pelo entregador |
| `deliver` | Entregador responsável | `{ "code": "0012" }` informado pelo cliente |
| `contact-customer` | Entregador responsável | `{ "note": "Descrição da tentativa" }` |
| `contact-merchant` | Entregador responsável | `{ "note": "Descrição do contato" }` |
| `report` | Loja ou entregador responsáveis | `{ "kind": "unreachable", "note": "Descrição" }`; tipos `unreachable`, `fraud`, `other` |
| `cancel` | Loja dona | `{ "note": "Motivo" }` |
| `resolve` | Suporte | `{ "resolution": "returned", "note": "Decisão", "compensationCents": 1000 }` |
| `suspend` | Suporte | `{ "note": "Motivo" }`; suspende o entregador vinculado e abre ocorrência |

Resoluções: `resume`, `returned`, `cancelled`. Compensação é obrigatória nos dois
últimos casos após retirada. Estados: `awaiting_customer`, `searching`, `accepted`,
`in_transit`, `incident`, `delivered`, `cancelled`, `returned`. Uma entrega concluída
contestada mantém `delivered` e recebe `held: true` até análise.

O histórico registra responsáveis, horários e ações. Nenhuma resposta contém o
código esperado de entrega ou seu hash. O código de coleta aparece somente para
o entregador atribuído antes da retirada. Ofertas ocultam identificação e endereço
exato do comprador; as permissões são aplicadas no servidor.
