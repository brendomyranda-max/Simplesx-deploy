# Cadastro de clientes do delivery — em breve

O pedido continua disponível sem cadastro. Hoje o checkout pede nome, telefone e endereço apenas para concluir a compra. O acompanhamento usa uma chave aleatória, exclusiva do pedido, no link `/pedido/:loja/acompanhar/:chave`; o último link fica salvo no navegador do cliente. Nenhum CPF é solicitado ou armazenado nesta fase.

Quando o cadastro for ativado, usar um D1 separado do banco de estabelecimentos, com binding próprio para clientes. A conta terá nome, CPF, telefone e endereços. Criar uma API de cadastro e acesso para clientes, com consentimento e mecanismo de autenticação, antes de coletar CPF. Vincular pedidos à conta por identificador interno, mantendo a chave individual para acompanhamento.

Os quatro últimos dígitos do CPF poderão compor um código de confirmação na entrega ou retirada, mas não devem servir como senha ou chave de acesso ao pedido: são previsíveis. A confirmação deve ter controles contra tentativas repetidas e não deve expor o CPF completo à loja ou no link público. A interface exibe “em breve” até o fluxo completo estar ativo.
