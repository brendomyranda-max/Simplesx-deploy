# SimplesX Gestor de Impressoras

Aplicativo local que conecta o deploy do SimplesX às impressoras instaladas no Windows ou no Linux.

## Desenvolvimento

```bash
npm install
npm start
```

O gestor gera um token na primeira execução. Copie-o para **Configurações → Impressoras** no sistema web. O aplicativo registra-se no deploy, consulta trabalhos a cada três segundos, imprime silenciosamente e confirma o resultado ao servidor.

No Linux, as impressoras devem estar cadastradas no CUPS. No Windows, devem estar instaladas em **Impressoras e scanners**.

Selecione a impressora e use **⚙ Configurar** para escolher o protocolo Driver,
ESC/POS, TSPL/TSPL2, ZPL, CPCL ou EPL/EPL2 e a largura do papel. Use **Driver**
para filas comuns do Windows/Linux e a linguagem indicada no autoteste para filas
RAW. A escolha é salva individualmente para cada impressora.

Se o Linux mostrar `CUPS indisponível`, inicie o serviço antes de atualizar a
lista de impressoras (normalmente `sudo systemctl enable --now cups`). O endereço
de produção precisa usar HTTPS; HTTP é aceito somente para testes em localhost.
