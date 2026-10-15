# DoixP Entregas — aplicativo Android

Aplicativo instalável somente para entregadores. Cadastro, aprovação pelo
suporte, turno online/offline, ofertas, retirada e entrega ficam no app. O
estabelecimento usa a página DoixP Delivery no sistema de vendas; o suporte
usa o painel web do serviço de entregas.
A interface da plataforma roda em uma WebView restrita ao servidor configurado;
localização, notificações de ofertas, compartilhamento e abertura de mapas usam
recursos Android em Kotlin. O servidor Node.js/SQLite continua em uma máquina ou
hospedagem acessível aos celulares. O APK precisa de conexão com esse servidor.

## Requisitos e projeto

- Android 8.0 ou superior (`minSdk 26`).
- Compilação e destino: Android 16 / API 36.
- JDK 17 ou 21, Android SDK 36 e Build Tools 35.0.0.
- Gradle Wrapper 8.11.1, Android Gradle Plugin 8.10.1 e Kotlin 2.0.21.
- Pacote de lançamento: `com.doixp.entregas`; teste: `com.doixp.entregas.debug`.

Abra esta pasta no Android Studio. Configure `ANDROID_HOME` ou crie
`local.properties` com `sdk.dir=/caminho/do/android-sdk`. Esse arquivo é local e
ignorado pelo Git. A primeira compilação requer internet para as dependências.

```bash
cd entregas/android
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:bundleRelease
```

No Windows, use `gradlew.bat`. Saídas:

| Arquivo | Finalidade |
| --- | --- |
| `app/build/outputs/apk/debug/app-debug.apk` | Instalação de teste, assinada com chave de debug |
| `app/build/outputs/bundle/release/app-release.aab` | Bundle de lançamento; fica **sem assinatura** se as variáveis da chave não forem configuradas |

O AAB não é um instalador direto. Gerá-lo sem chave serve para verificar a
compilação; o Google Play exige o bundle assinado com a chave de upload.

## Instalar e conectar para teste

1. Inicie o servidor conforme o [README da plataforma](../README.md) e faça o
   cadastro inicial do suporte na máquina local.
2. Instale o APK no celular, autorizando a fonte de instalação quando o Android
   solicitar. Com depuração USB, também é possível usar
   `adb install -r app/build/outputs/apk/debug/app-debug.apk`.
3. Abra **DoixP Entregas Teste** e informe o endereço do servidor. A tela do APK
   permite configurar a conexão e apresenta erros com opção de tentar novamente.
4. Cadastre-se no app ou entre com uma conta de entregador. O suporte precisa
   aprovar novos cadastros antes do primeiro turno online.

Para emulador Android, `http://10.0.2.2:3100` aponta para o computador. Para um
celular na mesma rede Wi-Fi, use o IP local do computador e libere a porta 3100
na rede de teste. Depois do cadastro inicial, reinicie o servidor permitindo
conexões da rede:

```bash
ENTREGAS_HOST=0.0.0.0 npm --prefix entregas start
```

Esse comando é executado na raiz do repositório. `localhost` no celular é o
próprio celular. Somente a versão debug aceita HTTP, limitado a endereços locais
e privados. Para operação pela internet, use HTTPS e configure
`ENTREGAS_HTTPS=1` no servidor para cookies seguros. A localização do entregador
no APK vem do Android; a localização pelo navegador requer contexto seguro.

## Localização e ofertas no Android

O entregador toca em **Ficar online** com o app visível, lê a explicação e concede
localização e notificações. Esta versão requer ambas para iniciar o turno. Uma
posição recente é obtida antes de marcar a disponibilidade e iniciar o serviço.
O serviço pode continuar com outro app aberto ou a tela bloqueada e mantém uma
notificação com ação para ficar offline.

As ofertas são consultadas periodicamente no servidor, com aviso local no Android.
Não há entrega de notificações por Firebase/FCM. Localização indisponível por um
período prolongado, sessão inválida ou suspensão encerram o acompanhamento. Sair
da conta ou tocar em **Ficar offline** também o encerra. Sem conexão, a tentativa
de registrar offline pode falhar; o servidor bloqueia aceites com posição antiga.

O serviço não reinicia sozinho após reiniciar o celular ou encerramento pelo
sistema. É necessário abrir o app e ficar online novamente. Restrições de bateria,
GPS, fabricante e rede precisam ser verificadas em aparelhos reais. Não há pedido
de `ACCESS_BACKGROUND_LOCATION` nem rastreamento antes da ação do entregador.

## Preparar uma versão assinada para Google Play

Defina a origem HTTPS pública, sem caminho (por exemplo, a origem que hospeda a
API e as páginas), e a chave de upload pertencente ao responsável pelo aplicativo.
Configure no ambiente de compilação:

| Variável | Conteúdo |
| --- | --- |
| `ENTREGAS_SERVER_URL` | Origem HTTPS de produção |
| `ENTREGAS_KEYSTORE_PATH` | Caminho absoluto do arquivo da chave de upload |
| `ENTREGAS_STORE_PASSWORD` | Senha do arquivo de chave |
| `ENTREGAS_KEY_ALIAS` | Alias da chave |
| `ENTREGAS_KEY_PASSWORD` | Senha da chave |

Mantenha as senhas em configuração local protegida ou no gerenciador de segredos
do ambiente de compilação. Não as coloque no código, documentação ou Git. Todas
as quatro variáveis de assinatura devem ser fornecidas juntas.

```bash
./gradlew :app:verifyPlayRelease
./gradlew :app:testDebugUnitTest :app:lintRelease :app:bundleRelease \
  -PentregasVersionCode=1 -PentregasVersionName=0.1.0
```

Só execute a segunda etapa se a primeira terminar com sucesso. A origem também
pode ser fornecida por `-PentregasServerUrl=...`. Na versão release com origem
definida, o usuário não pode trocar o servidor. Aumente `entregasVersionCode` em
cada novo envio. O comando `:app:assembleRelease` gera um APK de lançamento
instalável quando a assinatura estiver configurada.

O roteiro [GOOGLE_PLAY.md](./GOOGLE_PLAY.md) descreve Play App Signing, testes,
declarações, política pública e recursos visuais da loja. O rascunho da descrição
está em [play-listing/pt-BR.txt](./play-listing/pt-BR.txt). Nenhum comando deste
projeto publica automaticamente no Google Play.

## Privacidade e verificação

**Minha conta** oferece política e solicitação de exclusão. O servidor também
serve `/privacy.html` e `/account-deletion.html` sem exigir instalação do app.
Defina `ENTREGAS_OPERATOR_NAME` e `ENTREGAS_PRIVACY_CONTACT` no servidor e conclua
a política e o procedimento de atendimento antes de disponibilizar ao público.
O suporte vê as solicitações; a exclusão efetiva ainda exige tratamento humano.

Os testes Android verificam a validação dos endereços do servidor. Os testes da
plataforma verificam regras de negócio e APIs. A compilação e o lint não substituem
validar permissões, notificação, GPS com tela bloqueada, perda de rede e uma entrega
completa em celular real. O Pix atual é confirmado manualmente pela loja no
DoixP Delivery; não há split ou pagamento automático ao entregador.
