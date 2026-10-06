# Credenciais e publicação

## Onde configurar

| Configuração | Desenvolvimento | Produção |
| --- | --- | --- |
| `TURNSTILE_SITE_KEY` | `.env` (Express) ou `.dev.vars` (Wrangler), com chave pública de teste | Variável do servidor ou Cloudflare; a site key é pública |
| `TURNSTILE_SECRET_KEY` | Mesmos arquivos, com chave pública de teste | Secret do Cloudflare ou ambiente privado do servidor |
| `SIMPLEXSA_SENHA_DONO` | `.env` ou variável exportada, somente durante a criação do dono | Ambiente privado do terminal administrativo; remover após uso |
| `SIMPLEXSA_TOKEN`, `SIMPLEXSA_USUARIO`, `SIMPLEXSA_SENHA`, `SIMPLEXSA_URL` | `.env`, somente para o importador de cardápio | Ambiente privado do script, quando necessário |
| `PAGBANK_API_TOKEN`, `PAGBANK_TAPON_APP_KEY`, `PAGBANK_SIMPLEXSA_ACCOUNT_ID` | `.dev.vars` para a futura integração | Secrets do Cloudflare; ver [configuração PagBank](./PAGBANK_CONFIGURACAO.md) |
| `SIMPLEXSA_DB`, `HOST`, `PORT`, `NODE_ENV` | `.env` | Ambiente do servidor; use `NODE_ENV=production` |
| IDs D1 e KV | `wrangler.toml` local, copiado do modelo | Recursos da própria conta Cloudflare |

Os scripts Node carregam `.env` com a API nativa do Node e preservam variáveis já
exportadas. Nenhuma configuração é carregada desse arquivo para o código
compartilhado executado no Cloudflare; lá os handlers recebem os bindings do ambiente.
O Express recusa chaves Turnstile ausentes ou de teste com `NODE_ENV=production`.
No Cloudflare, cadastre as chaves reais antes do deploy; não copie as chaves de teste
dos modelos para os ambientes publicados.

Nunca coloque segredos em `VITE_*`: variáveis com esse prefixo podem entrar no
JavaScript entregue ao navegador. Credenciais de recebimento devem ficar no servidor.
A criação pública de contas permanece bloqueada até a integração de pagamento
ser configurada; consulte [cadastro e investimento](./CADASTRO_E_INVESTIMENTO.md).

Não há senha administrativa padrão. Senhas são definidas no cadastro ou na CLI.
Senhas de usuários e tokens devem ser gerados individualmente e persistidos pelo
sistema; não devem virar credenciais compartilhadas em variáveis de ambiente.
Os valores fictícios dos testes não dão acesso a nenhum ambiente.

## Android e dispositivos

A assinatura Android já usa os GitHub Actions Secrets `ANDROID_KEYSTORE_BASE64`,
`ANDROID_STORE_PASSWORD`, `ANDROID_KEY_ALIAS` e `ANDROID_KEY_PASSWORD`. O workflow
reconstrói o keystore na pasta temporária do runner. Para compilar localmente,
forneça `ANDROID_KEYSTORE_PATH` e as três variáveis de senha/alias no ambiente
do Gradle. Arquivos `.jks`, `.keystore`, certificados e instaladores ficam fora do Git.

Os gestores recebem suas credenciais durante o cadastro/pareamento e as guardam
no dispositivo. Não inclua configurações exportadas desses aplicativos no portfólio.

## Dados locais e histórico Git

`data/`, bancos SQLite e seus arquivos auxiliares, `.env*`, `.dev.vars*`,
configurações Cloudflare locais, certificados, caches e compilações são ignorados.
Os arquivos terminados em `.example` fornecidos pelo projeto são modelos sem
credenciais reais. Mantenha os arquivos privados com acesso restrito ao seu usuário.

O histórico anterior deste projeto contém versões do banco local com contas e
dados de autenticação. Remover um arquivo em um commit não remove suas versões
anteriores. Esse histórico não deve acompanhar um portfólio público.

Para um portfólio independente, publique somente uma cópia dos arquivos do commit
revisado em um repositório novo, com histórico inicial próprio. Não copie `.git`,
arquivos ignorados, tags ou branches do repositório antigo. Para conservar o
histórico de desenvolvimento, é necessário saneá-lo antes de torná-lo público.

Se dados de autenticação já foram compartilhados, troque as senhas afetadas,
renove os tokens e encerre as sessões correspondentes. Remover dados do Git não
revoga credenciais nem limpa cópias, forks ou clones existentes.

Referências: [remoção de dados sensíveis no GitHub](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository),
[bindings e secrets do Cloudflare Pages](https://developers.cloudflare.com/pages/functions/bindings/),
[variáveis de ambiente do Node](https://nodejs.org/api/environment_variables.html).
