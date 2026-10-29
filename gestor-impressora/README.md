# Servidor DoixP

Aplicativo local que conecta a DoixP às impressoras e aos leitores de cartões NFC
no Windows ou no Linux.

A versão 1.5.15 usa a **LogoDoixPAmarelo** no cabeçalho, na bandeja e nos ícones
do aplicativo e do instalador.

A versão **1.5.20** usa **Atualização do servidor → Atualizar servidor**.
Um clique busca, baixa e inicia a instalação, inclusive quando o atualizador
informa a conclusão do download depois de retornar à tela. As impressões já
recebidas terminam antes do reinício. O token, as impressoras e o diário ficam
no mesmo diretório, preservando a configuração e evitando reimpressões.
No Linux, execute o AppImage em uma pasta na qual seu usuário possa gravar.
Para receber o botão pela primeira vez, execute o instalador Windows por cima da
versão anterior ou substitua o AppImage, sem apagar as configurações.

Se uma versão antiga apenas baixar e não instalar, execute o instalador oficial
por cima da instalação existente uma vez para receber o fluxo corrigido.

O empacotamento gera `latest.yml`/`latest-linux.yml` e seus checksums para o feed
`https://doixp.com/atualizacoes/`. O workflow publica esses arquivos junto dos
instaladores; o site só deve apontar para a nova release depois de publicada.

## Fonte em pixels, modelo e negrito (1.5.25)

Selecione a impressora e abra **Configurar**. Informe o tamanho em pixels, de
**6 a 96 px**, inclusive frações, escolha o modelo da fonte e marque **Negrito**
quando desejar. A prévia mostra a aparência; salve antes de imprimir o teste.
Configure também o DPI real e a largura imprimível indicados no autoteste.

Os ajustes valem para pedidos, contas, etiquetas e testes, individualmente por
impressora. O desenho preserva acentos e usa os comandos gráficos da emulação
selecionada ou o driver do sistema. Em altura fixa, o texto continua na próxima
etiqueta sem reduzir a fonte. Fontes não instaladas usam uma alternativa do sistema.
As preferências antigas são preservadas até salvar os novos controles.

Consulte [Contas de clientes e tipografia](../docs/CLIENTES_E_TIPOGRAFIA.md).

## Histórico: fonte por impressora (1.5.21)

Selecione a impressora e abra **Configurar → Tamanho da fonte**. Escolha
**Pequena**, **Normal** ou **Grande** e salve. A preferência fica gravada para
essa fila e vale para pedidos, contas, etiquetas e testes. Impressoras sem
preferência mantêm Normal. As quebras de linha e a altura automática acompanham
a fonte; com altura fixa, o texto é reduzido somente quando precisa caber.
No driver, os tamanhos iniciais são 7,5, 10 e 20 pontos. Em impressoras térmicas,
o tamanho usa os comandos de fonte suportados pelo protocolo.

