# DoixP — gestão de mercados e restaurantes

Aplicação web com PDV, mesas e comandas, estoque, ficha técnica, validade,
financeiro e impressão por agentes desktop e Android. React e TypeScript no
frontend; API JavaScript compartilhada entre Express/SQLite local e Cloudflare
Pages/D1/KV. Os dados são separados por estabelecimento.

A marca pública é **DoixP**; o ambiente de pedidos é **DoixP Delivery** e o
agente local é o **Servidor DoixP**.
Consulte [MARCA.md](./MARCA.md) para a compatibilidade da atualização com as
instalações, os dados e os endereços existentes.

## Versão da aplicação

**DoixP 0.1.0-beta.1 — Pré-lançamento.** Consulte o [histórico de versões](CHANGELOG.md).
A versão exibida na aplicação vem do `package.json`, sincronizado com o
`package-lock.json`. As próximas versões de pré-lançamento seguem
`0.1.0-beta.2`, `0.1.0-beta.3` e assim por diante. Cada publicação recebe uma tag
`doixp-v<VERSÃO>` e uma release marcada como pré-lançamento no GitHub.
Ao liberar a versão estável, retire o sufixo beta e a identificação de
pré-lançamento da interface.

Os instaladores do **Servidor DoixP** mantêm seu próprio versionamento e as tags
`gestor-v<VERSÃO>`.

## Transferência e exclusão de mesas

Na comanda de uma mesa do salão, **Transferir todos** move todos os lançamentos
ativos para uma mesa livre ou aberta, preservando os mesmos IDs, quantidades,
valores, observações e status. A separação por pessoa acompanha os produtos, sem
misturar pessoas com nomes iguais que já estejam no destino. A conta geral
continua geral. Cancelamentos e perdas permanecem na origem.

Por padrão, a origem continua aberta. **Liberar mesa de origem após transferir**
encerra a comanda vazia e libera a mesa, sem venda, pagamento, baixa de estoque
ou nova impressão. Essa opção não está disponível se houver perdas a conferir.
O destino já aberto mantém sua taxa; um destino livre recebe a taxa da origem.

A transferência é atômica, auditada e idempotente. Mudanças na lista de produtos,
fechamento em andamento, pessoas já pagas ou vendas antigas pendentes de revisão
bloqueiam a operação inteira. Reenviar a mesma intenção após timeout não duplica
produtos, pessoas ou comandas. A quantidade de consultas não cresce por produto.

Na lista de mesas, o ícone de lixeira permite ao usuário com módulo Gestor
**excluir uma mesa livre** após confirmação. É uma exclusão lógica: comandas,
pedidos e vendas antigas são preservados. Mesas ocupadas, com conta aberta ou
pré-fechada e mesas especiais não podem ser excluídas. Criar novamente uma mesa
com um número excluído reativa seu cadastro sem apagar o histórico.

Aplique `0037_transferencias_mesa.sql` antes de publicar o backend. A migração
adiciona apenas a auditoria da transferência e proteções contra abertura de
mesa excluída; não altera os pedidos existentes.

**Liberar mesa vazia** encerra somente a ocupação, após confirmação, mesmo quando
existem vendas antigas na comanda. A API exige `liberar_vazia: true` nesse caso,
confere novamente a ausência de produtos e pagamentos individuais pendentes
dentro da transação e preserva integralmente vendas, pagamentos e estoque.
O encerramento explícito fica identificado por `fechamento_tipo=sem_consumo`,
sem preencher `baixada_em`. As vendas anteriores permanecem visíveis para
conferência, inclusive ao consultar a comanda já encerrada. Não se trata de
estorno nem de regularização financeira automática.

Se uma comanda antiga ainda aberta receber **novos pedidos depois de todas as
vendas anteriores**, ela pode fechar normalmente cobrando somente esses pedidos
ativos. A API compara as datas de criação de todos os itens e vendas e revalida
os conjuntos na transação; datas ausentes ou itens anteriores mantêm o bloqueio
contra cobrança duplicada. Vendas antigas, seus pagamentos e suas movimentações
não são refeitos nem estornados. O aviso e a confirmação esclarecem que o
histórico financeiro anterior continua pendente de conferência. O atalho NFC
de fechamento também respeita o fluxo de liberação de mesa vazia.

