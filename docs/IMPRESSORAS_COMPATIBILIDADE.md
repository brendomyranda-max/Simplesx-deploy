# Compatibilidade de impressoras — Servidor DoixP 1.5.24

O servidor usa a linguagem ativa da impressora, e não apenas a marca. O catálogo
compartilhado entre Android e desktop contém perfis de configuração baseados em
manuais; isso não equivale a homologação física de cada modelo, revisão e firmware.
Não há garantia de todos os modelos de uma marca.

No Android: **Escolher perfil da marca / modelo**, conferir o autoteste, selecionar
a conexão, salvar e imprimir o teste. No desktop: **Configurar → Perfil da marca /
modelo → Aplicar perfil**, conferir os campos e salvar. O perfil altera os parâmetros
de impressão, preservando a rota, endereços, pareamento e categorias. Não modifica
firmware, emulação ou configurações permanentes do equipamento.

## Perfis disponíveis nos dois servidores

| Perfil | Protocolo | Condição de uso / referência |
| --- | --- | --- |
| Epson — TM em ESC/POS | ESC_POS | Use em modelos TM cujo autoteste confirme ESC/POS. Ajuste bobina e colunas conforme o modelo. [Manual](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/gs_cv.html) |
| Bematech MP-4200 TH — ESC/Bema | ESC_BEMA | Somente MP-4200 TH com conjunto ESC/Bema ativo. Não usar este perfil em HS ou outras linhas sem confirmar o manual. [Manual](https://logiccontrols.com/wp-content/uploads/2024/03/LC2020_MP4200TH_english_user-manual.pdf) |
| Bematech MP-4200 TH — ESC/POS | ESC_POS | Somente com ESC/POS ativo; ESC/Bema usa outro perfil. [Manual](https://logiccontrols.com/wp-content/uploads/2024/03/LC2020_MP4200TH_english_user-manual.pdf) |
| Elgin i9 — ESC/POS | ESC_POS | Perfil para i9 com ESC/POS ativo e bobina 80 mm. Confira a guilhotina e as microchaves no manual. Outras Elgin precisam confirmar a emulação. [Manual](https://cdn.awsli.com.br/472/472874/arquivos/406%20Manual%20de%20Instrucoes%20Impressora%20i9%20Elgin.pdf) |
| Diebold IM453H — Padrão / Padrão II | DIEBOLD | Corte conforme configuração da Diebold. Avanço otimizado opcional exige firmware PD1.12+. Outras Diebold precisam de confirmação. [Manual](https://www.bztech.com.br/arquivos/manual-firmware-diebold-im453hu.pdf) |
| Gertec G250 / G250W — ESC/POS | ESC_POS | Guilhotina parcial. G250W acrescenta Wi-Fi; use somente a interface existente no seu equipamento. [Manual](https://www.gertec.com.br/wp-content/uploads/2022/06/Manual_Usuario_G250-G250W_R09.22.pdf) |
| Tanca TP-650 — ESC/POS | ESC_POS | Bobina de 80 mm. Confira as interfaces e caracteres por linha no autoteste. [Manual](https://www.tanca.com.br/automacao-comercial-produto.php?cod=93) |
| Citizen CT-S310II — ESC/POS | ESC_POS | Perfil para bobina de 80 mm. Se usar 58 mm, ajuste a largura e as colunas antes do teste. [Manual](https://www.citizen-systems.com/en/products/printer/pos/ct-s310ii/) |
| Bixolon SRP-350/352plusII — ESC/POS | ESC_POS | Use a emulação ESC/POS descrita no manual. Outras emulações Bixolon precisam de perfil correspondente. [Manual](https://bixolon.com/_upload/manual/Manual_SRP-350352plusII_Command_Rev_1_02.pdf) |
| Star Micronics — Star Line Mode | STAR_LINE | Somente modelos com Star Line ativo, como TSP650/TSP700II conforme manual. Não equivale a StarPRNT, Star Graphic ou todos os TSP100. [Manual](https://www.starmicronics.com/support/Mannualfolder/linemode_cm_en.pdf) |
| Zebra — ZPL / ZPL II | ZPL | Modelo precisa aceitar ZPL. Configure largura, altura física e DPI; não ativa acessórios de corte de etiquetas. [Manual](https://support.zebra.com/article/Change-printer-language-and-driver-to-ZPL?redirect=false) |
| Zebra portátil — CPCL | CPCL | Somente modelos com CPCL ativo. Ajuste a largura real da mídia e o DPI. [Manual](https://support.zebra.com/article/Change-printer-language-and-driver-to-ZPL?redirect=false) |
| Zebra / Eltron — EPL2 | EPL | Somente modelos com EPL2 disponível e ativo. EPL1 não é equivalente. [Manual](https://support.zebra.com/article/Change-printer-language-and-driver-to-ZPL?redirect=false) |
| TSC — TSPL / TSPL2 | TSPL | Use em modelos TSPL. Configure o espaço ou a marca conforme a etiqueta e ajuste o DPI físico. [Manual](https://emea.tscprinters.com/en/faq) |
| Brother — emulação ZPL | ZPL | Somente modelos que oferecem emulação ZPL ativa. QL, PT e outros modelos Raster/ESC-P podem exigir SDK/driver e não são cobertos por este perfil. [Manual](https://support.brother.com/g/s/es/dev/en/print/command_type/index.html) |
| Honeywell — ZSim / ZSim2 | ZPL | Somente modelos com emulação ZPL II/ZSim ativa. DPL, IPL e Fingerprint nativos exigem outra integração. [Manual](https://automation.honeywell.com/us/en/products/productivity-solutions/printers/industrial-printers/pm65-industrial-printer) |
| SATO — emulação SZPL | ZPL | Somente modelos com SZPL ativo. SBPL nativo não é ZPL; use o driver no desktop quando não houver a emulação. [Manual](https://www.satoeurope.com/software/ws2-printer-utility.php) |
| Outra marca — ESC/POS 58 mm sem guilhotina | ESC_POS | Para Elgin, Daruma, Sweda, Control iD, Xprinter, Rongta e outras: use somente se o manual/autoteste confirmar ESC/POS. A marca sozinha não confirma compatibilidade. [Manual](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/gs_cv.html) |
| Outra marca — ESC/POS 80 mm com guilhotina | ESC_POS | Use somente se o autoteste confirmar ESC/POS e o equipamento tiver guilhotina. Ajuste o corte aceito pelo modelo. [Manual](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/gs_cv.html) |
| Outra marca — TSPL/TSPL2 | TSPL | Somente modelos que documentem TSPL/TSPL2. Linguagens parecidas não garantem compatibilidade. [Manual](https://emea.tscprinters.com/en/faq) |
| Demais modelos — driver oficial no computador | DRIVER | Windows/Linux: instale o driver oficial e crie uma fila. No Android, modelos sem um dos protocolos diretos exigem SDK/serviço do fabricante. Corte depende do driver. [Manual](https://www.citizen-systems.com/en/products/printer/pos/ct-s310ii/) |

## Interfaces e funções

- **Android USB OTG:** envio direto à interface USB bulk da impressora. USB serial,
  VCOM, equipamentos com encapsulamento proprietário e impressoras internas de
  terminais POS precisam de driver/SDK específico; a presença do cabo USB não basta.
- **Android Bluetooth:** RFCOMM/SPP clássico com pareamento. BLE/GATT, MFi e canais
  proprietários não são equivalentes a SPP e exigem integração específica.
- **Android rede:** socket TCP de impressão, normalmente porta 9100. Wi-Fi é um
  meio de rede, e não significa que o equipamento ofereça impressão TCP direta.
  IPP, AirPrint, ePOS HTTP e APIs proprietárias não são implementados neste transporte.
- **Desktop Windows/Linux:** as conexões passam por filas instaladas no sistema.
  Use o driver oficial para modelos que não aceitam as linguagens diretas.
- **Cupons:** texto, tamanho de fonte, quebra de linha, alinhamento, avanço e corte
  conforme o protocolo e mecanismo disponível. A abertura de gaveta continua
  específica de rotas ESC/POS; não é presumida nos demais protocolos.
- **Etiquetas:** TSPL, ZPL, CPCL e EPL2 para texto e layout. Cutter/peeler de etiquetas,
  RFID e funções industriais não são habilitados por selecionar uma marca.
- **Impressoras fiscais:** não se tornam emissoras fiscais por receber texto RAW.
  Protocolos fiscais e seus SDKs não estão implementados nestes perfis.

ESC/Bema usa corte total/parcial nativo e avanço em linhas. Star Line usa os quatro
modos de corte do manual. StarPRNT e Star Graphic são linguagens diferentes e não
são anunciadas como cobertas pelo modo Star Line. Modelos Brother Raster/ESC-P,
Daruma ESC/Daruma, Argox PPLA, Honeywell DPL/IPL/Fingerprint e SATO SBPL precisam
de emulação compatível confirmada ou driver/SDK específico. Não envie sequências
de protocolos diferentes em tentativa automática: isso pode imprimir lixo ou cortar
no meio de um documento.

## Confirmação no equipamento

Para cada modelo/revisão, registrar o autoteste (linguagem, firmware, mídia, DPI,
colunas e interfaces), executar teste curto e pedido longo, confirmar cópias e corte,
reconectar a interface e repetir. Os testes automatizados verificam os bytes e a
preservação dos ajustes; não comprovam o movimento da guilhotina nem a saída física.
