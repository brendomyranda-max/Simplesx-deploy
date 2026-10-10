# Guia do projeto DoixP

Este documento explica como o projeto está organizado, qual é o caminho dos dados e para que serve cada arquivo autoral. Ele também separa arquivos que devem ser editados daqueles que são criados automaticamente pelas ferramentas.

## Visão geral

O repositório contém quatro partes que trabalham juntas:

1. **Aplicação web (`src/`)**: interface React usada no navegador.
2. **API (`functions/`, `shared/` e `server/`)**: regras de negócio e acesso ao banco. O mesmo núcleo atende a produção no Cloudflare e o servidor local.
3. **Banco (`migrations/` e `data/`)**: estrutura versionada e dados locais em SQLite/D1; `data/` não acompanha o repositório.
4. **Servidores DoixP (`gestor-impressora/` e `gestor-android/`)**: programas instalados perto das impressoras para receber e imprimir trabalhos enviados pelo sistema.

O fluxo mais comum é:

```text
Pessoa usa uma página em src/pages
        ↓
src/lib/api.ts envia uma requisição para /api
        ↓
functions/api/[[path]].ts (Cloudflare) ou server/index.js (local)
        ↓
shared/router.js escolhe o handler da rota
        ↓
shared/handlers-*.js valida e executa a regra de negócio
        ↓
Cloudflare D1 ou data/simplexsa.db salva/consulta os dados
```

## Por que aparecem tantos arquivos JSON?

No código versionado existem somente sete JSON importantes:

| Arquivo | Para que serve | Editar manualmente? |
| --- | --- | --- |
| `package.json` | Identifica a aplicação web/API, lista comandos e dependências. | Sim, quando mudar scripts ou pacotes. |
| `package-lock.json` | Trava a versão exata de cada dependência e subdependência para que todas as instalações sejam iguais. | Não; o `npm` atualiza. |
| `gestor-impressora/package.json` | Configura o aplicativo Electron e como gerar instaladores Linux/Windows. | Sim, com cuidado. |
| `gestor-impressora/package-lock.json` | Trava as dependências do aplicativo Electron. | Não; o `npm` atualiza. |
| `tsconfig.json` | Arquivo-base que referencia as configurações TypeScript da aplicação e das ferramentas. | Raramente. |
| `tsconfig.app.json` | Regras TypeScript aplicadas ao frontend em `src/`. | Raramente. |
| `tsconfig.node.json` | Regras TypeScript para arquivos executados pelo Node, como a configuração do Vite. | Raramente. |

Os demais JSON vistos na pasta pertencem principalmente a:

- `node_modules/` e `gestor-impressora/node_modules/`: metadados dos pacotes baixados pelo npm. Há centenas porque cada dependência tem seu próprio `package.json` e pode depender de muitos outros pacotes.
- `gestor-impressora/release/`: conteúdo empacotado junto com o Electron/Chromium.
- `.wrangler/`: estado e cache local do simulador do Cloudflare.
- arquivos `*.tsbuildinfo`: cache do compilador TypeScript; apesar do conteúdo parecido com JSON, são artefatos gerados.

Esses arquivos gerados não representam centenas de partes da DoixP. Eles são como peças internas das ferramentas. Não devem receber comentários, e `package-lock.json` também não aceita comentários. JSON padrão não permite `//` nem `/* ... */`; colocar comentários nele pode impedir o build. A explicação deve ficar neste guia ou em um README.

## Raiz e configuração

