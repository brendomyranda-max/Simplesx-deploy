/**
 * Arquivo: cartao-nfc.js
 * Responsabilidade: Trata o cartão NFC como o número da mesa no pedido e no fechamento.
 */

import { dispatchOrders } from './order-printing.js';
import { saveOrderItems } from './restaurant-orders.js';
import { getConfigValue, httpError, now, num } from './util.js';

export function idDoCartao(body) {
  const payload = String(body?.payload || '').replace(/[\u0000-\u001F\u007F]/g, '').trim();
  const uid = String(body?.uid || '').replace(/[\u0000-\u001F\u007F]/g, '').trim();
  const bruto = (payload || uid).replace(/\s+/g, '');
  if (!/^[\x21-\x7E]{1,64}$/.test(bruto)) throw httpError(400, 'Aproxime um cartão NFC válido');
  return bruto.toUpperCase();
}

async function numeroLivre(env, preferido) {
  const rows = await env.DB.prepare('SELECT numero FROM mesas').all();
  const usados = new Set(rows.results.map((row) => Number(row.numero)));
  if (preferido > 0 && !usados.has(preferido)) return preferido;
  let numero = 1001;
  while (usados.has(numero)) numero += 1;
  return numero;
}

async function mesaDoCartao(env, cartao) {
  return env.DB.prepare('SELECT * FROM mesas WHERE nfc_uid=?').bind(cartao).first();
}

async function criarMesaCartao(env, cartao) {
  const preferido = /^\d{1,6}$/.test(cartao) ? Number(cartao) : 0;
  for (let tentativa = 0; tentativa < 5; tentativa += 1) {
    const numero = await numeroLivre(env, tentativa === 0 ? preferido : 0);
    try {
      const criada = await env.DB.prepare(
        'INSERT INTO mesas (numero, nome, capacidade, setor, status, ativo, criado_em, tipo, nfc_uid) VALUES (?,?,?,?,?,?,?,?,?)'
      ).bind(numero, `Cartão ${cartao}`, 1, 'Cartão', 'livre', 1, now(), 'cartao', cartao).run();
      return env.DB.prepare('SELECT * FROM mesas WHERE id=?').bind(criada.meta.last_row_id).first();
    } catch (error) {
      if (!/unique/i.test(String(error?.message || error))) throw error;
      const existente = await mesaDoCartao(env, cartao);
      if (existente) return existente;
    }
  }
  throw httpError(409, 'Não foi possível registrar o cartão');
}

async function garantirMesa(env, cartao) {
  const existente = await mesaDoCartao(env, cartao);
  if (!existente) return criarMesaCartao(env, cartao);
  if (!existente.ativo) {
    await env.DB.prepare("UPDATE mesas SET ativo=1, tipo='cartao', nome=? WHERE id=?")
      .bind(`Cartão ${cartao}`, existente.id).run();
  }
  return existente;
}

async function comandaAtual(env, mesaId) {
  return env.DB.prepare(
    "SELECT id, status FROM comandas WHERE mesa_id=? AND status IN ('aberta','pre_fechamento') ORDER BY id DESC LIMIT 1"
  ).bind(mesaId).first();
}

async function abrirComanda(env, mesa, garcom) {
  const taxa = num(await getConfigValue(env, 'taxa_garcom_pct', '0'));
  const criada = await env.DB.prepare(
    `INSERT INTO comandas (mesa_id, cliente_nome, garcom_nome, status, taxa_garcom_pct, fechamento_tipo, pessoas_count, criado_em)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(mesa.id, null, garcom || null, 'aberta', taxa, null, 1, now()).run();
  const comandaId = criada.meta.last_row_id;
  await env.DB.prepare('INSERT INTO comanda_pessoas (comanda_id, nome, cor, criado_em) VALUES (?,?,?,?)')
    .bind(comandaId, 'Pessoa 1', '#6366f1', now()).run();
  await env.DB.prepare("UPDATE mesas SET status='ocupada', aberta_em=? WHERE id=?").bind(now(), mesa.id).run();
  return { id: comandaId, status: 'aberta' };
}

function resposta(cartao, mesa, comanda, cozinha = null) {
  return {
    cartao,
    mesa_id: mesa.id,
    mesa_numero: mesa.numero,
    comanda_id: comanda.id,
    comanda_status: comanda.status,
    cozinha,
  };
}

export async function usarCartaoHandler(c, env) {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ error: 'Corpo JSON obrigatório' }, 400);
  const acao = body.acao;
  if (!['abrir', 'lancar', 'fechar'].includes(acao)) return c.json({ error: 'Ação do cartão inválida' }, 400);
  const cartao = idDoCartao(body);
  const garcom = String(body.garcom_nome || '').trim().slice(0, 80);

  if (acao === 'fechar') {
    const mesa = await mesaDoCartao(env, cartao);
    const comanda = mesa?.ativo ? await comandaAtual(env, mesa.id) : null;
    if (!mesa || !comanda) return c.json({ error: 'Este cartão não tem conta aberta' }, 404);
    return c.json(resposta(cartao, mesa, comanda));
  }

  const mesa = await garantirMesa(env, cartao);
  let comanda = await comandaAtual(env, mesa.id);
  if (acao === 'lancar' && comanda?.status === 'pre_fechamento') {
    return c.json({ error: 'Este cartão já está em fechamento. Use Fechamento de cartão.' }, 409);
  }
  if (!comanda) comanda = await abrirComanda(env, mesa, garcom);
  if (acao === 'abrir') return c.json(resposta(cartao, mesa, comanda));

  const salvo = await saveOrderItems({
    params: { id: String(comanda.id) },
    user: c.user,
  }, env, { chave: body.chave, itens: body.itens });
  const cozinha = await dispatchOrders(c, env, {
    comanda_id: comanda.id,
    itens_ids: salvo.itens.map((item) => item.id),
  });
  return c.json(resposta(cartao, mesa, comanda, cozinha));
}