**Cancelar tudo e liberar mesa** é uma opção exclusiva do Gestor para encerrar
comandas abertas ou pré-fechadas sem cobrança. Exige motivo e confirmação;
marca pedidos ativos como cancelados, preserva perdas existentes e registra
o estado anterior, responsável e vendas vinculadas na auditoria. Cancelamentos
fora da tolerância seguem a regra de registro de perda sem nova movimentação;
itens que possam ter sido vendidos antes não recebem outra perda. Vendas,
pagamentos, caixa e estoque não são estornados nem apagados. O encerramento
fica identificado por `fechamento_tipo=cancelada`, sem `baixada_em`.

O cancelamento é atômico e idempotente: uma confirmação desatualizada, fechamento
em andamento, outra comanda ativa na mesa ou pagamentos individuais pendentes
impedem a operação inteira. Repetir a mesma solicitação após timeout não repete
cancelamentos nem perdas. Aplique somente `0038_cancelamentos_comanda.sql`
antes de publicar essa opção; a migração cria apenas a tabela de auditoria.

Erros de fechamento encerram o diálogo e liberam os controles da tela. A ação
**Voltar às mesas** permite navegar mesmo enquanto uma confirmação está pendente;
sair da tela não cancela uma solicitação que já chegou ao servidor. Os avisos
diferenciam comanda fechada, reserva de fechamento ativa e venda anterior.

## Executar localmente

Requer Node.js 22.13 ou superior e npm. O SQLite é fornecido pelo próprio Node.

```bash
npm ci
cp .env.example .env
npm run db:migrate:local
npm run server
```

Em outro terminal, execute `npm run dev` e abra `http://localhost:5173`.
O cadastro pelo acesso tem taxa única de R$ 150,00 e está aguardando a configuração
do recebimento. Para preparar um ambiente administrativamente, use a CLI descrita
em **Criar um estabelecimento**. A instalação começa sem usuários, senhas
ou dados de clientes. O `.env.example` contém somente chaves públicas de teste
do Turnstile; em produção, configure suas próprias chaves.

Validação: `npm test`, `npm run build` e `npm --prefix gestor-impressora test`.
Para servir a interface compilada, execute `npm run build` antes de
`npm run server` e acesse `http://localhost:3001`.

## Configuração e credenciais

O servidor e os scripts Node carregam `.env`; variáveis exportadas no ambiente
têm prioridade. O Wrangler usa `.dev.vars` no desenvolvimento. Os arquivos reais
ficam fora do Git; os modelos `.env.example` e `.dev.vars.example` podem ser publicados.

Para configurar o Cloudflare, copie `wrangler.toml.example` para `wrangler.toml`,
informe os IDs do seu D1/KV e use Secrets do Cloudflare para credenciais. Os IDs
identificam recursos e não são senhas; cada instalação mantém sua configuração local.
O projeto Pages e o banco usados nos comandos são `simplesx-projeto-beta` e
`simplesx-db`; são identificadores técnicos existentes. Associe `doixp.com` ao
projeto Pages para disponibilizar o domínio público sem renomeá-los.

Para preparar a presença da marca na pesquisa e confirmar o domínio no Google
Search Console, consulte [SEO.md](./SEO.md). A confirmação na conta do
proprietário e a solicitação de indexação são etapas externas ao deploy.

Consulte [SEGURANCA.md](./SEGURANCA.md) para a relação de variáveis, assinatura
Android e cuidados ao publicar um repositório que já teve dados no histórico.

Para entender a arquitetura, o fluxo dos dados, a função de cada arquivo e por
que o repositório contém arquivos JSON, consulte [GUIA_DO_PROJETO.md](./GUIA_DO_PROJETO.md).

Para preparar os secrets da integração de pagamentos, consulte
[PAGBANK_CONFIGURACAO.md](./PAGBANK_CONFIGURACAO.md).

O estado atual do cadastro pago e da apresentação de investimento está documentado
em [CADASTRO_E_INVESTIMENTO.md](./CADASTRO_E_INVESTIMENTO.md).

## Criar um estabelecimento

Tokens não podem ser criados pela interface. Defina `SIMPLEXSA_SENHA_DONO` no
`.env` privado (ao menos 8 caracteres), execute o comando e apague a senha do
arquivo em seguida. Não passe senhas nos argumentos do terminal:

```bash
npm run criar-token -- "Nome do estabelecimento" CNPJ usuario_dono
```