- `.gitignore`: diz ao Git quais arquivos locais ou gerados não devem entrar no histórico.
- `.env.example` e `.dev.vars.example`: modelos sem credenciais reais para Express e Wrangler.
- `wrangler.toml.example`: modelo dos bindings Cloudflare; copie para o `wrangler.toml` local e informe seus IDs.
- `SEGURANCA.md`: configurações privadas, assinatura Android e publicação do portfólio.
- `README.md`: instruções operacionais para criar estabelecimentos, administrar tokens, usar NFC-e e configurar o Servidor DoixP.
- `index.html`: página HTML mínima em que o React é montado; carrega `src/main.tsx`.
- `package.json`: manifesto npm principal, descrito acima. Os comandos mais usados são `npm run dev`, `build`, `test`, `server` e `deploy`.
- `package-lock.json`: fotografia exata da árvore de dependências principal.
- `vite.config.ts`: configura o Vite, o plugin do React, o proxy local de `/api` e ajustes do build.
- `tailwind.config.js`: informa ao Tailwind em quais arquivos procurar classes CSS e define tema, cores, sombras e animações do design.
- `postcss.config.js`: liga Tailwind e Autoprefixer ao processamento do CSS.
- `tsconfig.json`: agrega os dois projetos TypeScript.
- `tsconfig.app.json`: valida e compila o código do navegador.
- `tsconfig.node.json`: valida arquivos de configuração executados no Node.
- `wrangler.toml`: configuração privada local do Cloudflare Pages, D1 e KV, criada a partir do modelo e ignorada pelo Git.
- `public/_headers`: cabeçalhos HTTP de segurança e cache copiados para o resultado do Vite.
- `.github/workflows/gestor-impressora-release.yml`: automação do GitHub Actions que testa e gera releases do gestor de impressão.

## Frontend: `src/`

### Inicialização e navegação

- `src/main.tsx`: ponto inicial do navegador; encontra o elemento `root`, ativa o roteador e renderiza `App` com notificações.
- `src/App.tsx`: mapa de rotas. Decide quais telas exigem login e quais módulos (`gestor`, `pdv_mercado` ou `restaurante`) cada usuário pode abrir.
- `src/index.css`: estilos globais, diretivas do Tailwind, variáveis visuais e ajustes de impressão/responsividade.
- `src/store/auth.ts`: estado global Zustand da autenticação. Guarda sessão, funcionário, módulos autorizados e ações de entrar/sair.

### Comunicação e regras compartilhadas do navegador

- `src/lib/api.ts`: cliente central da API. Acrescenta autenticação às requisições, transforma erros e agrupa endpoints por assunto (produtos, estoque, vendas, fiscal, dispositivos etc.).
- `src/lib/types.ts`: contratos TypeScript das entidades recebidas e enviadas pela API, como `Produto`, `Comanda`, `Venda`, `Funcionario` e `ConfigEmpresa`.
- `src/lib/format.ts`: formata moeda, números, datas, horas e nomes das formas de pagamento.
- `src/lib/cmv.ts`: calcula custo de mercadoria vendida e converte unidades de receitas/fichas técnicas.
- `src/lib/print.ts`: monta e dispara a impressão de recibos pelo navegador ou pelo gestor local.
- `src/lib/cupsPrint.ts`: conversa com o agente CUPS local, armazena preferências de impressora e também permite enviar trabalhos pela API implantada.
- `src/lib/estoqueSync.ts`: publica e observa um evento do navegador para telas diferentes atualizarem o estoque sem acoplamento direto.
- `src/lib/useBarcodeScanner.ts`: hook que reconhece a sequência rápida de teclas produzida por um leitor de código de barras.

### Componentes reutilizáveis

- `src/components/index.ts`: ponto único de exportação dos componentes.
- `src/components/Turnstile.tsx`: integra o desafio anti-robô Cloudflare Turnstile na tela de login.
- `src/components/AppShell.tsx`: estrutura visual autenticada, incluindo menu lateral, cabeçalho, navegação móvel e botão de sair.
- `src/components/ProdutoForm.tsx`: formulário completo de produto/insumo, códigos de barras, ficha técnica, unidades, validade e dados de balança.
- `src/components/AnimatedPage.tsx`: aplica a animação de entrada e saída às páginas.
- `(removido; AnimatedPage agora fica diretamente em components)`: reexporta os componentes de animação.
- `src/components/ui/index.ts`: reexporta todos os controles visuais para simplificar imports.
- `src/components/ui/Badge.tsx`: pequeno marcador de status.
- `src/components/ui/Button.tsx`: botão padronizado com variantes, tamanho e estado de carregamento.
- `src/components/ui/Card.tsx`: contêiner visual para agrupar conteúdo.
- `src/components/ui/EmptyState.tsx`: mensagem exibida quando uma lista não possui itens.
- `src/components/ui/Field.tsx`: combina rótulo, ajuda, erro e controle de formulário.
- `src/components/ui/IconButton.tsx`: botão compacto destinado a ícones.
- `src/components/ui/Input.tsx`: campo de entrada padronizado.
- `src/components/ui/Modal.tsx`: janela sobreposta com título, conteúdo e fechamento.
- `src/components/ui/PageHeader.tsx`: cabeçalho consistente para páginas.
- `src/components/ui/Select.tsx`: lista de seleção padronizada.
- `src/components/ui/Spinner.tsx`: indicador de carregamento.
- `src/components/ui/StatCard.tsx`: cartão de indicador numérico usado em painéis.
- `src/components/ui/Tabs.tsx`: navegação por abas tipada.
- `src/components/ui/Textarea.tsx`: campo de texto de várias linhas.
- `src/components/ui/Toast.tsx`: contexto e visual das notificações temporárias.
- `src/components/ui/Toggle.tsx`: chave liga/desliga.
- `src/components/ui/useConfirm.ts`: encapsula a confirmação do usuário antes de ações sensíveis.

