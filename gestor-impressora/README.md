# SimplexS.A Gestor de Impressoras

Aplicativo local que conecta o deploy do SimplexS.A às impressoras instaladas no Windows ou no Linux.

## Desenvolvimento

```bash
npm install
npm start
```

O gestor gera um token na primeira execução. Copie-o para **Configurações → Impressoras** no sistema web. O aplicativo registra-se no deploy, consulta trabalhos a cada três segundos, imprime silenciosamente e confirma o resultado ao servidor.

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