O comando cria um ambiente vazio, o usuário dono com acesso total e mostra o
token uma única vez. Cada estabelecimento mantém produtos, usuários, estoque,
vendas, configurações e impressão isolados dos demais.

Para criar diretamente no deploy usado pelos clientes externos:

```bash
npm run criar-token -- "Nome do estabelecimento" CNPJ usuario_dono --remote
```

## Administrar tokens do deploy

```bash
npm run tokens -- listar --remote
npm run tokens -- desativar ID --remote
npm run tokens -- ativar ID --remote
npm run tokens -- renovar ID --remote
npm run tokens -- apagar ID --remote
```

O token completo nunca pode ser listado porque apenas seu hash é armazenado.
Apagar um token encerra as sessões, mas preserva os dados do estabelecimento.
Renovar substitui o token, encerra as sessões e também preserva todos os dados.

## Notas fiscais — Em breve

O módulo aparece como **Em breve** e permanece indisponível. As rotas fiscais e
a emissão manual estão bloqueadas, e a emissão automática está desligada, mesmo
se houver configurações antigas ativas. As vendas e os comprovantes comuns
continuam funcionando. Os dados fiscais existentes são preservados.

O módulo **NFC-e** usa o mesmo isolamento por `estabelecimento_id` dos tokens.
Cada estabelecimento mantém configuração do emitente, série, numeração, regras
tributárias dos produtos, documentos e eventos próprios dentro do D1.

A implementação preservada usa o provedor `simulador` em `homologacao`, sem
validade fiscal. A liberação futura exige reativar a disponibilidade do módulo;
produção também exige um adaptador de provedor e suas credenciais no Worker.

Antes do deploy, aplique a migration fiscal:

```bash
npx wrangler d1 migrations apply simplesx-db --remote
```

Credenciais e certificados não devem ser gravados no D1. O banco armazena apenas
o identificador da empresa no provedor; segredos globais pertencem aos secrets do
Worker/Cloudflare.

## Produtos sem vencimento

No cadastro de produtos simples e insumos, marque **Sem vencimento** para não
exigir uma data de vencimento da embalagem fechada. A fabricação passa a ser
opcional. As entradas de mercadorias respeitam essa opção e registram os lotes
sem gerar alertas de vencimento da embalagem fechada.

O **Vencimento pós-abertura (dias)** continua independente: é obrigatório para
insumos e opcional para produtos simples. Em **Controle de Validade**, procure o
produto, informe a abertura e use **Registrar e gerar etiqueta**. O vencimento
da etiqueta é calculado pelo prazo após abertura, mesmo em produtos sem vencimento.
Lotes e controles já registrados são preservados ao editar o cadastro.

Aplique `0024_produtos_sem_vencimento.sql` antes de publicar o backend:
`npm run db:migrate`. O comando `npm run deploy` já aplica as migrações antes da
publicação. Produtos existentes continuam com a opção desmarcada.

## Pedidos do restaurante

O cardápio permite navegar por categorias e subcategorias, buscar pelo nome e
ver todos os produtos da categoria principal. A tela do restaurante não usa EAN.

Clique em um lançamento para transferi-lo para outra pessoa ou mesa. No
computador, também é possível arrastá-lo para uma pessoa da própria comanda.
A transferência move o lançamento inteiro, incluindo sua quantidade, e preserva
preço, observações e status de preparo, mesmo após envio ou entrega. Ela não
reimprime o pedido nem gera outra movimentação de estoque ou venda.

Uma mesa livre é aberta automaticamente ao receber um lançamento; a mesa de
origem permanece aberta. Contas em pagamento ou fechadas e pessoas já pagas
não aceitam transferências. Alterações simultâneas são verificadas pela versão
do item e cada transferência fica registrada no histórico do banco.

Antes de publicar o backend, aplique `0022_transferencias_pedidos.sql` usando
`npm run db:migrate`. A migração adiciona o histórico, a versão dos itens e a
reserva temporária durante o fechamento, preservando os pedidos existentes.

Lançamentos em lote buscam produtos e acréscimos juntos, sem expandir a ficha
técnica de cada unidade. O fechamento carrega as receitas uma única vez e soma
o consumo de cada insumo, inclusive em receitas encadeadas. Venda, itens,
pagamentos, estoque, movimentos, financeiro e liberação da mesa são gravados
em uma transação. Falhas não deixam uma venda parcialmente concluída.