### Páginas

- `src/pages/Login.tsx`: autenticação por CNPJ, usuário e senha, com Turnstile quando configurado.
- `src/pages/InicioPage.tsx`: escolhe e apresenta os módulos disponíveis ao usuário.
- `src/pages/Dashboard.tsx`: resumo operacional com indicadores e alertas.
- `src/pages/CategoriasPage.tsx`: cadastro e hierarquia de categorias/subcategorias.
- `src/pages/EntradaPage.tsx`: registra entrada de mercadoria, fornecedor, custo, lote e validade.
- `src/pages/EstoquePage.tsx`: consulta saldo e histórico de movimentações.
- `src/pages/ValidadePage.tsx`: acompanha fabricação, vencimentos e etiquetas de validade.
- `src/pages/PerdasPage.tsx`: registra produtos perdidos e a baixa correspondente.
- `src/pages/PdvPage.tsx`: caixa de mercado; busca itens, lê códigos/etiquetas de balança, monta carrinho, recebe pagamento e imprime.
- `src/pages/VendasPage.tsx`: histórico e detalhes das vendas concluídas.
- `src/pages/RestaurantePage.tsx`: visão geral de mesas e comandas do restaurante.
- `src/pages/ComandaPage.tsx`: lança pessoas e itens, transfere/fecha comandas e envia pedidos às impressoras.
- `src/pages/PagamentosComanda.tsx`: processa pagamentos individuais e pré-fechamentos de comandas.
- `src/pages/FinanceiroPage.tsx`: despesas, contas a pagar/receber, lançamentos e caixa.
- `src/pages/FechamentoCaixaPage.tsx`: confere valores por forma de pagamento e registra fechamento diário.
- `src/pages/RelatoriosPage.tsx`: consolida vendas, lucro, estoque, perdas, vencimentos e desempenho.
- `src/pages/FuncionariosPage.tsx`: usuários, perfis, módulos e permissões.
- `src/pages/ImpressorasPage.tsx`: servidores/agentes, filas, destinos e regras de roteamento de impressão.
- `src/pages/FiscalPage.tsx`: configuração fiscal, dados tributários de produtos, emissão e cancelamento simulado de NFC-e.
- `src/pages/ConfiguracoesPage.tsx`: dados e preferências gerais da empresa.
- `src/pages/TokensPage.tsx`: administração visual de tokens de estabelecimentos quando o usuário tem autorização.

## API compartilhada: `shared/`

Esta pasta evita duplicar regras entre o Worker do Cloudflare e o servidor Express local.

- `shared/router.js`: registra todas as rotas, autentica solicitações, verifica módulos e encaminha cada URL ao handler correto.
- `shared/tenant-db.js`: envolve o banco para aplicar automaticamente o `estabelecimento_id`; é a principal proteção contra misturar dados de empresas diferentes.
- `shared/util.js`: funções comuns de segurança, hashing, sessões/KV, CNPJ, produtos, ficha técnica, estoque e financeiro.
- `shared/units.js`: normaliza unidades e converte quantidades compatíveis, como kg↔g e l↔ml.
- `shared/balanca.js`: valida EAN-13 e decodifica etiquetas de balança no formato PLU + peso/volume.
- `shared/handlers-catalog.js`: categorias, fornecedores, produtos, códigos de barras, ficha técnica, estoque, lotes e validades.
- `shared/handlers-vendas.js`: mesas, comandas, itens, pagamentos, PDV, vendas, ajustes, perdas e baixas de estoque.
- `shared/handlers-financeiro.js`: despesas, contas, caixa, fechamentos e consultas usadas nos relatórios.
- `shared/handlers-cadastros.js`: login, funcionários, setores, impressoras, etiquetas e geração de trabalhos de impressão.
- `shared/handlers-fiscal.js`: configuração fiscal e ciclo de NFC-e; atualmente contém o adaptador simulador, sem emissão fiscal real em produção.
- `shared/handlers-gestor.js`: protocolo legado do gestor de impressão, incluindo registro, busca de trabalhos e confirmação.
- `shared/handlers-devices.js`: pareamento seguro do Gestor Local v2, dispositivos, tokens, tarefas idempotentes, eventos e auditoria.

