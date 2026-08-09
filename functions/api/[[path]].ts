import { handle } from '../../shared/router.js';

export async function onRequest(context) {
  const env = context.env;
  const request = context.request;
  const url = new URL(request.url);
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
    json: (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  };
  return handle(c, env);
}
