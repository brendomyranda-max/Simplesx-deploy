# Verificação dos gestores — 7 de outubro de 2026

Versão preparada: **1.5.12** para Windows, Linux e Android.

## Falhas corrigidas nesta revisão

- **Windows:** o modo Driver com altura automática usava `windows-raw.ps1`,
  enviando texto diretamente ao dispositivo. Agora usa `windows-fit.ps1` com
  altura calculada. Os dois scripts interrompem a execução quando ocorre um
  erro; o modo Driver usa impressão silenciosa pelo driver instalado.
- **Linux:** a escolha automática de ESC/POS dependia do sufixo RAW no nome.
  A descoberta agora consulta `printer-make-and-model` por `lpoptions`. Filas
  identificadas como RAW usam ESC/POS se não existir protocolo salvo. Impressoras
  de etiquetas precisam da linguagem correspondente configurada explicitamente.
- **Desktop:** a largura recebida do trabalho passa a ser respeitada quando não
  existe uma largura salva. O resultado do último trabalho exibe o motivo do erro.
- **Android:** rede e Bluetooth agora têm limite de espera também durante a
  escrita. O teste local e o serviço serializam os envios. As alternativas
  Bluetooth só repetem a conexão; uma falha durante a transmissão não reenvia
  automaticamente o documento inteiro.
- **Android:** um destino inexistente gera erro explícito, sem trocar para outra
  impressora. Essa falha é registrada pelo diário e confirmada ao servidor.
  Respostas HTTP inválidas deixam de aparecer como fila vazia/Online. A versão
  informada ao servidor vem da versão compilada do APK.

## Estado observado neste computador

- CUPS funcionando; sete filas cadastradas.
- `Diebold80` e `DieboldRAW` pausadas.
- `DieboldIM453H`, padrão do CUPS, é uma fila RAW sem RAW no nome.
- Configuração local do gestor aponta para `LABEL_9X20`, TSPL, 50 mm, 203 DPI.
- Todas as filas consultadas usam destinos USB, mas nenhuma impressora aparece
  no `lsusb` no momento da verificação.
- Nenhum processo do gestor Linux foi encontrado na consulta realizada.

As filas, os protocolos salvos e o estado do serviço CUPS não foram alterados.
Reconectar a impressora e abrir a versão atualizada ainda é necessário para
validar a saída física. O nome da fila cadastrado não comprova presença USB.

## Validação

- Seis arquivos de testes desktop aprovados, incluindo novos casos de Driver
  automático, RAW sem sufixo, largura do trabalho e propagação de falhas.
- Testes de servidor em `devices`, `print-servers` e `restaurant-orders` aprovados.
- Dezessete testes Android aprovados e `assembleDebug` concluído.
- AppImage e instalador NSIS gerados. Código empacotado comparado com os fontes;
  scripts PowerShell conferidos fora do ASAR nas duas distribuições.
- APK 1.5.12, código de versão 25, compilado e assinatura verificada.

Limites: não houve impressão física nem execução nativa no Windows. O APK local
é de desenvolvimento, assinado com a chave debug, e não substitui uma instalação
assinada com outra chave. Os artefatos ficam em `release/1.5.12/`.

## Referências técnicas consultadas

- [Microsoft: tratamento de erros do PowerShell](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_error_handling?view=powershell-7.6).
- [Java Socket: SO_TIMEOUT limita a leitura](https://docs.oracle.com/en/java/javase/24/docs/api/java.base/java/net/Socket.html).
