# SimplesX Gestor de Impressoras

Aplicativo local que conecta o deploy do SimplesX às impressoras instaladas no Windows ou no Linux.

## Desenvolvimento

```bash
npm install
npm start
```

O gestor gera um token na primeira execução. Copie-o para **Configurações → Impressoras** no sistema web. O aplicativo registra-se no deploy, consulta trabalhos a cada três segundos, imprime silenciosamente e confirma o resultado ao servidor.

No Linux, as impressoras devem estar cadastradas no CUPS. No Windows, devem estar instaladas em **Impressoras e scanners**.
