# DoixP Entregas

Operação de motoboys separada do DoixP Delivery: cadastro e turno dos
entregadores, ofertas regionais, confirmações, ocorrências e registro dos
repasses semanais. O estabelecimento usa a tela **DoixP Delivery** no sistema
de vendas. O serviço de entregas usa banco SQLite e sessões próprios.

O aplicativo instalável para Android está em [android/](./android/README.md),
somente para entregadores, com localização nativa, notificações de ofertas e
geração de APK/AAB. O suporte administra contas pelo navegador. As orientações
de publicação estão em [Google Play](./android/GOOGLE_PLAY.md).

## Executar

Requer Node.js 22.13 ou superior. No repositório atual, as dependências já são
resolvidas pelo `node_modules` da pasta principal:

```bash
npm --prefix entregas start
```

Abra **http://localhost:3100**. No primeiro acesso, crie a conta do suporte.
Não existem senhas padrão ou pedidos fictícios. O suporte cadastra o vínculo
da loja com o ID numérico do estabelecimento no DoixP Delivery. O entregador
se cadastra em `/driver`; o suporte precisa aprovar a conta antes que ela possa
ficar online ou receber ofertas.

Para explorar os três perfis sem cadastrar uma conta na operação real, inicie
uma **demonstração isolada** em outro terminal:

```bash
npm --prefix entregas run demo
```

Abra **http://127.0.0.1:3101**. O terminal mostra uma senha temporária para
`suporte.demo`, `loja.demo` e `entregador.demo`. A demonstração inclui duas
entregas fictícias e usa um banco em memória: seus dados são apagados ao encerrar
o processo. Ela atende somente na máquina local e não altera o banco da operação.

Para usar esta pasta como projeto separado:

```bash
cd entregas
npm install
npm start
```

O banco é criado em `entregas/data/entregas.sqlite`. Não se conecta ao banco do
sistema de vendas e não aplica migrações nele. `ENTREGAS_DB`, `ENTREGAS_PORT`
e `ENTREGAS_HOST` permitem definir banco, porta e endereço de escuta.
`ENTREGAS_RAIO_OFERTAS_KM` define o raio das ofertas em linha reta a partir
da loja; o padrão é 10 km. O servidor confere o raio ao listar e ao aceitar.
O padrão atende somente na máquina local. Faça o cadastro inicial localmente
antes de disponibilizar o servidor em rede. Para celulares, publique atrás de
HTTPS e configure `ENTREGAS_HTTPS=1`, que ativa cookies seguros. A localização
do navegador requer permissão e contexto seguro (HTTPS ou localhost).

## Frete

- R$ 10,00 por percurso de até 5 km; distância obrigatória maior que zero.
- Adicional inicial de **R$ 2,00 por km**, uma configuração provisória alterável
  pelo suporte. Não é uma tarifa comercial aprovada pelo usuário.
- Excedente proporcional à fração de km, arredondado para o centavo mais próximo.
- Valor, distância e parcelas ficam gravados no pedido. Alterações na tarifa
  só afetam novos pedidos.

| Modalidade | Estabelecimento paga | Cliente paga |
| --- | --- | --- |
| Integral (`full`) | Todo o frete | R$ 0 |
| Tarifa inicial (`base`) | R$ 10 | Excedente de 5 km |
| Metade da tarifa inicial (`half`) | R$ 5 | R$ 5 + excedente |

Exemplo com 7 km e R$ 2/km adicional: total R$ 14. As divisões são R$ 14/R$ 0,
R$ 10/R$ 4 e R$ 5/R$ 9, respectivamente. O valor integral é a remuneração
prevista do entregador; comissão da plataforma ainda não foi definida.

No checkout integrado, o cliente vê sua parcela e a da loja antes de confirmar
o pedido. Na modalidade atual, a loja paga R$ 10 da tarifa inicial e o cliente
paga o excedente. A loja confirma manualmente o recebimento do Pix antes de o
pedido ser anunciado. O Pix cai na chave da loja e o sistema registra o valor
devido ao entregador para repasse externo. Não há split nem dinheiro reservado
em um provedor nesta etapa.

## Integração com o DoixP Delivery

