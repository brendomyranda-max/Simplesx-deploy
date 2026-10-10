# Servidor DoixP para Android

Aplicativo Android que recebe trabalhos da fila segura da DoixP e imprime em
impressoras térmicas ESC/POS e impressoras de etiquetas TSPL/TSPL2, ZPL, CPCL
e EPL/EPL2 por:

- rede TCP/IP (porta `9100` por padrão);
- Bluetooth clássico SPP/RFCOMM;
- USB Host/OTG com envio direto à interface da impressora.

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
