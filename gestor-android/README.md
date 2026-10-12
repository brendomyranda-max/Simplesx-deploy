# Servidor DoixP para Android

Aplicativo Android que recebe trabalhos da fila segura da DoixP e imprime em
impressoras térmicas ESC/POS e impressoras de etiquetas TSPL/TSPL2, ZPL, CPCL
e EPL/EPL2 por:

- rede TCP/IP (porta `9100` por padrão);
- Bluetooth clássico SPP/RFCOMM;
- USB Host/OTG com envio direto à interface da impressora.

A versão 1.5.14 inclui a logo DoixP no cabeçalho e no ícone do aplicativo. A
seção **Cartões NFC** fica logo após a conexão com a DoixP.
A versão 1.5.15 usa a variante **LogoDoixPAmarelo** no cabeçalho e no ícone.
A versão 1.5.16 identifica cartões somente pelo UID, retoma o leitor ao voltar
das configurações do Android e inclui diagnóstico de leitura, conexão e entrega
ao sistema web. O texto gravado no cartão não é aberto pelo leitor nesse modo.
A versão 1.5.17 entrega o UID diretamente à tela interna, pela sessão web logada,
e corrige o início e a indicação do serviço em segundo plano.
A versão 1.5.18 inclui um leitor acionado pelo Chrome/PWA ou pela tela interna:
**Aguardar cartão → Ler cartão neste celular**. A identificação volta à espera
que iniciou a leitura, sem exigir pareamento de impressora.

## Requisitos

- Android 8.0 ou superior;
- Android Studio com JDK 17 e Android SDK 35;
- impressora compatível de rede, USB ou Bluetooth clássico (não apenas BLE).
- para USB no Android, adaptador OTG e aparelho com suporte a USB Host.

## Compilar

A versão 1.5.12 limita a espera por conexão e escrita na rede/Bluetooth e
serializa os envios do botão de teste e do serviço. As alternativas de conexão
Bluetooth são tentadas somente antes de transmitir: uma falha durante o envio
exige conferir o papel, sem repetir automaticamente o documento. Uma rota
inexistente é informada como falha, em vez de usar outra impressora.

Abra a pasta `gestor-android` no Android Studio, aguarde a sincronização do
Gradle e use **Build → Build APK(s)**. O APK de desenvolvimento será criado em
`app/build/outputs/apk/debug/app-debug.apk`.

## Configurar

1. Na DoixP, abra **Impressoras → Servidor Android** e gere o pareamento.
2. Digite no aplicativo o ID e o código exibidos (expiram em dez minutos).
3. Escolha o protocolo indicado no autoteste: **ESC/POS**, **TSPL**, **ZPL**,
   **CPCL** ou **EPL**.
4. Configure o DPI indicado no autoteste ou na etiqueta da impressora. Os valores
   mais comuns são **203**, **300** e **600 DPI**.
5. Escolha **Rede** e informe IP/porta, ou pareie a impressora nas configurações
   do Android e escolha **Bluetooth**.
6. Toque em **Salvar rota e imprimir teste**.
7. Ative **Receber impressões** e permita notificações/Bluetooth.

Para usar cartões físicos como comandas, ative **Cartões NFC** no próprio
Servidor DoixP. A preferência é salva imediatamente neste aparelho; se o NFC do
Android estiver desligado, ligue-o também nas configurações do aparelho.
Mantenha o Servidor DoixP aberto para ler o cartão. No sistema web, monte o
pedido em **Mesas → Lançar para cartão → Aguardar cartão** antes de aproximá-lo.
Para enviar a leitura a outro aparelho, o servidor precisa estar pareado e
conectado à internet. A fila normal só é consumida por uma ação aguardando cartão.

Cartões **NTAG215** funcionam vazios: o aplicativo já envia o UID físico de
7 bytes, e o sistema atualizado usa esse serial para identificar a comanda.
Não é necessário gravar pedidos nem formatar o cartão. Após pagar e encerrar
a comanda, o cartão pode ser reutilizado para outro atendimento.