A criação das contas individuais também é transacional. A baixa por pessoa
tem reserva de concorrência para impedir duas vendas do mesmo pagamento.
Comandas antigas que já tenham uma venda concluída, mas ainda estejam abertas,
exigem conferência do histórico antes de outra baixa; não são reparadas
automaticamente nem recebem novo desconto de estoque.

Os testes de carga cobrem 10 e 50 drinks, 50 produtos distintos, reenvio,
fechamentos simultâneos, estoque compartilhado e falhas durante a gravação.
Essas correções não exigem migração de banco nem atualização dos instaladores.

## Taxa de serviço, despesas e CMV

No fechamento ou na baixa da comanda, informe **0** na taxa de serviço ou use
**Sem taxa de serviço**. A atualização automática dos pedidos preserva o valor
editado. A taxa zero também funciona no pré-fechamento e na divisão por pessoa.

Em **Financeiro → Despesas → Nova despesa**, informe nome e valor. Categoria,
data e forma de pagamento são opcionais. Despesa, lançamento e saída de caixa
são salvos juntos; os lançamentos com data sem horário entram nos totais do período.
O cartão **Despesas** do painel abre diretamente essa aba.

Em **Relatórios → CMV por produto**, ou no cartão **CMV** do painel, consulte
custo atual, preço, lucro bruto unitário, margem e CMV percentual. A lista aceita
busca por nome/código, filtro por categoria e subcategorias e ordenação por lucro,
margem, categoria ou nome. Margem é `(preço − custo) / preço`; não é markup.
Os valores são do cadastro atual, não do período de vendas, e não descontam
despesas, impostos ou descontos. Produtos sem preço não recebem margem fictícia;
custos zerados são destacados para conferência. Não há nova migração de banco.

## Gestor Local v2

Na versão **1.5.15**, o Servidor DoixP usa a **LogoDoixPAmarelo** no Android,
Windows e Linux, incluindo o cabeçalho, a bandeja e os ícones dos instaladores.
Os downloads em **Impressoras** entregam os instaladores dessa versão.

Na versão **1.5.14**, o aplicativo de impressoras e cartões NFC se apresenta como
**Servidor DoixP**, com a logo na interface e nos ícones Android, Windows e Linux.
A ativação do NFC fica no próprio servidor: em **Cartões NFC**, ative a leitura
no aparelho utilizado. No Windows/Linux, configure o prefixo do leitor USB e use
**Salvar e conectar**. No Android, a opção é salva imediatamente; mantenha o
Servidor DoixP aberto durante a aproximação do cartão.

Em **Impressoras**, baixe o instalador atualizado e consulte as últimas leituras.
Em **Mesas → Lançar para cartão**, monte o pedido e aproxime o cartão físico para
registrá-lo na comanda. A ativação não fica em Configurações gerais e cada
servidor mantém sua própria preferência de NFC.

### Comandas com cartão NTAG215

O NTAG215 é compatível com o leitor NFC do celular Android e pode ser usado
vazio, sem gravar nome ou mesa no cartão. Cada cartão identifica uma comanda
individual pelo UID físico de 7 bytes; cliente, mesa, pedidos e pagamentos ficam no sistema.
O texto NDEF não define a conta: cartões diferentes com o mesmo texto têm contas
separadas. UIDs em hexadecimal com espaços, dois-pontos ou hífens são reconhecidos
como o mesmo cartão, preservando os zeros iniciais.

1. No celular já pareado, ligue o NFC do Android e **Cartões NFC** no Servidor DoixP.
2. Em **Vendas → Recepção**, use **Cadastrar ou consultar cartão**, aproxime o cartão
   e informe nome do cliente e mesa. Para enviar um pedido pronto, use
   **Lançar para cartão → Aguardar cartão** antes da aproximação.
3. Use **Fechar comanda** na Recepção, ou **Fechamento de cartão** em Mesas, e
   confirme o pagamento individual. Os demais clientes continuam na mesa.
   Após fechar, cadastre o mesmo cartão para o próximo cliente; o histórico anterior é preservado.

O cartão permanece vinculado à pessoa e à mesa até fechar a conta. Não é possível
reatribuir um cartão em atendimento. Contas antigas de mesas virtuais precisam
ser encerradas em Mesas antes do novo cadastro. Consulte o [guia da Recepção](docs/recepcao-nfc.md).

