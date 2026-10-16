# Cadastro e apresentação da DoixP

## Modelo comercial

A proposta é uma mensalidade fixa para o estabelecimento, sem comissão sobre
vendas e sem cobrança por pedido. A antiga taxa única de abertura foi retirada.
O valor mensal ainda não foi definido no código: `valor_centavos` é `null` e
`periodicidade` é `mensal` em `shared/signup-policy.js`.

A tela de acesso informa **Cadastro em preparação**. `POST /api/auth/cadastro`
retorna HTTP 403 e não cria estabelecimento, funcionário, sessão ou configurações.
Dados de pagamento enviados por clientes antigos não liberam contas.
O login das contas existentes e a criação administrativa pela CLI continuam
disponíveis. Não foi implementada cobrança recorrente nesta alteração.

## Apresentação da empresa

A página inicial, em `src/pages/PortalPage.tsx`, apresenta:

- Quem somos: consumidores, comércios e entregadores em uma relação mais justa.
- O que a DoixP entrega: gestão, atendimento, validade, etiquetas e comandas NFC.
- Onde queremos chegar: DoixP Entregas em desenvolvimento, com a proposta de
  destinar 100% do valor das entregas ao entregador, sem comissão da DoixP.
- Nossa história: os seis anos do fundador como garçom e bartender e a criação
  de uma plataforma que reúne ferramentas antes separadas.

O slogan é **Com a DoixP, todo mundo ganha.**

A apresentação pública `/investidores` segue o mesmo modelo de mensalidade.
Sua referência anterior a impulsionamento pago foi substituída pela proposta
para os entregadores. Valores de aporte, preço mensal, prazos e condições de
investimento não foram definidos nesta alteração.

O conteúdo está em `src/content/investidores.ts` e `src/pages/InvestidoresPage.tsx`.
O botão **Quero investir** abre o WhatsApp de Brendo Myranda com uma mensagem
preenchida; o visitante decide se deseja enviá-la.

## Pagamento online

A retirada do checkout Efí está descrita em [EFI_CONFIGURACAO.md](./EFI_CONFIGURACAO.md).
O Pix direto ao estabelecimento permanece com confirmação manual.
