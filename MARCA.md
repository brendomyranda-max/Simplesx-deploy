# DoixP

A marca pública é **DoixP** e o domínio principal é **https://doixp.com**.
O ambiente de pedidos para clientes se chama **DoixP Delivery**. Os aplicativos
locais de impressão e NFC se chamam **Servidor DoixP**.

O logotipo oficial está em `public/brand/doixp-logo.png`; os ícones web e o
ícone Android são gerados a partir dele. Use esse arquivo nos novos pontos de
contato da marca, nunca uma letra substituta ou logo anterior.

## Paleta

- Base: preto grafite `#171113` e branco `#FFFEFE`.
- Detalhe de marca: vermelho profundo `#A61F33`.
- Semântica operacional: verde para sucesso, ganho e estoque saudável; vermelho
  para erro, despesa e estoque baixo; amarelo para atenção e itens em preparo.

## Compatibilidade com instalações existentes

Alguns identificadores antigos permanecem somente como contratos técnicos para
não desconectar usuários, perder carrinhos, pareamentos, instalações ou dados:

- Projeto Cloudflare `simplesx-projeto-beta`, banco D1 `simplesx-db` e
  repositório GitHub `Simplesx-deploy` continuam sendo os recursos publicados.
- Cookies, chaves de armazenamento, banco SQLite e variáveis de ambiente antigas
  preservam seus nomes para manter sessões e dados existentes.
- O Android mantém `br.com.simplesx.gestor` e o desktop mantém o `appId`
  anterior para que uma atualização substitua o aplicativo instalado.

Não renomeie esses contratos sem uma migração. Eles não aparecem como marca para
o cliente; a identidade exibida é DoixP.

## Domínio

O aplicativo usa URLs relativas, então `doixp.com` abre o gestor principal assim
que o domínio for associado ao projeto Cloudflare Pages atual. Os novos
Servidores DoixP já usam `https://doixp.com` como endereço padrão. A associação
de DNS e do domínio personalizado é uma configuração externa do provedor e não
é criada apenas por um deploy do código.
