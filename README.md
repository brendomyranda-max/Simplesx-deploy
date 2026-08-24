# Simplesx-deploy

## Criar um estabelecimento

Tokens não podem ser criados pela interface. No servidor, execute:

```bash
npm run criar-token -- "Nome do estabelecimento" CNPJ usuario_dono "senha-com-8-ou-mais-caracteres"
```

O comando cria um ambiente vazio, o usuário dono com acesso total e mostra o
token uma única vez. Cada estabelecimento mantém produtos, usuários, estoque,
vendas, configurações e impressão isolados dos demais.

Para criar diretamente no deploy usado pelos clientes externos:

```bash
npm run criar-token -- "Nome do estabelecimento" CNPJ usuario_dono "senha" --remote
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

## Gestor Local v2

O backend possui uma fila segura e idempotente para a evolução do Gestor Local.
O gestor legado continua disponível durante a transição. Novas instalações devem
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
