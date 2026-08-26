# SimplesX Gestor de Impressoras

Aplicativo local que conecta o deploy do SimplesX às impressoras instaladas no Windows ou no Linux.

## Desenvolvimento

```bash
npm install
npm start
```

O gestor gera um token na primeira execução. Copie-o para **Configurações → Impressoras** no sistema web. O aplicativo registra-se no deploy, consulta trabalhos a cada três segundos, imprime silenciosamente e confirma o resultado ao servidor.

No Linux, as impressoras devem estar cadastradas no CUPS. No Windows, devem estar instaladas em **Impressoras e scanners**.

Selecione a impressora e use **⚙ Tamanho** para escolher 58, 76, 80, 100 ou
102 mm, ou informar uma largura personalizada. A escolha é salva por impressora;
o texto é quebrado nessa largura e o comprimento termina junto com o conteúdo.

Se o Linux mostrar `CUPS indisponível`, inicie o serviço antes de atualizar a
lista de impressoras (normalmente `sudo systemctl enable --now cups`). O endereço
de produção precisa usar HTTPS; HTTP é aceito somente para testes em localhost.
