# Configuração PagBank no Cloudflare

O projeto inicia com `PAGBANK_MODE = "simulator"`. Nesse modo nenhuma cobrança
real é criada, mesmo que algum secret seja preenchido.

## Secrets globais

Cadastre estes três valores no ambiente **Production** do projeto
`simplesx-projeto-beta`:

- `PAGBANK_API_TOKEN`: token Bearer da aplicação PagBank (comece pelo sandbox);
- `PAGBANK_TAPON_APP_KEY`: AppKey de QA fornecida após aprovação da integração Tap On;
- `PAGBANK_SIMPLEXSA_ACCOUNT_ID`: Account ID PagBank habilitado para a SimplexS.A receber split.

Não coloque esses valores no `wrangler.toml`, GitHub, frontend, APK ou conversa.
O valor de um secret não pode ser visualizado novamente no Cloudflare depois de salvo.

### Pelo painel

1. Entre no Cloudflare Dashboard.
2. Abra **Workers & Pages**.
3. Selecione **simplesx-projeto-beta**.
4. Abra **Settings > Variables and Secrets**.
5. Clique em **Add**.
6. Informe o nome exato, marque como **Secret/Encrypt**, cole o valor e salve.
7. Repita para os três nomes no ambiente **Production**.

### Pelo terminal

Execute um comando por vez. O Wrangler pedirá o valor de forma interativa, sem
gravá-lo no histórico do terminal:

```bash
npx wrangler pages secret put PAGBANK_API_TOKEN --project-name simplesx-projeto-beta
npx wrangler pages secret put PAGBANK_TAPON_APP_KEY --project-name simplesx-projeto-beta
npx wrangler pages secret put PAGBANK_SIMPLEXSA_ACCOUNT_ID --project-name simplesx-projeto-beta
```

Confira apenas os nomes cadastrados (os valores permanecem ocultos):

```bash
npx wrangler pages secret list --project-name simplesx-projeto-beta
```

## Configurações que não são secrets

Copie `wrangler.toml.example` para o arquivo local `wrangler.toml`. Ele contém:

- `PAGBANK_MODE`: `simulator`, futuramente `sandbox` e, após homologação, `production`;
- `PAGBANK_PLATFORM_FEE_BPS`: `2`, isto é, dois basis points = 0,02%.

O percentual é configuração auditável, não credencial. A API calculará valores
monetários em centavos e registrará o arredondamento. Nenhuma cobrança real deve
ser habilitada apenas trocando esse arquivo: o backend também validará credenciais,
conta do estabelecimento e status de homologação.

## Dado de cada estabelecimento

Cada cliente precisará informar seu próprio `Account_ID` PagBank e autorizar o
modelo de marketplace/split. Esse identificador não é global e será salvo na
configuração isolada do estabelecimento. O login feito no aplicativo Tap On não
substitui a autorização formal de split.

## Desenvolvimento local

Para testar localmente, copie `.dev.vars.example` para `.dev.vars` e substitua os
valores ao usar Wrangler. `.dev.vars` já é ignorado pelo Git por conter credenciais.
O servidor Express usa `.env`. A integração PagBank ainda é uma preparação de
configuração: preencher os secrets não implementa nem ativa cobranças reais.
