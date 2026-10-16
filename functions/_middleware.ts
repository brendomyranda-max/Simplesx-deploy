/**
 * Define o manifesto do PDA antes que o navegador avalie a página para instalação.
 */

export const onRequest: PagesFunction = async ({ request, next }) => {
  const response = await next();
  if (
    request.method !== 'GET'
    || response.status < 200
    || response.status >= 300
    || !response.headers.get('content-type')?.includes('text/html')
    || !request.headers.get('accept')?.includes('text/html')
  ) return response;

  const path = new URL(request.url).pathname;
  const marketplace = path === '/pedido' || path.startsWith('/pedido/');
  const manifest = marketplace
    ? '/manifest-marketplace.webmanifest'
    : path === '/' || path === '/investidores'
      ? '/manifest.webmanifest'
      : '/manifest-gestor.webmanifest';

  return new HTMLRewriter()
    .on('link#pwa-manifest', {
      element(element) {
        element.setAttribute('href', manifest);
      },
    })
    .transform(response);
};
