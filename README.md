# SimplexS.A — gestão de mercados e restaurantes

Aplicação web com PDV, mesas e comandas, estoque, ficha técnica, validade,
financeiro e impressão por agentes desktop e Android. React e TypeScript no
frontend; API JavaScript compartilhada entre Express/SQLite local e Cloudflare
Pages/D1/KV. Os dados são separados por estabelecimento.

A marca pública é **SimplexS.A**; pacotes e novos arquivos usam **simplexsa**.
Consulte [MARCA.md](./MARCA.md) para a compatibilidade da atualização com as
instalações, os dados e os endereços existentes.

## Executar localmente

Requer Node.js 22.13 ou superior e npm. O SQLite é fornecido pelo próprio Node.

```bash
npm ci
cp .env.example .env
npm run db:migrate:local
npm run server
```

Em outro terminal, execute `npm run dev` e abra `http://localhost:5173`.
O cadastro pelo acesso tem taxa única de R$ 50,00 e está aguardando a configuração
do recebimento. Para preparar um ambiente administrativamente, use a CLI descrita
em **Criar um estabelecimento**. A instalação começa sem usuários, senhas
ou dados de clientes. O `.env.example` contém somente chaves públicas de teste
do Turnstile; em produção, configure suas próprias chaves.

Validação: `npm test`, `npm run build` e `npm --prefix gestor-impressora test`.
Para servir a interface compilada, execute `npm run build` antes de
`npm run server` e acesse `http://localhost:3001`.

## Configuração e credenciais

O servidor e os scripts Node carregam `.env`; variáveis exportadas no ambiente
têm prioridade. O Wrangler usa `.dev.vars` no desenvolvimento. Os arquivos reais
ficam fora do Git; os modelos `.env.example` e `.dev.vars.example` podem ser publicados.

Para configurar o Cloudflare, copie `wrangler.toml.example` para `wrangler.toml`,
informe os IDs do seu D1/KV e use Secrets do Cloudflare para credenciais. Os IDs
identificam recursos e não são senhas; cada instalação mantém sua configuração local.
O projeto Pages e o banco usados nos comandos são `simplesx-projeto-beta` e
`simplesx-db`; se os renomear, ajuste também os comandos de deploy e administração.

Consulte [SEGURANCA.md](./SEGURANCA.md) para a relação de variáveis, assinatura
Android e cuidados ao publicar um repositório que já teve dados no histórico.

Para entender a arquitetura, o fluxo dos dados, a função de cada arquivo e por
que o repositório contém arquivos JSON, consulte [GUIA_DO_PROJETO.md](./GUIA_DO_PROJETO.md).

Para preparar os secrets da integração de pagamentos, consulte
[PAGBANK_CONFIGURACAO.md](./PAGBANK_CONFIGURACAO.md).

O estado atual do cadastro pago e da apresentação de investimento está documentado
em [CADASTRO_E_INVESTIMENTO.md](./CADASTRO_E_INVESTIMENTO.md).

## Criar um estabelecimento

Tokens não podem ser criados pela interface. Defina `SIMPLEXSA_SENHA_DONO` no
`.env` privado (ao menos 8 caracteres), execute o comando e apague a senha do
arquivo em seguida. Não passe senhas nos argumentos do terminal:

```bash
npm run criar-token -- "Nome do estabelecimento" CNPJ usuario_dono
```

O comando cria um ambiente vazio, o usuário dono com acesso total e mostra o
token uma única vez. Cada estabelecimento mantém produtos, usuários, estoque,
vendas, configurações e impressão isolados dos demais.

Para criar diretamente no deploy usado pelos clientes externos:

```bash
npm run criar-token -- "Nome do estabelecimento" CNPJ usuario_dono --remote
```

## Administrar tokens do deploy

```bash
npm run tokens -- listar --remote
npm run tokens -- desativar ID --remote
npm run tokens -- ativar ID --remote
npm run tokens -- renovar ID --remote
npm run tokens -- apagar ID --remote
```

O token completo nunca pode ser listado porque apenas seu hash é armazenado.
Apagar um token encerra as sessões, mas preserva os dados do estabelecimento.
Renovar substitui o token, encerra as sessões e também preserva todos os dados.

## NFC-e multiempresa

O módulo **NFC-e** usa o mesmo isolamento por `estabelecimento_id` dos tokens.
Cada estabelecimento mantém configuração do emitente, série, numeração, regras
tributárias dos produtos, documentos e eventos próprios dentro do D1.

Para testar, selecione o provedor `simulador`, ambiente `homologacao`, complete
os dados do emitente e o cadastro fiscal dos produtos. O documento resultante é
marcado como simulado e não tem validade fiscal. Produção permanece bloqueada
até que um adaptador de provedor e suas credenciais sejam configurados no Worker.

Antes do deploy, aplique a migration fiscal:

```bash
npx wrangler d1 migrations apply simplesx-db --remote
```

Credenciais e certificados não devem ser gravados no D1. O banco armazena apenas
o identificador da empresa no provedor; segredos globais pertencem aos secrets do
Worker/Cloudflare.

## Produtos sem vencimento

No cadastro de produtos simples e insumos, marque **Sem vencimento** para não
exigir uma data de vencimento da embalagem fechada. A fabricação passa a ser
opcional. As entradas de mercadorias respeitam essa opção e registram os lotes
sem gerar alertas de vencimento da embalagem fechada.

