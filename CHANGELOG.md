# Histórico de versões do DoixP

## 0.1.0-beta.4 — Correções de navegação e cadastro

- Menu lateral fecha ao escolher uma tela, inclusive no primeiro acesso a telas carregadas sob demanda. O carregamento fica na área de conteúdo, preservando o menu e o cabeçalho.
- Busca e abas de estoque ignoram respostas antigas; a configuração da empresa é consultada uma vez por abertura da página.
- Remoção de pessoas valida a comanda, preserva pedidos na conta geral e atualiza a contagem na mesma transação, protegendo contas em fechamento e cartões em atendimento.
- Produtos compostos aceitam produtos simples, insumos e outros compostos na ficha técnica. Acréscimos exibem também itens sem preço de venda, com valor configurável no formulário.
- Acréscimos podem usar o próprio produto. Os itens escolhidos ficam registrados no pedido e entram no custo e na baixa de estoque, inclusive no delivery e em pagamentos individuais.

## 0.1.0-beta.3 — Otimização do atendimento

- Telas carregadas conforme o acesso e arquivos com hash reutilizados pelo navegador, reduzindo o download inicial.
- Abertura de mesas com muitas pessoas em uma transação: a gravação das pessoas usa um único comando, mantendo as contas individuais, nomes e cores.
- Comandas e pagamentos consultam uma revisão leve quando não houve mudança. Itens, pessoas, transferências, pagamentos, cartões e impressão invalidam essa revisão automaticamente.
- Leitura completa da comanda em um lote consistente; índices para os acessos frequentes por estabelecimento e comanda.
- Remoção da consulta duplicada do cardápio e compartilhamento de leituras simultâneas, sem manter preços, estoque ou permissões em cache.
- Atualizações em segundo plano pausam quando a tela está oculta; a ponte NFC reduz consultas sem espera de cartão e retoma a frequência normal durante o atendimento.
- Testes com seis sessões autenticadas na mesa 2, 20 pessoas, 36 itens, reenvios e impressão; falhas de gravação revertem toda a abertura.

## 0.1.0-beta.2 — Pré-lançamento

- Pagamento online Efí e split retirados das novas compras; Pix direto à loja com configuração própria e confirmação manual. Histórico preservado.
- Apresentação da DoixP com a história do fundador, recursos da plataforma e proposta da DoixP Entregas em desenvolvimento.
- Modelo comercial de mensalidade fixa, sem comissão sobre vendas; retirada da antiga taxa de abertura da apresentação do cadastro.
- Vitrine `/pedido` com busca de restaurantes próximos por endereço ou localização, categorias de produtos e destaque para promoções.
- Links de lojas baseados no nome, com redirecionamento dos links anteriores quando o estabelecimento muda de nome.
- Opção de publicar somente o cardápio online, sem receber pedidos, e preços promocionais configuráveis por produto.
- Sacola acessível também fora da loja e atalho para acompanhar o último pedido neste navegador. O pedido pode ser acompanhado pelo link individual conforme muda de etapa.
- Suporte por WhatsApp do estabelecimento e do DoixP. Cadastro do cliente e código de confirmação pelo CPF continuam sinalizados como **Em breve**.
- Filtros de delivery para pedidos a entregar e já entregues. A impressão do pedido usa a mesma rota do servidor de impressão das comandas; quando não há impressora vinculada, o pedido permanece disponível na aba Delivery.
- Migrações de banco para o modo cardápio, links anteriores, preços promocionais e suporte; migração de links existentes no deploy.

## 0.1.0-beta.1 — Pré-lançamento

Primeira versão identificada de pré-lançamento da aplicação DoixP.

- Identificação da versão no acesso, menu e configurações.
- Vendas, estoque, atendimento de mesas e comandas individuais com cartões NFC.
- Recepção para associar cartões ao cliente e à mesa, com impressão da conta e ajuste da taxa de serviço.
- Acompanhamento de preparo por categoria e subcategoria, incluindo Bar e Cozinha.
- Integração com o Servidor DoixP para impressoras e leitores NFC.
- Notas fiscais sinalizadas como **Em breve**, com emissão desativada.
- Cadastro com pagamento único de **R$ 150,00**, ainda indisponível.

O Servidor DoixP para Windows, Linux e Android mantém versionamento independente;
a versão compatível publicada é **1.5.22**.
