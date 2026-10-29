# Contas de clientes e tipografia de impressão

No marketplace e na página da loja, **Entrar / cadastrar** abre a conta do comprador.
O cadastro usa nome, telefone com DDD e senha de 8 a 128 caracteres. O endereço,
número, complemento e ponto no mapa podem ser informados no cadastro ou no checkout.
**Minha conta** permite editar o nome/endereço e consultar os últimos 50 pedidos
feitos com a conta. A sessão dura até 30 dias; novos logins recuperam o perfil do banco.
O telefone identifica o login e fica fixo no perfil. O WhatsApp de um pedido pode
ser alterado no checkout sem alterar o telefone de acesso.

No checkout, **Salvar nome e endereço na minha conta** atualiza o perfil para a
próxima compra. Retirada preserva o endereço de entrega salvo. Compras sem conta
continuam disponíveis. Pedidos anteriores sem conta não são associados por telefone.
As contas de compradores não dão acesso ao painel dos lojistas.

## Banco e publicação

A migration `0055_clientes_marketplace.sql` cria as contas/sessões e associa os
novos pedidos ao cliente autenticado. O SQLite local aplica migrations ao iniciar;
reinicie o servidor local após atualizar o código. No Cloudflare, aplique a migration
com `npm run db:migrate` antes de publicar o site. `npm run deploy` já realiza as
etapas de compilação, migration e publicação. Os testes usam bancos temporários.

## Impressoras

Atualize o aplicativo **Servidor DoixP** no computador ou Android que recebe os
pedidos. Na configuração de cada impressora, escolha:

- Tamanho em pixels: de **6 a 96 px**, inclusive frações, como **12,5 px**.
- Modelo da fonte e **negrito**. Monoespaçada preserva o alinhamento dos cupons.
- Largura imprimível e DPI reais do autoteste, além da largura física do papel.

A prévia mostra a aparência da fonte; **salve** os ajustes antes de imprimir o
teste. As configurações são individuais por impressora e valem para testes,
pedidos, contas e etiquetas. Os ajustes antigos continuam funcionando até salvar
os novos controles. Fontes com nome usam a alternativa disponível no sistema
quando não estão instaladas; no Android, Arial/Verdana usam sans-serif e
Courier New/Consolas usam monospace.

O tamanho usa pixels de 96 DPI convertidos ao DPI físico da cabeça. O desenho é
enviado como bitmap usando o protocolo ativo: ESC/POS/ESC-Bema (`GS v 0`), Diebold
IM453H (`ESC n`), Star Line (`ESC k`), TSPL (`BITMAP`), ZPL (`^GF`), CPCL (`CG`)
e EPL2 (`GW`). No desktop, o modo Driver envia o mesmo desenho ao driver do sistema.
Em etiquetas de altura fixa, textos longos continuam em novas etiquetas; o tamanho
escolhido não é reduzido automaticamente. O padrão de largura útil é 48 mm em
bobina 58 e 72 mm em bobina 80. Equipamentos com outra largura útil devem ser ajustados.

Os protocolos e transportes precisam corresponder ao autoteste do equipamento.
Os testes automatizados verificam bytes, renderização e persistência; a homologação
física de cada impressora continua dependendo de teste no equipamento.
Consulte também [Compatibilidade de impressoras](IMPRESSORAS_COMPATIBILIDADE.md).

## Revisão da estação em 29/10/2026

A consulta ao CUPS encontrou DieboldIM453H, Jieli58 e LABEL_9X20 habilitadas e
ociosas. Diebold80 e DieboldRAW estavam pausadas e apontam para a mesma conexão
USB da DieboldIM453H. HaoYin58 e HaoYinRAW estavam desabilitadas com o motivo
“Unplugged or turned off”. Ajustes de fonte não reconectam equipamentos nem
habilitam filas pausadas.

A configuração existente do servidor seleciona LABEL_9X20 como padrão, com
TSPL/203 DPI/largura 50 mm; a DieboldIM453H usa DIEBOLD/203 DPI/largura 58 mm.
Confira a largura física e a largura imprimível no autoteste antes de alterá-las.
O padrão do CUPS é DieboldIM453H, diferente do padrão escolhido no servidor;
as rotas devem apontar explicitamente para a impressora desejada. A revisão não
enviou trabalhos de impressão nem modificou as filas ou a configuração instalada.