Referências: [Epson ESC M](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/esc_cm.html),
[Epson GS !](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/gs_exclamation.html),
[TSC TSPL/TSPL2](https://fs.tscprinters.com/system/files/31-0000001-00_tspl_tspl2_programming_3_0.pdf).

## Diebold IM453H e calibração de cupons (1.5.22)

Em **Configurar → Protocolo**, escolha **Diebold IM453H (Padrão / Padrão II)**
quando essa tabela estiver indicada no autoteste. Se o equipamento estiver em
emulação ESC/POS, mantenha **ESC/POS**. O nome da fila não determina a emulação:
a atualização preserva o protocolo selecionado e não altera o firmware.

A IM453H nativa usa comandos diferentes de ESC/POS: `ESC M` restaura o modo
normal sem parâmetro, `SI` seleciona condensado e `SO` expande. O modo Grande
reaplica `SO` por linha e ativa altura dupla; o corte usa `GUIL` (`11h`). Isso
evita interpretar o parâmetro `11h` de `GS !` como corte no protocolo nativo.

Informe a largura real da bobina e, se necessário, **Caracteres por linha na
fonte Normal** conforme o CPP do autoteste (por exemplo, 48). A fonte Grande
usa metade desse limite. Na Diebold, a pequena mantém uma quebra conservadora,
pois o condensado varia com o CPP do firmware. O campo vazio usa cálculo
automático; esse ajuste fica salvo por impressora e também funciona em ESC/POS.
Cupons de texto têm comprimento automático: DPI e altura fixa não alteram a fonte.

Referência: [Manual do firmware IM453H, seções 3.1 e 3.3](https://www.bztech.com.br/arquivos/manual-firmware-diebold-im453hu.pdf).
Comandos e transporte são testados automaticamente; confirme o resultado físico
com **Testar impressão** após selecionar a tabela correspondente à impressora.

## Desenvolvimento

```bash
npm install
npm start
```

O servidor gera um token na primeira execução. Copie-o para **Impressoras → Servidores Windows/Linux** no sistema web. O aplicativo registra-se no deploy, consulta trabalhos a cada três segundos, imprime silenciosamente e confirma o resultado ao servidor.

## Cartões NFC

Na versão 1.5.14, abra **Cartões NFC** no Servidor DoixP, marque **Ativar leitura
de cartões NFC neste computador**, configure o prefixo do leitor USB e clique em
**Salvar e conectar**. O leitor deve enviar o prefixo (por padrão, `NFC:`), o
código do cartão e Enter. Cada computador salva sua própria configuração.

Na DoixP, abra **Mesas → Lançar para cartão**, monte o pedido e aproxime o cartão
físico para registrar os itens na comanda. O leitor pode enviar a leitura com a
janela do Servidor DoixP em foco ou com o sistema web em foco no mesmo computador.
Use **Testar leitura NFC** para verificar a comunicação com o deploy; esse botão
envia uma leitura simulada, sem testar o leitor físico.

A partir da versão 1.5.8, cada execução usa uma sessão exclusiva. Outro computador
com o mesmo token só consegue conectar após a sessão atual desconectar ou ficar
90 segundos sem contato. Use **Desconectar** para liberar o servidor; os trabalhos
já recebidos terminam antes da liberação. **Salvar e conectar** retoma a recepção.
Fechar pela bandeja também libera a sessão; fechar apenas a janela mantém o gestor
funcionando em segundo plano.

Para trocar de estabelecimento, desconecte, cole o token na outra conta e salve;
depois conecte o aplicativo novamente. Você também pode excluir o cadastro antigo
na tela Impressoras. A exclusão remove as rotas e destinos associados. Ao reutilizar
um cadastro excluído, conecte o aplicativo e vincule o token na nova conta.

No Linux, as impressoras devem estar cadastradas no CUPS. No Windows, devem estar instaladas em **Impressoras e scanners**.

A versão 1.5.11 consulta as filas diretamente no CUPS (Linux) e no spooler via
PowerShell (Windows), além da lista do Electron. Filas pausadas ou offline
continuam visíveis com seu estado. **Buscar impressoras** renova a consulta;
a sincronização usa um cache de 15 segundos. Uma impressora salva que desapareceu
permanece selecionada e gera um diagnóstico, evitando enviar para outra fila.
No Windows, confira se o serviço **Spooler de Impressão** está em execução.
No Linux, o cliente CUPS precisa fornecer os comandos `lpstat` e `lp`.
Os scripts PowerShell de descoberta e impressão são distribuídos fora do arquivo
ASAR, para que o Windows também consiga executá-los no aplicativo instalado.

A versão 1.5.12 usa o driver do Windows também quando a altura fica automática;
falhas do PowerShell interrompem o envio e aparecem no resultado do trabalho.
No Linux, `lpoptions` identifica filas RAW mesmo sem esse sufixo no nome. Para
filas RAW sem protocolo salvo, o padrão é ESC/POS; impressoras de etiquetas
precisam ter sua linguagem escolhida em **Configurar**. Uma escolha salva tem
prioridade sobre a detecção. A largura enviada pelo sistema web é usada quando
a impressora ainda não possui largura salva. O último trabalho exibe seu erro.

Selecione a impressora e use **⚙ Configurar** para escolher o protocolo Driver,
ESC/POS, TSPL/TSPL2, ZPL, CPCL ou EPL/EPL2 e a largura do papel. A altura é
opcional: vazia mantém o comprimento automático; preenchida mantém a fonte
normal se o conteúdo couber e a reduz somente quando necessário. Use **Driver**
para filas comuns do Windows/Linux e a linguagem indicada no autoteste para filas
RAW. Configure também a resolução indicada pela impressora (normalmente 203, 300
ou 600 DPI). As escolhas são salvas individualmente para cada impressora.

Os trabalhos são serializados por impressora: servidor, botão de teste e API
local podem enviar ao mesmo tempo sem sobrepor documentos no spooler. Em papel
contínuo, TSPL usa `GAP 0`; EPL usa gap zero; ZPL e CPCL calculam o comprimento
de cada trabalho pelo conteúdo.

Se o Linux mostrar `CUPS indisponível`, inicie o serviço antes de atualizar a
lista de impressoras (normalmente `sudo systemctl enable --now cups`). O endereço
de produção precisa usar HTTPS; HTTP é aceito somente para testes em localhost.