Para usar o mesmo celular, toque em **Abrir DoixP e usar cartões NFC**. Entre na
conta do estabelecimento e monte o pedido em **Mesas** dentro dessa tela. O leitor
e a interface web permanecem na mesma Activity, permitindo aproximar o cartão sem
trocar de aplicativo. O botão liga o leitor e desliga o modo de teste. O topo
mostra o estado NFC e a última identificação enviada; **Servidor** volta aos ajustes.
Na versão 1.5.17, o UID chega à tela interna sem passar pela fila de outro
terminal: `POST /api/nfc/identificar` usa o login web, valida o UID e registra a
leitura já consumida pelo funcionário. O pareamento para impressão não é exigido
nesse percurso. A gravação do pedido continua dependendo da ação na tela.
Se aproximar antes de abrir a ação, a tela avisa e mantém a última leitura por
até 15 segundos; após esse prazo, aproxime novamente. Leituras repetidas no
carregamento da página não são entregues duas vezes na mesma sessão da ponte.

O Android exige primeiro plano para esse leitor NFC. **Receber impressões** continua
funcionando em segundo plano, mas não mantém a leitura de UID sobre outro app.
Mantenha a DoixP aberta dentro do Servidor e o celular desbloqueado. Também é
possível usar outro aparelho/computador como terminal web e deixar este celular
no painel do leitor. A sessão web interna exige login próprio, separado do Chrome.

### Testar NFC e conferir o Samsung S21

#### Ler a partir do Chrome ou da DoixP instalada pelo navegador (1.5.18)

1. Atualize o Servidor Android pelo próprio botão **Buscar atualizações**, sem desinstalar.
2. No Chrome/PWA, abra **Mesas → Lançar para cartão**, monte o pedido e toque em
   **Aguardar cartão → Ler cartão neste celular**. O botão também aparece em
   **Adicionar com cartão** e **Fechamento de cartão**.
3. Confirme a abertura do Servidor, se o Android pedir. Surge **Leitor NFC DoixP**.
4. Aproxime o NTAG215. O leitor envia o UID por HTTPS e fecha para retornar à tela
   que o abriu; confira a confirmação do pedido no navegador. Em falha de rede,
   **Tentar enviar novamente** repete o mesmo envio sem trocar a identificação.

A janela de leitura entra em primeiro plano brevemente porque o Android exige
isso para ler o UID. O serviço de impressão continua ativo. Não é necessário
Web NFC, gravar NDEF, escolher carteira de pagamento nem parear impressoras para
esta leitura. Se o app ainda não tiver o leitor, o link para atualizar aparece
na própria espera. O mesmo botão funciona na WebView interna.

O backend exige a migração **0039_nfc_solicitacoes.sql**. A sessão web cria uma
capacidade aleatória de 256 bits, válida por dois minutos, armazenada como hash.
O leitor nativo só pode enviar um UID a essa solicitação; não recebe a sessão web
nem credenciais de impressora. A consulta/cancelamento exige o funcionário e a
loja originais. Leituras concluídas podem ser recuperadas por cinco minutos após
a expiração quando o navegador fica suspenso. Uma espera cancelada recusa envio.
O envio aceita somente a origem oficial ou a HTTPS configurada no aparelho,
sem redirecionar o segredo para outro endereço. Nenhum pedido é criado pelo
endpoint nativo; o lançamento depende da ação autenticada na tela web.

#### Diagnóstico pelo painel do servidor

1. No S21, abra **Configurações → Conexões → NFC e pagamentos sem contato** e
   ligue o NFC. A opção **Configurações NFC** no Servidor abre essa tela.
2. No Servidor, use **Testar conexão**: deve aparecer **Conexão OK** com o nome
   correto do estabelecimento. Erros indicam rede, endereço, credencial ou backend
   desatualizado; não representam falha do cartão.
3. Use **Testar cartão** e aproxime o cartão da traseira com o celular desbloqueado.
   O primeiro resultado deve mostrar **OK · UID …**. Essa etapa funciona mesmo
   sem pareamento/internet e comprova a leitura física.
4. Para testar a ponte, mantenha o sistema web visível e em foco na mesma conta.
   A confirmação **Teste recebido na tela DoixP** comprova o percurso completo.
   No mesmo celular, volte ao site após ler; ao retornar ao Servidor, confira
   o resultado. O evento precisa ser recebido pelo site em até um minuto.
5. Desligue **Modo de teste (sem pedidos)** e teste um pedido pela tela **Mesas**.
   A confirmação da leitura é separada da confirmação de pedido salvo.

Se abrir o texto fora do Servidor, o Android está interpretando o conteúdo gravado
na tag. Durante a leitura, mantenha o Servidor em primeiro plano. A versão 1.5.16
usa `FLAG_READER_SKIP_NDEF_CHECK` e não lê nem envia esse texto. Não é preciso
apagar a tag, formatá-la ou mudar a carteira padrão de pagamentos.