No mesmo celular, use **Servidor DoixP → Cartões NFC → Abrir DoixP e usar cartões
NFC**. Entre na conta do estabelecimento, abra **Mesas** e monte o pedido. A tela
web fica dentro da mesma Activity do leitor: a aproximação funciona sem trocar de
app. O botão desliga o modo de teste e liga a leitura para atendimento.
Mantenha o celular desbloqueado. A impressão continua em segundo plano, mas o
Android só permite `enableReaderMode` enquanto a Activity está em primeiro plano;
um serviço não permite ler UID livremente sobre o Chrome ou outro aplicativo.
Também é possível deixar o celular como leitor e usar a DoixP em outro aparelho.

Na versão **1.5.17**, a tela interna recebe o UID diretamente por evento nativo e
usa `POST /api/nfc/identificar` com o login web. A leitura é registrada já
consumida, isolada na loja logada, sem exigir pareamento para impressão nem
depender do foco de elementos HTML. O texto gravado na tag é ignorado. Uma ação
precisa aguardar cartão para receber a leitura; a tela inicial não consome a
fila normal. A última leitura local pode aguardar a ação por até 15 segundos.
Ao cancelar uma espera, sua requisição em andamento não entrega o cartão a uma
nova ação. O pedido só é salvo pela ação autenticada de lançamento.

**Serviço em segundo plano → Receber impressões** aguarda as permissões e
mostra **Iniciando**, **Ativo em segundo plano** ou **Parado** conforme o serviço
real. A falta de pareamento aparece junto do botão. O atalho para configurações
do Android permite revisar notificações e bateria. No mesmo S21, use a tela
DoixP interna para NFC e mantenha-a em primeiro plano durante a aproximação.

O aplicativo Android existente já envia o UID. Para o diagnóstico e a leitura
que ignora o texto, atualize o backend, a interface web e o APK Android para
**1.5.17**. Não há nova migração de banco. Contas antigas que
usavam apenas o texto NDEF devem ser fechadas pela tela **Mesas** antes do primeiro
uso pelo UID; o sistema bloqueia a criação de outra conta quando detecta esse
caso, sem transferir saldo entre cartões.

### Diagnóstico NFC no Android (1.5.16)

A interface web também lê diretamente o NFC do próprio celular com **Web NFC**
quando a API estiver disponível (Chrome Android em HTTPS). Ao tocar em
**Aguardar cartão**, **Adicionar com cartão** ou **Fechamento de cartão**, a leitura
inicia no mesmo clique, sem abrir o Servidor e sem escolher um leitor. Autorize o
acesso ao NFC no navegador quando solicitado. A página precisa continuar visível
e o celular desbloqueado. Usa apenas `serialNumber` normalizado como UID; não abre,
interpreta nem escreve o texto NDEF. Cartões sem UID/NDEF legível podem precisar
do leitor nativo. O suporte é detectado pela API, não pelo modelo do aparelho.

O modo **Automático** prioriza a web compatível e depois o leitor integrado da
tela interna do Servidor. Nos demais casos, tenta os servidores conectados,
lembrando o último utilizado e pulando leitores ocupados por outras telas.
O nome do leitor escolhido aparece na espera. **Opções de leitura** permite fixar
um servidor por terminal quando há vários aparelhos no estabelecimento; essa
escolha fica salva neste navegador. A reserva continua exclusiva por tela.
Navegadores sem Web NFC também mantêm a opção de abrir o leitor Android.
Essa atualização é da web; os servidores oficiais 1.5.19 continuam compatíveis
e não precisam ser reinstalados. Não há nova migração de banco.

Na versão **1.5.19**, uma tela web no computador, celular ou PDA pode escolher
o aparelho leitor em **Onde aproximar o cartão**. A lista usa o mesmo pareamento
dos servidores de impressão. No S21, ative **Usar como leitor para outro aparelho**
e mantenha o Servidor aberto e desbloqueado. No computador, ative o leitor USB
no Servidor e mantenha a janela dele em foco. A web recebe a leitura pela internet,
mesmo sem o foco na janela, e só a tela solicitante recebe o cartão. Cada leitor
aceita uma espera por vez; conclua ou cancele antes de atender em outra tela.
Atualize o backend e aplique **0040_nfc_servidores.sql**. No próprio Android,
**Neste celular / PDA → Ler cartão neste celular** continua abrindo o leitor nativo.

