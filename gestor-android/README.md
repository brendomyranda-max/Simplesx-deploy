# SimplesX Gestor para Android

Aplicativo Android que recebe trabalhos da fila segura do SimplesX e imprime em
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

Abra a pasta `gestor-android` no Android Studio, aguarde a sincronização do
Gradle e use **Build → Build APK(s)**. O APK de desenvolvimento será criado em
`app/build/outputs/apk/debug/app-debug.apk`.

## Configurar

1. No SimplesX, abra **Impressoras → Gestor Android** e gere o pareamento.
2. Digite no aplicativo o ID e o código exibidos (expiram em dez minutos).
3. Escolha o protocolo indicado no autoteste: **ESC/POS**, **TSPL**, **ZPL**,
   **CPCL** ou **EPL**.
4. Configure o DPI indicado no autoteste ou na etiqueta da impressora. Os valores
   mais comuns são **203**, **300** e **600 DPI**.
5. Escolha **Rede** e informe IP/porta, ou pareie a impressora nas configurações
   do Android e escolha **Bluetooth**.
6. Toque em **Salvar rota e imprimir teste**.
7. Ative **Receber impressões** e permita notificações/Bluetooth.

Em rotas de etiqueta, escolha o tipo de papel: **Contínuo** usa altura automática e
avança somente o conteúdo; **Etiqueta** usa o espaço (GAP) e a altura física da
etiqueta; **Marca** usa o sensor de marca preta. Uma escolha incorreta pode fazer
a impressora avançar várias etiquetas procurando o próximo espaço ou marca.

O serviço mostra uma notificação permanente porque o Android pode suspender
aplicativos em segundo plano. Em aparelhos com otimização agressiva de bateria,
autorize o SimplesX Gestor a executar sem restrições.

## Contrato de impressão

O aplicativo processa `PRINT_ORDER`, `PRINT_RECEIPT`, `PRINT_LABEL`,
`TEST_PRINTER` e `OPEN_CASH_DRAWER`. O texto pode vir em `content`, `conteudo`,
`text` ou `texto`; cópias, corte e avanço aceitam nomes em inglês ou português.
Cada trabalho muda de `sent` para `processing` e depois `success` ou `failed`,
sempre usando o `lease_id` fornecido pelo servidor.
