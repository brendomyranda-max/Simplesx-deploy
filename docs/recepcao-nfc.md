# Recepção e comandas individuais por NFC

Na área **Vendas**, abra **Recepção** (também disponível nas abas do restaurante).

1. Clique em **Cadastrar ou consultar cartão** e aproxime o cartão no leitor identificado na tela.
2. Informe o **nome do cliente**, selecione a **mesa do salão** e clique em **Salvar atendimento**.
3. Use **Lançar para cartão** para montar o pedido e aproximar o cartão, ou **Ver / lançar pedidos** na Recepção.
4. Os pedidos ficam na conta dessa pessoa, na mesa escolhida. A cozinha recebe mesa, cliente e cartão.
5. Na saída, use **Fechar comanda** na Recepção, confira o total, selecione o pagamento e confirme após receber. Somente a conta desse cliente é encerrada; os outros clientes permanecem na mesa.

O cartão é apenas a identificação: não precisa gravar o nome ou a mesa nele. O vínculo fica salvo no sistema até encerrar a conta. Depois, o mesmo cartão pode ser cadastrado para outro cliente e outra mesa. Um cartão em atendimento não pode ser reatribuído.

Um atendimento sem consumo pode ser encerrado sem gerar venda. O pré-fechamento da mesa mantém os cartões vinculados; o fechamento ou cancelamento total libera todos os cartões daquela conta. Para pagar pessoas com cartão separadamente, use a Recepção.

Cartões usados antes desta função podem ter contas antigas na aba Mesas. Essas contas continuam acessíveis e precisam ser encerradas antes de cadastrar o cartão no novo fluxo. O saldo antigo não é transferido automaticamente.

A leitura usa o mesmo sistema NFC já configurado: no Chrome Android compatível pode acontecer diretamente na web; os leitores dos servidores continuam disponíveis pela seleção automática.

## Instalação local

O backend exige a migração `0041_recepcao_cartoes.sql`. O servidor Node aplica as migrações ao iniciar; no Cloudflare, execute `npx wrangler d1 migrations apply simplesx-db --remote` antes de publicar o frontend e as funções.
