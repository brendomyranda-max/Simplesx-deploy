# DoixP na pesquisa

O domínio principal é `https://doixp.com/`. A apresentação da marca chega no
HTML já renderizada, sem depender de JavaScript ou da API de sessão. O mesmo
componente é usado na tela de acesso: o conteúdo não é exclusivo de buscadores.
O login, as permissões e os endereços dos módulos continuam funcionando.

O build gera título, descrição, canonical, Open Graph e dados estruturados
`WebSite`/`Organization` a partir de `src/content/marca.json`. Os arquivos
`public/robots.txt` e `public/sitemap.xml` indicam a página principal aos buscadores.
O sitemap não inclui telas de gestão nem acompanhamento de pedidos.

As regras `X-Robots-Tag` em `public/_headers` mantêm os módulos privados e as
cópias `pages.dev` fora dos resultados. Não são controles de segurança: a
autenticação continua sendo aplicada pela API. O robots.txt permite rastrear
os módulos para que os buscadores possam ler o `noindex` dos cabeçalhos.

## Passo necessário na conta do proprietário

1. Acesse <https://search.google.com/search-console> com a conta Google do dono.
2. Adicione a propriedade **Domínio** `doixp.com`.
3. Copie o registro TXT de verificação fornecido pelo Google. Na Cloudflare,
   em **doixp.com → DNS → Registros**, adicione-o com nome `@` e TTL automático,
   sem remover o CNAME do site ou outros registros. Não publique credenciais.
4. Volte ao Search Console e selecione **Verificar**.
5. Em **Sitemaps**, envie `https://doixp.com/sitemap.xml`.
6. Na inspeção de URL, inspecione `https://doixp.com/`, teste a URL publicada e
   selecione **Solicitar indexação**.

É possível usar a propriedade **Prefixo do URL** e a verificação por arquivo
HTML ou metatag se o proprietário preferir não editar o DNS. Nesse caso,
primeiro obtenha o arquivo ou a metatag reais no Search Console; não use valores
inventados. A propriedade de domínio por TXT abrange também os subdomínios.

A publicação e o pedido de indexação não garantem indexação, prazo ou primeira
posição. Acompanhe a inspeção de URL e os relatórios de desempenho. Mantenha o
site disponível e use a marca e o endereço oficial nos canais reais da empresa,
sem comprar links nem criar avaliações ou conteúdo artificiais.

Referências: [Guia de SEO do Google](https://developers.google.com/search/docs/fundamentals/seo-starter-guide?hl=pt-br),
[solicitar rastreamento](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl?hl=pt-br),
[nome do site](https://developers.google.com/search/docs/appearance/site-names).
