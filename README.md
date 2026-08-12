# Simplesx-deploy

## Criar um estabelecimento

Tokens não podem ser criados pela interface. No servidor, execute:

```bash
npm run criar-token -- "Nome do estabelecimento" usuario_dono "senha-com-8-ou-mais-caracteres"
```

O comando cria um ambiente vazio, o usuário dono com acesso total e mostra o
token uma única vez. Cada estabelecimento mantém produtos, usuários, estoque,
vendas, configurações e impressão isolados dos demais.

Para criar diretamente no deploy usado pelos clientes externos:

```bash
npm run criar-token -- "Nome do estabelecimento" usuario_dono "senha" --remote
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