## Entradas da API: `functions/` e `server/`

- `functions/api/[[path]].ts`: função catch-all do Cloudflare Pages. Adapta a requisição para o roteador compartilhado e fornece bindings D1/KV.
- `functions/downloads/[sistema].ts`: devolve o instalador correto para o sistema operacional solicitado.
- `server/index.js`: servidor Express local. Adapta Express ao mesmo roteador, usa SQLite e serve o frontend compilado de `dist/`.
- `server/env.js`: carrega o `.env` privado e valida a configuração do servidor.
- `server/sqlite-db.js`: adaptador que dá ao SQLite local uma interface parecida com D1 e aplica migrations ainda pendentes.
- `server/migrate-local.js`: comando curto para aplicar/listar migrations no banco local.
- `server/criar-token.js`: cria estabelecimento, dono e token inicial; pode operar no SQLite local ou D1 remoto.
- `server/gerenciar-tokens.js`: lista, ativa, desativa, renova ou apaga tokens administrativos.
- `server/importar-cardapio-italiano.js`: script específico de carga de exemplo, que cria categorias, insumos, pratos e fichas técnicas pela API.

## Banco e migrations

- `data/simplexsa.db`: banco SQLite local, criado pelas migrations e ignorado pelo Git; não acompanha clones do repositório.
- `migrations/0001_schema.sql`: estrutura inicial completa do sistema.
- `0002_pagamentos_individuais.sql`: pré-fechamento e pagamentos separados por pessoa.
- `0003_exibicao_produto.sql`: controla exibição de produtos no restaurante e mercado.
- `0004_ficha_tecnica.sql`: tipos de produto e ingredientes/receitas.
- `0005_modulos.sql`: módulos acessíveis por funcionário.
- `0006_usuario_master.sql`: registra que credenciais iniciais não devem existir em migration.
- `0007_gestor_impressao.sql`: gestor legado e fila de impressão.
- `0008_rotas_impressoras.sql`: categorias, finalidades e largura da impressora.
- `0009_categorias_hierarquia.sql`: categorias pai/filhas e herança da rota de impressão.
- `0010_estabelecimentos.sql`: transforma a base em multiempresa e adiciona isolamento por estabelecimento.
- `0011_ajustes_pdv.sql`: auditoria de alterações feitas em vendas.
- `0012_validades_produto.sql`: fabricação e vencimento diretamente no produto.
- `0013_fechamento_caixa.sql`: cabeçalho e itens da conferência diária de caixa.
- `0014_nfce.sql`: configuração, produtos, documentos, itens e eventos fiscais.
- `0015_seguranca_login_cnpj.sql`: identificação por CNPJ e reforço do armazenamento de PINs.
- `0016_conteudo_insumos.sql`: conteúdo líquido das embalagens usado no cálculo de receitas.
- `0017_gestor_local_v2.sql`: pareamento, dispositivos, fila idempotente e auditoria.
- `0018_servidores_impressao.sql`: impressoras publicadas por cada servidor/gestor.
- `0019_finalidades_impressao.sql`: destinos específicos para venda e validade.
- `0020_produtos_balanca.sql`: marca produto de balança e associa seu PLU.

As migrations são numeradas porque o banco precisa executar as mudanças exatamente uma vez e na mesma ordem em todos os ambientes. Não se deve editar uma migration que já foi aplicada em produção; uma alteração nova deve entrar em um próximo arquivo numerado.

## Gestor de impressão desktop: `gestor-impressora/`