Na versão **1.5.18**, o Chrome/PWA pode solicitar o leitor Android: em
**Aguardar cartão**, **Adicionar com cartão** ou **Fechamento de cartão**, toque
em **Ler cartão neste celular**, aproxime o cartão na tela nativa e aguarde o
retorno à DoixP. A opção funciona também na tela interna do Servidor. A leitura
usa uma solicitação temporária própria do funcionário/tela e não exige parear
uma impressora. Atualize o APK, backend e interface e aplique
**0039_nfc_solicitacoes.sql**. O leitor precisa aparecer brevemente em primeiro
plano; manter apenas um serviço em segundo plano não concede NFC ao navegador.

Em **Servidor DoixP → Cartões NFC**, use **Testar conexão** para conferir o
pareamento e o nome do estabelecimento. Use **Testar cartão** e aproxime o cartão
com essa tela aberta. O modo de teste mostra:

1. **Cartão no celular:** UID físico e tecnologias detectadas, mesmo sem internet.
2. **Envio ao DoixP:** confirmação do backend ou o erro de rede/pareamento.
3. **Chegada à tela:** confirmação de que o sistema web consumiu a leitura.

Deixe o DoixP web aberto e em foco, na mesma conta, preferencialmente em outro
aparelho. Em **Impressoras**, aparece a leitura como **teste Android**; também há
uma confirmação na tela. A fila de diagnósticos é separada da fila de atendimento,
inclusive para clientes antigos: testes não abrem comandas nem lançam itens.
Desligue **Modo de teste** antes de atender e confirme o pedido salvo na tela web;
receber a leitura não significa, por si só, salvar um pedido.

No **Samsung Galaxy S21**, confira **Configurações → Conexões → NFC e pagamentos
sem contato** e ative o NFC. Mantenha o celular desbloqueado e aproxime um cartão
por vez da traseira. O botão **Configurações NFC** abre o ajuste do Android, e
**Reiniciar leitor** permite reativar a leitura. O leitor também é retomado
automaticamente ao voltar das configurações ou ligar o NFC.

Com o Servidor em primeiro plano, a versão 1.5.16 usa apenas o UID e desativa
a interpretação de NDEF (`FLAG_READER_SKIP_NDEF_CHECK`), impedindo que o texto
seja aberto nesse modo. Fora do Servidor, o Android pode continuar mostrando
o texto gravado; a leitura em segundo plano não faz parte desse fluxo.
Não é necessário apagar o cartão ou trocar a carteira padrão de pagamentos.

O APK de teste local fica em `gestor-android/app/build/outputs/apk/debug/app-debug.apk`.
A versão publicada em **Downloads** só muda após a publicação do instalador;
compilar localmente não atualiza o aplicativo instalado no celular.

### Atualizar os servidores sem desinstalar (1.5.16)

Instale a versão 1.5.19 por cima da instalação anterior: execute o instalador do
Windows, substitua o AppImage no Linux ou confirme **Atualizar** no instalador do
Android. O APK publicado usa a mesma chave permanente; APKs de desenvolvimento
com outra assinatura não podem substituir a instalação oficial.

Na versão 1.5.19, use **Atualização do servidor → Atualizar servidor**: o botão
busca, baixa, verifica e inicia a instalação no mesmo fluxo. Nas versões anteriores,
conclua **Buscar atualizações → Baixar atualização → Atualizar servidor / Atualizar e reiniciar**
para receber essa correção, ou execute o instalador oficial por cima. Token,
pareamento, impressoras e diário de impressão permanecem no diretório existente.
Os trabalhos já recebidos terminam antes de instalar. No Android, autorize
**Permitir desta fonte** quando solicitado; ao retornar, a instalação continua
automaticamente. Confirme **Atualizar** no instalador do sistema;
ao concluir ou cancelar, a recepção é retomada se estava ligada.

A release inclui `latest.yml`, `latest-linux.yml`, instaladores e `android.json`
com versão, tamanho e SHA-256. Os feeds públicos em `/atualizacoes/` apontam
somente para arquivos permitidos da release publicada. O Android verifica também
o pacote, a versão e a assinatura. Publique a tag `gestor-v1.5.19` pelo workflow
dos servidores e aguarde os três artefatos antes de publicar o site com o novo
`shared/gestor-releases.js`. Nas próximas versões, aumente as versões do desktop,
Android e desse arquivo juntas.

