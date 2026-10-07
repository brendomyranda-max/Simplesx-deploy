# SimplexS.A

A marca pública é **SimplexS.A**. Use **simplexsa** em nomes de pacotes,
arquivos novos e identificadores que não aceitem pontuação.

O nome está aplicado ao site, apresentação aos investidores, mensagem de
WhatsApp, títulos, impressão de teste, documentação e gestores Windows, Linux
e Android. Os instaladores a partir de 1.5.10 usam `simplexsa-gestor-*`.

## Compatibilidade com instalações existentes

Alguns identificadores técnicos anteriores são contratos persistidos, não a
marca exibida. Eles continuam compatíveis para preservar acesso e operação:

- O projeto Cloudflare `simplesx-projeto-beta`, seu endereço `pages.dev`, o D1
  `simplesx-db` e o repositório GitHub `Simplesx-deploy` identificam recursos já
  existentes. Seus nomes não foram substituídos por endereços inexistentes.
- Cookie de sessão, chaves de armazenamento do navegador e pedidos pendentes
  conservam seus nomes para manter sessões, carrinhos, preferências e tentativas
  de envio que já estavam salvas.
- O Android mantém `br.com.simplesx.gestor`, as preferências e a assinatura de
  publicação para atualizar o aplicativo instalado e preservar o pareamento.
- O desktop mantém seu `appId` de instalação. Na inicialização, encontra o
  diretório anterior e reutiliza a configuração, o bloqueio de instância e o
  diário de impressão. Instalações novas usam `simplexsa-gestor-impressora`.
- As variáveis `SIMPLEXSA_*` têm prioridade, com os aliases `SIMPLESX_*` aceitos
  no servidor e nas ferramentas administrativas. Sem caminho explícito, o
  SQLite anterior é reutilizado; novas instalações usam `data/simplexsa.db`.

Não execute uma substituição global nesses identificadores. Uma mudança de
endereço, identidade de aplicativo ou armazenamento exige uma migração própria.

## Distribuição

Os downloads web apontam para os três arquivos da versão 1.5.13, publicados
antes do deploy. O workflow cria a release sem mudar `latest`; depois da
conferência dos arquivos e do deploy, a release pode ser promovida a mais recente.
Ao atualizar os gestores, ajuste a versão em `functions/downloads/[sistema].ts`.
