# SimplesX — gestão de mercados e restaurantes

Aplicação web com PDV, mesas e comandas, estoque, ficha técnica, validade,
financeiro e impressão por agentes desktop e Android. React e TypeScript no
frontend; API JavaScript compartilhada entre Express/SQLite local e Cloudflare
Pages/D1/KV. Os dados são separados por estabelecimento.

## Executar localmente

Requer Node.js 22.13 ou superior e npm. O SQLite é fornecido pelo próprio Node.

```bash
npm ci
cp .env.example .env
npm run db:migrate:local
npm run server
```

Em outro terminal, execute `npm run dev` e abra `http://localhost:5173`.
Crie uma conta pela tela de acesso. A instalação começa sem usuários, senhas
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

## Criar um estabelecimento

Tokens não podem ser criados pela interface. Defina `SIMPLESX_SENHA_DONO` no
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

- `SIMPLESX_DB`: caminho do SQLite no servidor local;
- `PORT` e `HOST`: endereço do servidor local;
- `TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY`: proteção do login web.

Em produção, `DB` e `AUTH_KV` continuam sendo bindings do Cloudflare. Nenhum token
de dispositivo ou credencial de pagamento deve ser colocado em variável pública do
Vite, no repositório ou no frontend.