Na versão **1.5.13**, as rotas com **Usar a impressora padrão do servidor**
respeitam a seleção feita no Gestor Windows, Linux ou Android. O nome da rota
(por exemplo, Cozinha ou Bar) não substitui o nome da impressora física.
O teste direcionado ao desktop também respeita esse destino quando existe um
Android padrão configurado. Essas correções exigem atualizar o backend.

Os aplicativos 1.5.13 incluem ajustes de descoberta e impressão pelo driver no
desktop e de recepção e transporte no Android. Atualize pelo download da tela
**Impressoras**, preservando o pareamento e as configurações da instalação.

No teste do Gestor Android pelo site, escolha a **Impressora para o teste**
(Bluetooth, rede ou USB). A tela acompanha a fila e mostra a confirmação do
Gestor ou o erro retornado pela impressora. Estar online ou aceitar um trabalho
na fila não é apresentado como confirmação de impressão.

A versão **1.5.9** adiciona proteção para pedidos simultâneos na mesma mesa.
Aplique `0023_pedidos_concorrentes.sql` antes do backend e atualize os Gestores
Windows/Linux/Android. Cada lançamento usa uma chave que permite retomar uma
requisição sem duplicar itens; o lote inteiro é salvo em uma transação.
O garçom vem da sessão autenticada de quem lançou, e aparece na tela e no ticket.
Para identificar quatro garçons, cada um deve entrar com seu próprio usuário.

A reserva por item/impressora, a criação do trabalho e o status de envio são
atômicos. Pedidos para mais de uma rota permanecem pendentes até todas entrarem
na fila; uma nova tentativa completa apenas as rotas faltantes. A tela consulta
a comanda a cada três segundos e mostra fila, processamento e falhas.

Os Gestores guardam em disco o resultado antes de confirmar ao servidor,
renovam a reserva durante a impressão e processam a fila sem sobrepor trabalhos.
Uma confirmação HTTP perdida é repetida sem reimprimir. Após interrupção durante
o envio físico, ou erro da impressora, o trabalho pede conferência: ESC/POS não
permite garantir se o papel saiu antes de uma queda de energia. Não há repetição
automática de bytes em um resultado incerto.

A tela **Impressoras** permite editar e excluir impressoras, modelos de etiqueta
e servidores Android/Windows/Linux. Editar um servidor altera seu nome no painel.
Excluir um servidor remove suas rotas, libera as categorias e cancela os trabalhos
pendentes. O histórico de trabalhos concluídos é preservado.

Servidores ativos não podem ser excluídos, pareados novamente ou vinculados a outro
estabelecimento por outra conexão. Primeiro use **Desconectar** no desktop ou
**Desconectar e trocar de conta** no Android. Sem rede, a sessão expira após 90
segundos sem contato. Uma tentativa recusada não consome o código de pareamento.

Para publicar esta mudança, aplique `0021_sessoes_servidores.sql` e distribua os
Gestores **1.5.8** junto com o backend. O desktop exige `session_id` nas chamadas
de registro, heartbeat, polling, confirmação e desconexão; versões anteriores
precisam ser atualizadas. O Android mantém o contrato de autenticação por token.

O backend possui uma fila segura e idempotente para a evolução do Gestor Local.
O protocolo desktop continua disponível com sessão exclusiva. Instalações Android devem
ser vinculadas por um código temporário criado por um usuário com módulo Gestor;
o código expira em dez minutos e só pode ser usado uma vez. O token devolvido ao
dispositivo é mostrado apenas no pareamento e armazenado no banco somente como hash.

As credenciais administrativas nunca devem ser copiadas para o gestor. Chamadas do
dispositivo usam `Authorization: Bearer <device-token>` e `X-Device-Id` sobre HTTPS.
O token do dispositivo expira em 90 dias e pode ser rotacionado pela rota autenticada
do próprio dispositivo.

Variáveis já usadas pelo projeto:

- `SIMPLEXSA_DB`: caminho do SQLite no servidor local;
- `PORT` e `HOST`: endereço do servidor local;
- `TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY`: proteção do login web.

Em produção, `DB` e `AUTH_KV` continuam sendo bindings do Cloudflare. Nenhum token
de dispositivo ou credencial de pagamento deve ser colocado em variável pública do
Vite, no repositório ou no frontend.