O **Vencimento pós-abertura (dias)** continua independente: é obrigatório para
insumos e opcional para produtos simples. Em **Controle de Validade**, procure o
produto, informe a abertura e use **Registrar e gerar etiqueta**. O vencimento
da etiqueta é calculado pelo prazo após abertura, mesmo em produtos sem vencimento.
Lotes e controles já registrados são preservados ao editar o cadastro.

Aplique `0024_produtos_sem_vencimento.sql` antes de publicar o backend:
`npm run db:migrate`. O comando `npm run deploy` já aplica as migrações antes da
publicação. Produtos existentes continuam com a opção desmarcada.

## Pedidos do restaurante

O cardápio permite navegar por categorias e subcategorias, buscar pelo nome e
ver todos os produtos da categoria principal. A tela do restaurante não usa EAN.

Clique em um lançamento para transferi-lo para outra pessoa ou mesa. No
computador, também é possível arrastá-lo para uma pessoa da própria comanda.
A transferência move o lançamento inteiro, incluindo sua quantidade, e preserva
preço, observações e status de preparo, mesmo após envio ou entrega. Ela não
reimprime o pedido nem gera outra movimentação de estoque ou venda.

Uma mesa livre é aberta automaticamente ao receber um lançamento; a mesa de
origem permanece aberta. Contas em pagamento ou fechadas e pessoas já pagas
não aceitam transferências. Alterações simultâneas são verificadas pela versão
do item e cada transferência fica registrada no histórico do banco.

Antes de publicar o backend, aplique `0022_transferencias_pedidos.sql` usando
`npm run db:migrate`. A migração adiciona o histórico, a versão dos itens e a
reserva temporária durante o fechamento, preservando os pedidos existentes.

## Gestor Local v2

Na versão **1.5.13**, as rotas com **Usar a impressora padrão do servidor**
respeitam a seleção feita no Gestor Windows, Linux ou Android. O nome da rota
(por exemplo, Cozinha ou Bar) não substitui o nome da impressora física.
O teste direcionado ao desktop também respeita esse destino quando existe um
Android padrão configurado. Essas correções exigem atualizar o backend.

Os aplicativos 1.5.13 incluem ajustes de descoberta e impressão pelo driver no
desktop e de recepção e transporte no Android. Atualize pelo download da tela
**Impressoras**, preservando o pareamento e as configurações da instalação.

A versão **1.5.9** adiciona proteção para pedidos simultâneos na mesma mesa.
Aplique `0023_pedidos_concorrentes.sql` antes do backend e atualize os Gestores
Windows/Linux/Android. Cada lançamento usa uma chave que permite retomar uma
requisição sem duplicar itens; o lote inteiro é salvo em uma transação.
O garçom vem da sessão autenticada de quem lançou, e aparece na tela e no ticket.
Para identificar quatro garçons, cada um deve entrar com seu próprio usuário.

A reserva por item/impressora, a criação do trabalho e o status de envio são
atômicos. Pedidos para mais de uma rota permanecem pendentes até todas entrarem
na fila; uma nova tentativa completa apenas as rotas faltantes. A tela consulta
a comanda a cada três segundos e mostra fila, processamento e falhas.

Os Gestores guardam em disco o resultado antes de confirmar ao servidor,
renovam a reserva durante a impressão e processam a fila sem sobrepor trabalhos.
Uma confirmação HTTP perdida é repetida sem reimprimir. Após interrupção durante
o envio físico, ou erro da impressora, o trabalho pede conferência: ESC/POS não
permite garantir se o papel saiu antes de uma queda de energia. Não há repetição
automática de bytes em um resultado incerto.

A tela **Impressoras** permite editar e excluir impressoras, modelos de etiqueta
e servidores Android/Windows/Linux. Editar um servidor altera seu nome no painel.
Excluir um servidor remove suas rotas, libera as categorias e cancela os trabalhos
pendentes. O histórico de trabalhos concluídos é preservado.

Servidores ativos não podem ser excluídos, pareados novamente ou vinculados a outro
estabelecimento por outra conexão. Primeiro use **Desconectar** no desktop ou
**Desconectar e trocar de conta** no Android. Sem rede, a sessão expira após 90
segundos sem contato. Uma tentativa recusada não consome o código de pareamento.

Para publicar esta mudança, aplique `0021_sessoes_servidores.sql` e distribua os
Gestores **1.5.8** junto com o backend. O desktop exige `session_id` nas chamadas
de registro, heartbeat, polling, confirmação e desconexão; versões anteriores
precisam ser atualizadas. O Android mantém o contrato de autenticação por token.

O backend possui uma fila segura e idempotente para a evolução do Gestor Local.
O protocolo desktop continua disponível com sessão exclusiva. Instalações Android devem
ser vinculadas por um código temporário criado por um usuário com módulo Gestor;
o código expira em dez minutos e só pode ser usado uma vez. O token devolvido ao
dispositivo é mostrado apenas no pareamento e armazenado no banco somente como hash.

As credenciais administrativas nunca devem ser copiadas para o gestor. Chamadas do
dispositivo usam `Authorization: Bearer <device-token>` e `X-Device-Id` sobre HTTPS.
O token do dispositivo expira em 90 dias e pode ser rotacionado pela rota autenticada
do próprio dispositivo.

Variáveis já usadas pelo projeto:

- `SIMPLEXSA_DB`: caminho do SQLite no servidor local;
- `PORT` e `HOST`: endereço do servidor local;
- `TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY`: proteção do login web.

Em produção, `DB` e `AUTH_KV` continuam sendo bindings do Cloudflare. Nenhum token
de dispositivo ou credencial de pagamento deve ser colocado em variável pública do
Vite, no repositório ou no frontend.
