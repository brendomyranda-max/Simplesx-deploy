# Preparar o DoixP Entregas para o Google Play

Requisitos oficiais consultados em **13/10/2026**. Este roteiro prepara o envio;
gerar APK/AAB não publica o app nem representa aprovação pelo Google. Consulte
o [README Android](./README.md) para configuração e compilação do projeto.

O aplicativo é híbrido: a interface da operação abre em uma **WebView**, com
localização e notificações implementadas em Android. O backend **Node.js e o
banco SQLite permanecem no servidor**, compartilhados pelos usuários. Instalar
o APK no celular não instala nem hospeda esse servidor.

## 1. Definir a operação de produção

- Defina o responsável pelo app e use sua conta verificada do Play Console.
- Confirme o `applicationId` antes do primeiro envio: o projeto usa
  `com.doixp.entregas` em release e `com.doixp.entregas.debug` nos testes. O nome
  de pacote enviado à loja é permanente. Aumente `versionCode` em cada atualização.
- Disponibilize o servidor de entregas em um domínio **HTTPS público**. O app
  depende desse servidor; o endereço local do computador não atende usuários
  pela internet. Configure `ENTREGAS_SERVER_URL` ou a propriedade Gradle
  `entregasServerUrl` com a origem HTTPS de produção, sem caminho ou parâmetros.
- Defina o e-mail real de suporte, nome do responsável, política de retenção e
  canal para solicitações de privacidade. Não há contato ou domínio de produção
  fictício neste projeto.
- Prepare uma conta de entregador aprovada e uma corrida demonstrativa para a
  revisão do app. A loja e o suporte usam o DoixP Delivery e o painel web.