O diagnóstico exige atualizar também backend e interface web. Testes usam uma
fila separada que não chega ao fluxo de pedidos de clientes antigos, não abre
contas e não envia produtos à cozinha. A consulta do resultado é autenticada e
isolada por estabelecimento. Não há nova migração de banco.

### Atualização pelo próprio aplicativo

A partir de 1.5.16, abra **Atualização do servidor → Buscar atualizações**. Se
houver uma versão nova, use **Baixar atualização → Atualizar servidor**. O app
baixa o APK oficial, confere SHA-256, tamanho, pacote, versão e assinatura e
aguarda as impressões antes de abrir o instalador. Autorize **Permitir desta
fonte** e confirme **Atualizar** quando o Android solicitar. O pareamento e as
impressoras são preservados; a recepção é retomada ao instalar ou cancelar.

Para receber este botão pela primeira vez, instale o APK oficial por cima da
versão antiga, sem desinstalar. A assinatura permanente usada no GitHub precisa
ser mantida para todas as versões. Um APK debug tem outra assinatura e não
consegue substituir o app oficial.

Para trocar de estabelecimento, toque em **Desconectar e trocar de conta**, aguarde
os trabalhos em andamento e faça um novo pareamento com o código da outra conta.
Desligar **Receber impressões** libera a sessão e mantém a credencial para retomar
na mesma conta. Um novo pareamento ou uma exclusão pelo painel são recusados enquanto
a sessão estiver ativa. Em perda de rede, aguarde 90 segundos sem contato.

Em rotas de etiqueta, escolha o tipo de papel: **Contínuo** usa altura automática e
avança somente o conteúdo; **Etiqueta** usa o espaço (GAP) e a altura física da
etiqueta; **Marca** usa o sensor de marca preta. Uma escolha incorreta pode fazer
a impressora avançar várias etiquetas procurando o próximo espaço ou marca.

O serviço mostra uma notificação permanente porque o Android pode suspender
aplicativos em segundo plano. Em aparelhos com otimização agressiva de bateria,
autorize o Servidor DoixP a executar sem restrições.
Na versão 1.5.17, **Receber impressões** aguarda a resposta das permissões antes
de iniciar. **Iniciando**, **Ativo em segundo plano** e **Parado** refletem a
inicialização real. Se o botão estiver desabilitado por falta de pareamento, o
motivo aparece nessa seção. **Configurações do app no Android** permite revisar
notificações e bateria; no S21, selecione **Bateria → Sem restrições** caso o
Android esteja suspendendo o serviço. Isso mantém a impressão, enquanto o leitor
NFC continua exigindo a tela interna em primeiro plano.

Na versão 1.5.11, o serviço usa o tipo Android `connectedDevice`, adequado às
conexões USB, Bluetooth e de rede com impressoras. O tipo anterior, `dataSync`,
tem [limite de duração e restrições no Android 15](https://developer.android.com/develop/background-work/services/fgs/timeout).
O manifesto inclui as [permissões exigidas para impressoras de rede](https://developer.android.com/develop/background-work/services/fgs/service-types#connected-device),
sem depender da autorização Bluetooth para iniciar uma rota de rede.

Falhas de inicialização ficam no cartão de status e no log `PrintSyncService`;
as atualizações da notificação são silenciosas. O encerramento não espera a
conexão Bluetooth na thread da tela. As tentativas de conexão Bluetooth têm
limite de 12 segundos cada. Ligue o Bluetooth antes de atualizar a lista e
selecione/autorize a impressora USB antes do teste. O teste local é enviado mesmo
sem conexão com o servidor; falhas ao sincronizar categorias aparecem separadamente.

Para diagnosticar um popup do próprio Android, conecte o aparelho com depuração
USB e capture `adb logcat -b crash -d`. Registre também a versão do Android e o
texto completo do popup; sem esse registro não é possível atribuir uma falha
específica apenas ao sintoma.

## Contrato de impressão

O aplicativo processa `PRINT_ORDER`, `PRINT_RECEIPT`, `PRINT_LABEL`,
`TEST_PRINTER` e `OPEN_CASH_DRAWER`. O texto pode vir em `content`, `conteudo`,
`text` ou `texto`; cópias, corte e avanço aceitam nomes em inglês ou português.
Cada trabalho muda de `sent` para `processing` e depois `success` ou `failed`,
sempre usando o `lease_id` fornecido pelo servidor.