O suporte vincula a conta técnica da loja ao seu ID numérico no delivery ao
cadastrá-la. A loja não precisa entrar no serviço de motoboys. Configure o mesmo
`ENTREGAS_INTEGRATION_SECRET` aleatório, com pelo menos 32 caracteres, em ambos
os servidores. No ambiente do DoixP Delivery, configure também:

| Variável | Valor |
| --- | --- |
| `ENTREGAS_API_URL` | Origem HTTPS pública do servidor Node de entregas, sem caminho |
| `ENTREGAS_INTEGRATION_SECRET` | Segredo idêntico ao do servidor de entregas |
| `ENTREGAS_PIX_DESTINO` | `loja` para permitir o Pix na chave cadastrada pelo estabelecimento |

O estabelecimento configura chave Pix e coordenadas na loja online e ativa
**Motoboy da plataforma**. O cliente escolhe essa opção, informa os quatro
últimos dígitos do CPF e paga o Pix. A corrida nasce após a loja marcar
**Pix recebido**. Se o servidor de entregas estiver indisponível, a loja vê
**Tentar chamar motoboy** no DoixP Delivery. A referência estável evita duas
corridas para o mesmo pedido. A loja marca o produto pronto e digita o código
de seis dígitos informado pelo entregador para confirmar a retirada. O app do
entregador confirma a entrega com os quatro dígitos informados pelo cliente.

O servidor de vendas chama `POST /api/integration/orders` com
`paymentMode: "pix_confirmed_manually"`, referência de pedido estável, dados
necessários à entrega e a divisão do frete aceita no checkout. Uma futura
integração com provedor pode usar `paymentMode: "provider_captured"` e
`fundedDriverCents` correspondente ao frete total, depois de confirmar a
captura no próprio provedor. Isso ainda não implementa Pagar.me nem repasse
automático.

Envie `x-doixp-timestamp` com os milissegundos Unix atuais e
`x-doixp-signature` com o HMAC-SHA256 hexadecimal de
`<timestamp>.<corpo JSON exato>` usando o segredo. Assinaturas com mais de
cinco minutos são recusadas. `reference` e `paymentReference` evitam corridas
duplicadas. A integração assina também consultas e ações da loja. O segredo
nunca vai para o navegador ou para o APK. O Pix é conferido manualmente pela
loja; o sistema não consulta o banco para verificar sua liquidação.

## Operação

1. O suporte configura a loja e aprova os entregadores cadastrados no app.
2. O comprador informa endereço e os quatro últimos dígitos do CPF no checkout
   do delivery, preservando zeros à esquerda. A loja confirma o Pix recebido.
3. O entregador permite localização, fica online e recebe ofertas na tela.
   Apenas um entregador aceita cada corrida e cada entregador mantém uma corrida
   ativa. Uma localização com mais de dois minutos impede novos aceites.
4. A loja marca o pedido como pronto no DoixP Delivery. O motorista recebe um
   código aleatório de seis números, informa à loja, e ela confirma a retirada.
5. Após a retirada, o motorista vê nome, telefone e endereço completo do cliente.
   Antes disso, vê a coleta, valor, distância e região aproximada do destino.
6. No destino, o cliente informa os últimos quatro dígitos do CPF. O motorista
   digita o código para concluir. Cinco erros abrem ocorrência e bloqueiam novas
   tentativas até análise.

O CPF completo não é coletado nesta plataforma. O checkout coleta apenas os
quatro dígitos, que ficam cifrados no DoixP Delivery até o anúncio da corrida;
o serviço de entregas os armazena com salt e scrypt. O código não é devolvido
em respostas da API. Essa confirmação operacional não prova identidade nem
localização física.

## Ocorrências e suspensão

Cliente ausente exige registrar tentativa de contato com ele e, em seguida, com
o estabelecimento. A ocorrência preserva a corrida, os registros e o responsável.
Cancelamento solicitado depois da retirada também segue para o suporte.

Uma denúncia de fraude feita pela loja gera suspensão preventiva do entregador
e análise. A denúncia não é tratada como fraude comprovada. A suspensão bloqueia
novos aceites, retirada e conclusão, preservando o acesso à corrida e ao registro
de contatos. Somente o suporte pode revisar a suspensão, com justificativa.