Configuração de conta, pacote e detalhes da loja: [Criar e configurar o app](https://support.google.com/googleplay/android-developer/answer/9859152?hl=en).

## 2. Compilar para a API exigida

Para um **novo app de telefone Android**, o requisito consultado é
**Android 16 / API 36 ou superior**, vigente desde **31/08/2026**. Use
`targetSdk = 36` e `compileSdk = 36` ou superior, com ferramentas compatíveis;
ambos já estão em **36** neste projeto, com `minSdk = 26` (Android 8.0).
O `minSdk` define os aparelhos antigos atendidos e não substitui esse requisito.
Confira novamente a regra no momento do envio: [Nível de API de destino exigido](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en).

Teste o app em aparelho real, incluindo Android 16: cadastro, aprovação e login
do entregador,
recusa de permissões, localização aproximada, tela bloqueada, interrupção de
internet, retomada do app, ficar offline e encerrar sessão. Valide uma corrida
completa, ocorrência e fechamento semanal contra o servidor de teste.

## 3. Assinar e gerar o Android App Bundle

Novos apps no Google Play usam **Android App Bundle (`.aab`)**. O APK é adequado
para instalação de teste; o AAB é o artefato enviado ao Console.
[Android App Bundles](https://developer.android.com/guide/app-bundle).

1. Gere uma chave de upload controlada pelo responsável pelo app. No Android
   Studio: **Build > Generate Signed Bundle / APK > Android App Bundle**.
2. Configure a assinatura de release conforme o README Android. Guarde keystore,
   alias e senhas fora do repositório, com cópia de segurança protegida. O projeto
   lê `ENTREGAS_KEYSTORE_PATH`, `ENTREGAS_STORE_PASSWORD`, `ENTREGAS_KEY_ALIAS` e
   `ENTREGAS_KEY_PASSWORD`; informe as quatro variáveis para assinar pelo Gradle.
3. Execute a verificação de configuração e só então gere a variante `release`,
   com os comandos abaixo. O bundle fica em
   `app/build/outputs/bundle/release/app-release.aab`.
4. Habilite **Play App Signing** no primeiro envio. A chave de upload assina o
   AAB; o Google assina os APKs distribuídos com a chave de assinatura do app.
5. Envie o AAB assinado para a faixa de teste interno. Um bundle sem assinatura
   de lançamento ou assinado com chave de debug não serve para publicação.

Esse processo depende da chave do proprietário e da conta Play Console.
[Assinatura e Play App Signing](https://developer.android.com/studio/publish/app-signing).

Na pasta `entregas/android`, com as variáveis de produção configuradas:

```bash
./gradlew :app:verifyPlayRelease && ./gradlew :app:bundleRelease
```

**A verificação é explícita:** `bundleRelease` não depende automaticamente de
`verifyPlayRelease`. Sem URL e sem chave, o projeto ainda permite gerar um AAB
**sem assinatura**, útil para verificar a compilação e inadequado para envio à
loja. `verifyPlayRelease` exige URL configurada e arquivo da chave presente;
a compilação assinada valida as credenciais da chave. Essa tarefa não comprova
disponibilidade pública do servidor nem conformidade dos formulários do Console.

## 4. Declarar localização e notificações

O entregador inicia o turno online com o app visível. Para acompanhar sua
posição durante esse turno, o serviço Android deve ter tipo `location`, as
permissões `FOREGROUND_SERVICE` e `FOREGROUND_SERVICE_LOCATION`, além de
localização concedida em tempo de execução. O projeto usa esse serviço
sem solicitar `ACCESS_BACKGROUND_LOCATION`.
[Tipos de serviço em primeiro plano](https://developer.android.com/develop/background-work/services/fgs/service-types#location).

Inicie o serviço após ação explícita e permissão concedida, enquanto a Activity
está visível; trate a perda de visibilidade durante o diálogo. O Android restringe
iniciar serviços de localização quando o app já está em segundo plano.
[Restrições para iniciar serviços](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start).

Antes do pedido de permissão, apresente uma explicação como esta, ajustada ao
comportamento efetivamente entregue:

> Enquanto você estiver online, o DoixP Entregas coleta e envia sua localização
> ao servidor da plataforma para mostrar sua posição e operar suas entregas,
> inclusive em segundo plano, quando você usa outro app ou bloqueia a tela.
> Toque em Ficar offline para encerrar o compartilhamento.

O consentimento e a permissão precisam preceder a coleta. A ausência de
`ACCESS_BACKGROUND_LOCATION` **não dispensa automaticamente** a análise de
localização em segundo plano: o Google considera o uso efetivo do serviço.
O serviço deve continuar uma ação do usuário e encerrar quando sua finalidade
terminar. Prepare uma justificativa centrada na operação do entregador e revise
as declarações solicitadas pelo Console.
[Política de localização](https://support.google.com/googleplay/android-developer/answer/9799150?hl=en).

Em **Conteúdo do app > Serviços em primeiro plano**, declare `location`, explique
o efeito de interrupções na posição do entregador e forneça vídeo mostrando:
login, explicação, permissão, ficar online, notificação do serviço, app em segundo
plano e ficar offline. A descrição deve corresponder à versão enviada.
[Declaração de serviços no Play Console](https://support.google.com/googleplay/android-developer/answer/13392821?hl=pt-BR).

No Android 13 ou superior, solicite `POST_NOTIFICATIONS` em contexto, explicando
os avisos de corridas e do turno. Recusar essa permissão impede alertas comuns;
não é tecnicamente obrigatório concedê-la para iniciar o serviço, que continua
obrigado a fornecer sua notificação ao sistema. Teste esse cenário e informe a
limitação na interface.
[Permissão de notificações](https://developer.android.com/develop/ui/compose/notifications/notification-permission).

Nesta implementação, o fluxo para ficar online solicita localização e
notificações e só inicia após ambas as permissões necessárias serem aceitas.
As ofertas são consultadas pelo serviço durante o turno; não há integração
Firebase Cloud Messaging ou recebimento de ofertas quando o entregador está offline.

## 5. Publicar privacidade e concluir Segurança dos dados

Publique a política em URL HTTPS pública, acessível sem login, sem bloqueio
geográfico e sem ser PDF. Vincule-a no app e no Play Console. Identifique o app,
responsável e contato real; explique coleta, uso, destinatários, proteção,
retenção e exclusão. A explicação de localização deve aparecer também durante
o fluxo de uso, antes da permissão, sem depender de abrir a política.
[Política de dados do usuário](https://support.google.com/googleplay/android-developer/answer/10144311?hl=pt-BR).

O servidor já oferece `/privacy.html`. Configure `ENTREGAS_OPERATOR_NAME` e
`ENTREGAS_PRIVACY_CONTACT` e revise o texto para a operação real. A página
identifica explicitamente a preparação do ambiente quando falta contato e
informa que o responsável ainda precisa definir prazos e processo de exclusão.
Preencher as variáveis não substitui essa definição. Use a URL pública completa
da página no Console depois de publicar o servidor em HTTPS.

Preencha **Segurança dos dados** com o comportamento do app, servidor, conteúdo
web e fornecedores realmente utilizados. Inventário inicial deste projeto:

| Dados a revisar | Uso nesta plataforma |
| --- | --- |
| Nome, telefone, login e identificador de conta | Acesso, suporte e operação |
| Localização aproximada ou precisa do entregador | Posição no mapa e disponibilidade |
| Endereço e coordenadas da loja e do destino | Coleta e entrega |
| Pedido, valores e registros de pagamento | Frete e fechamento semanal |
| Quatro dígitos finais do CPF usados como código | Confirmação de entrega; o CPF completo não é coletado aqui |
| Ocorrências, contatos registrados e auditoria | Suporte e análise de problemas |
| Requisições a mapas e bibliotecas externas | Renderização de mapas; avaliar dados enviados a fornecedores |

Defina coleta, compartilhamento, finalidade, obrigatoriedade e exclusão para
cada tipo aplicável. Verifique os fornecedores de hospedagem/mapas antes de
declarar ausência de compartilhamento. Não declare ausência de coleta somente
porque parte da interface roda em WebView. Só declare criptografia em trânsito
após verificar todos os destinos usados pela versão de produção.
[Formulário Segurança dos dados](https://support.google.com/googleplay/android-developer/answer/10787469?hl=pt-BR).

## 6. Oferecer solicitação de exclusão

A regra alcança apps que permitem criar conta em qualquer parte da experiência,
inclusive encaminhamento a cadastro externo. Exige caminho no app e recurso web
externo para solicitar exclusão de conta e dados. Todos os desenvolvedores
respondem às perguntas de exclusão no formulário.
[Requisitos de exclusão de contas](https://support.google.com/googleplay/android-developer/answer/13327111?hl=pt-BR).

**Aplicação ao projeto:** as contas operacionais são cadastradas pelo suporte,
e o primeiro acesso permite criar a conta do suporte. Esse fluxo precisa ser
considerado na declaração; não é correto assumir isenção apenas por haver
cadastro controlado. O projeto já oferece a página `/account-deletion.html`,
acessível pelo app e pelo navegador sem o APK. Nela, o usuário entra com sua conta
ou usa a sessão existente e registra um protocolo persistente. O suporte consulta
a fila de solicitações; reenvios não criam outro protocolo enquanto houver um pendente.

Solicitação não equivale a exclusão concluída. A operação precisa verificar a
identidade e executar exclusão ou anonimização dos dados aplicáveis. Explique
eventuais registros mantidos por motivos legítimos e os prazos correspondentes;
suspensão preventiva de entregador não substitui exclusão.
[Dados do usuário e retenção](https://support.google.com/googleplay/android-developer/answer/10144311?hl=pt-BR).

O código atual **registra a solicitação para atendimento humano**, sem apagar
contas ou registros financeiros automaticamente. Antes do envio, defina quem
atende a fila, como confirma a exclusão/anonimização e quais registros serão
mantidos, com justificativa e prazos. Disponibilize contato real para compradores
sem conta e pessoas sem acesso às credenciais. Informe no Console a URL HTTPS
pública completa da página de exclusão.

## 7. Preencher a página da loja e testar

- Use o rascunho [pt-BR.txt](./play-listing/pt-BR.txt), revisando-o contra a versão
  efetivamente compilada. Limites: nome 30 caracteres, descrição curta 80,
  descrição completa 4.000.
- Adicione e-mail real de suporte, categoria, países e declarações solicitadas
  em **Conteúdo do app**, incluindo acesso para revisão, público-alvo,
  classificação indicativa, anúncios, privacidade e permissões.
- Prepare ícone de loja **512 × 512**, imagem de destaque **1024 × 500** e pelo
  menos duas capturas reais para telefone, sem dados pessoais de clientes.
  [Recursos visuais da loja](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en).
- O projeto inclui ícones vetoriais do aplicativo. Os PNGs da página da loja,
  a imagem de destaque e as capturas reais ainda precisam ser produzidos; os
  arquivos vetoriais do launcher não substituem esses materiais.
- Comece pelo teste interno, valide o app instalado pelo Google Play e revise
  o relatório de pré-lançamento antes de ampliar a distribuição.
- Se a conta pessoal foi criada após **13/11/2023**, a regra consultada exige
  teste fechado com pelo menos **12 testadores por 14 dias consecutivos** antes
  de solicitar acesso à produção. Isso não garante sua aprovação.
  [Testes para novas contas pessoais](https://support.google.com/googleplay/android-developer/answer/14151465?hl=pt-BR).

## Pendências que exigem dados do responsável

| Dependência | Necessário para concluir |
| --- | --- |
| Conta Google Play | Titular verificado, acesso ao Console e formulários |
| Servidor público | Hospedagem, domínio HTTPS e URL final no app |
| Assinatura de lançamento | Keystore/alias/senhas sob controle do titular |
| Política e exclusão | Identificação, contato real, prazos e URLs públicas |
| Revisão do Google | Contas demonstrativas, vídeo e capturas do app |
| Lançamento | Testes exigidos, envio e decisão de revisão no Console |

A integração com vendas e as transferências financeiras continuam sendo etapas
separadas: esta versão registra pedidos e pagamentos operacionais. A publicação
na loja não configura automaticamente esses serviços.
