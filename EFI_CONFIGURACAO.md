# Pagamento online pausado

O checkout Efí e o split foram retirados do fluxo de compra por decisão do
projeto. Não são criados novos links ou cobranças, mesmo se o servidor ainda
possuir credenciais e a loja tiver um `payee_code` antigo.

## Pagamentos disponíveis

- Dinheiro ou maquininha, na entrega ou retirada.
- Pix direto para a conta do estabelecimento, com confirmação manual pela loja.
- Configuração do Pix em **Configurações → Pix direto para a loja**.

O Pix usa `/api/pix/config` e não depende da Efí. A API rejeita novos pedidos
com `forma_pagamento=efi_checkout`, e as antigas rotas de configuração Efí
retornam HTTP 410. A disponibilidade de checkout é sempre zero nas respostas
mantidas para compatibilidade com versões anteriores do site.

## Pedidos anteriores

O histórico do banco foi preservado. Links de pagamento não são mais expostos
nas respostas de pedidos, e o acompanhamento orienta clientes de pedidos
antigos pendentes a falar com a loja antes de realizar outro pagamento.

A notificação `/api/public/efipay/checkout/notificacao` e a confirmação de
cobranças existentes permanecem apenas para conciliar pagamentos antigos.
Elas conferem a cobrança na Efí antes de atualizar o pedido. Não criam cobranças.
As credenciais existentes e `EFI_ENVIRONMENT` continuam restritos ao servidor
para esse fim. A remoção da interface não cancela links já emitidos na Efí.

As variáveis de comissão e criação de links foram retiradas do deploy.
O modelo comercial anunciado pela DoixP é uma mensalidade fixa, sem comissão
sobre vendas e sem cobrança por pedido.

Uma futura retomada do pagamento online exige uma nova implementação e revisão
do fluxo. Cadastrar credenciais ou um `payee_code` não reativa o checkout.
