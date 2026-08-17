import { handle } from '../../shared/router.js';

export async function onRequest(context) {
  const env = context.env;
  const request = context.request;
  const url = new URL(request.url);
  const tamanho = Number(request.headers.get('content-length') || 0);
  if (tamanho > 1024 * 1024) {
    return new Response(JSON.stringify({ error: 'Corpo da requisição excede 1 MB' }), {
      status: 413,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
  const c = {
    env: { DB: env.DB, AUTH_KV: env.AUTH_KV },
    params: {},
    user: null,
    req: {
      method: request.method,
      path: url.pathname,
      header: (n) => request.headers.get(n),
      query: (n) => url.searchParams.get(n),
      json: async () => await request.json().catch(() => ({})),
    },
    json: (data, status = 200, extraHeaders = {}) =>
      new Response(JSON.stringify(data), {
        status,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
          ...extraHeaders,
        },
      }),
  };
  return handle(c, env);
}