- `README.md`: instalação, configuração e diagnóstico do agente desktop.
- `package.json` / `package-lock.json`: manifesto Electron e versões exatas das dependências.
- `src/main.cjs`: processo principal Electron; cria janelas/tray, guarda configuração, consulta filas e envia dados às impressoras do sistema.
- `src/preload.cjs`: ponte restrita entre a tela e APIs privilegiadas do Electron.
- `src/renderer.js`: comportamento da tela de configuração e atualização do status.
- `src/index.html`: marcação da interface do agente.
- `src/settings.css`: aparência da janela de configurações.
- `src/style.css`: arquivo mínimo mantido para compatibilidade.
- `src/tray.svg`: ícone vetorial da bandeja do sistema.
- `src/windows-raw.ps1`: impressão RAW no Windows.
- `src/windows-fit.ps1`: impressão ajustada ao papel no Windows.
- `tests/protocols.test.cjs`: testa montagem e tratamento dos protocolos de impressão.
- `release/`: instaladores e aplicativos empacotados; conteúdo gerado, não deve ser comentado ou editado.

## Gestor de impressão Android: `gestor-android/`

- `README.md`: instruções para compilar, instalar e parear o aplicativo Android.
- `settings.gradle.kts`: nome do projeto, repositórios de plugins/dependências e inclusão do módulo `app`.
- `build.gradle.kts`: versões de plugins Android/Kotlin compartilhadas.
- `gradle.properties`: opções de desempenho e compatibilidade do Gradle.
- `app/build.gradle.kts`: SDK, versão do aplicativo, dependências e opções de compilação do app.
- `app/proguard-rules.pro`: regras adicionais de redução/ofuscação; atualmente vazio.
- `app/src/main/AndroidManifest.xml`: permissões, Activity inicial, receiver de boot e serviço de sincronização.
- `data/AppConfig.kt`: persistência local e segura da URL, identificação e token do dispositivo.
- `network/SimplexsaApi.kt`: cliente HTTP para pareamento, heartbeat, consulta e confirmação das tarefas.
- `print/PrinterTransport.kt`: descobre/conecta impressoras e transmite bytes por USB, Bluetooth ou rede.
- `print/PrinterCommands.kt`: escolhe protocolo e monta o trabalho final.
- `print/EscPos.kt`: comandos ESC/POS para cupons térmicos.
- `print/Tspl.kt`: comandos TSPL para impressoras de etiquetas.
- `print/LabelLayout.kt`: posiciona textos e informações no desenho da etiqueta.
- `sync/BootReceiver.kt`: reinicia a sincronização depois que o Android liga.
- `sync/PrintSyncService.kt`: serviço persistente que envia heartbeat, busca tarefas e informa resultado.
- `MainActivity.kt`: tela de configuração, pareamento, seleção de impressoras e controle do serviço.
- `res/values/styles.xml`: tema visual nativo do Android.
- `PrinterCommandsTest.kt`: testes da geração de comandos para os protocolos suportados.

## Testes e arquivos gerados

- `tests/devices.test.js`: testa autenticação, pareamento, fila e segurança de dispositivos.
- `tests/balanca.test.js`: testa validação e leitura de etiquetas EAN-13 da balança.
- `dist/`: frontend produzido por `npm run build`; será recriado e não deve ser editado diretamente.
- `node_modules/`: pacotes instalados por `npm install`; pode ser recriado a partir de `package-lock.json`.
- `.wrangler/`: bancos, cache e estado do ambiente Cloudflare local.
- `gestor-android/.gradle/` e `gestor-android/app/build/`: caches e resultados da compilação Android.
- `gestor-impressora/node_modules/` e `gestor-impressora/release/`: dependências e pacotes compilados do Electron.
- `*.tsbuildinfo`: cache incremental do TypeScript.

## Ordem recomendada para estudar

1. Leia `src/App.tsx` para conhecer as telas e permissões.
2. Escolha uma página simples, como `src/pages/CategoriasPage.tsx`.
3. Veja em `src/lib/api.ts` qual endpoint essa página chama.
4. Encontre a rota correspondente em `shared/router.js`.
5. Leia o handler indicado e as funções auxiliares de `shared/util.js`.
6. Consulte a tabela relacionada em `migrations/0001_schema.sql` e suas alterações nas migrations posteriores.

Esse caminho mostra uma funcionalidade de ponta a ponta e é mais fácil de acompanhar do que ler os arquivos em ordem alfabética.