O suporte resolve a ocorrência retomando a entrega, registrando devolução ou
cancelando. Em devolução/cancelamento após retirada, precisa decidir explicitamente
a compensação do entregador, entre zero e o valor do frete. A decisão fica no
histórico. Retomar uma ocorrência não remove automaticamente a suspensão.

## Fechamento semanal

O suporte escolhe a segunda-feira inicial de uma semana já encerrada, no fuso
`America/Sao_Paulo`. O fechamento agrupa por entregador as entregas concluídas e
compensações aprovadas no período, sem duplicar corridas. Valores sob disputa
ficam retidos. Depois da resolução, fechar novamente a semana correspondente
inclui valores liberados em um fechamento complementar.

O fechamento cria registros pendentes de pagamento. Depois de pagar por um meio
externo, o suporte registra a referência ou comprovante e marca o fechamento como
pago. Não ocorre transferência bancária pela aplicação. Ocorrências abertas após
um fechamento bloqueiam o registro de seu pagamento enquanto houver retenção;
um pagamento já registrado exige acerto externo se houver contestação posterior.

## Mapa e limites desta versão

O mapa mostra posições informadas no cadastro e a localização enviada pelo
aplicativo Android ou navegador. Usa [Leaflet](https://leafletjs.com/examples/quick-start/) e mapas do
[OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/), carregados
pela internet, com atribuição visível. Sem esses serviços, as listas e os controles
continuam disponíveis.

A **distância do checkout integrado é estimada em linha reta** a partir das
coordenadas da loja e do endereço localizado; pedidos manuais recebem distância
informada pela loja. Não há roteirização automática nem navegação curva a curva.
Antes de uma operação pública, configure um provedor de rotas para calcular a
distância rodoviária e um serviço de mapas adequado ao volume. O deslocamento
do entregador até a coleta não entra no cálculo atual.

Atualização da fila ocorre por consulta periódica. No Android, um serviço de
localização iniciado pelo entregador acompanha o turno online, inclusive com o
app minimizado, e emite notificações locais de ofertas. No navegador, a atualização
depende da página em execução. Ainda não há notificações remotas por FCM,
verificação documental dos entregadores ou envio automático de mensagens.
Os contatos são realizados
fora da plataforma e registrados manualmente. A prevenção de fraude implementa
bloqueios, permissões e auditoria; não comprova que o contato ou deslocamento
declarados realmente ocorreram.

## Privacidade e solicitações de exclusão

Todos os perfis acessam **Minha conta**, com política e solicitação de exclusão.
As páginas públicas `/privacy.html` e `/account-deletion.html` também permitem
consultar o procedimento e fazer a solicitação sem instalar o app. O suporte
acompanha os protocolos em **Solicitações de exclusão**. Solicitar não apaga nem
desativa automaticamente a conta; o tratamento e a exclusão são realizados pelo
responsável pela operação.

Configure `ENTREGAS_OPERATOR_NAME` e `ENTREGAS_PRIVACY_CONTACT` no servidor.
Antes do lançamento público, conclua a identificação, os fornecedores utilizados,
os prazos de retenção e o procedimento real de exclusão. A política atual descreve
o comportamento implementado e sinaliza essas pendências.

## Próximos passos para split

As rotas estão documentadas em [API.md](./API.md). A ponte atual já cria corridas
com referência estável e consulta o andamento, mas não transfere dinheiro. Para
usar Pagar.me depois, será necessário cadastrar os recebedores, criar a cobrança
com divisão e conferir a confirmação do provedor no backend antes de anunciar a
corrida. O fechamento semanal atual registra obrigações de repasse e comprovantes
de pagamentos externos; ele não dispara transferências.

## Verificar

```bash
npm --prefix entregas test
```

Os testes usam bancos isolados e verificam rateio, autorização do comprador,
privacidade, códigos, concorrência de aceites, ocorrências, autenticação,
isolamento por estabelecimento, limites da semana e duplicidade de pagamentos.
Os testes HTTP abrem portas temporárias somente em localhost.
