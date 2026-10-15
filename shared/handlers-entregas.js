import { estabelecimentoId, httpError, now } from './util.js';
import { chamarEntregas } from './entregas-bridge.js';

export async function entregasDaLojaHandler(c, env) {
  const id = estabelecimentoId(env);
  const orders = await chamarEntregas(env, `/api/integration/stores/${id}/orders`);
  for (const order of orders) {
    const match = /^PEDIDO-ONLINE-(\d+)$/.exec(order.reference || '');
    if (!match || !['in_transit', 'delivered'].includes(order.status)) continue;
    await env.DB.prepare(`UPDATE pedidos_online SET etapa=?,atualizado_em=?
      WHERE id=? AND entrega_plataforma=1 AND entrega_externa_id=? AND status!='cancelado' AND etapa!='entregue'`)
      .bind(order.status === 'delivered' ? 'entregue' : 'saiu_entrega', now(), Number(match[1]), order.id).run();
  }
  return c.json({ orders });
}

export async function acaoEntregaDaLojaHandler(c, env) {
  const id = estabelecimentoId(env);
  const orderId = String(c.params.id || '');
  const action = String(c.params.action || '');
  if (!/^[a-f0-9-]{36}$/i.test(orderId) || !['ready', 'pickup', 'cancel', 'report'].includes(action)) throw httpError(400, 'Entrega ou ação inválida.');
  const body = await c.req.json().catch(() => ({}));
  const order = await chamarEntregas(env, `/api/integration/stores/${id}/orders/${orderId}/${action}`, { method: 'POST', body });
  if (action === 'pickup' && order.status === 'in_transit') {
    const match = /^PEDIDO-ONLINE-(\d+)$/.exec(order.reference || '');
    if (match) await env.DB.prepare(`UPDATE pedidos_online SET etapa='saiu_entrega',atualizado_em=?
      WHERE id=? AND entrega_plataforma=1 AND entrega_externa_id=? AND status!='cancelado' AND etapa!='entregue'`)
      .bind(now(), Number(match[1]), order.id).run();
  }
  return c.json(order);
}
