/** Cartões identificam o atendimento individual cadastrado na Recepção. */
import { dispatchOrders } from './order-printing.js';
import { saveOrderItems } from './restaurant-orders.js';
import { atendimentoDoCartao } from './recepcao.js';
import { idDoCartao } from './cartao-id.js';
export { idDoCartao } from './cartao-id.js';

async function mesaDoCartao(env, cartao) {
  return env.DB.prepare('SELECT * FROM mesas WHERE nfc_uid=?').bind(cartao).first();
}

async function comandaAtual(env, mesaId) {
  return env.DB.prepare(
    "SELECT id, status FROM comandas WHERE mesa_id=? AND status IN ('aberta','pre_fechamento') ORDER BY id DESC LIMIT 1"
  ).bind(mesaId).first();
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

  const atendimento = await atendimentoDoCartao(env, cartao);
  if (atendimento) {
    let cozinha = null;
    if (acao === 'lancar') {
      const salvo = await saveOrderItems({ params: { id: String(atendimento.comanda_id) }, user: c.user }, env, {
        chave: body.chave,
        itens: Array.isArray(body.itens) ? body.itens.map((item) => ({ ...item, pessoa_id: atendimento.pessoa_id })) : body.itens,
      });
      cozinha = await dispatchOrders(c, env, { comanda_id: atendimento.comanda_id, itens_ids: salvo.itens.map((item) => item.id) });
    }
    return c.json({ ...resposta(cartao, { id: atendimento.mesa_id, numero: atendimento.mesa_numero },
      { id: atendimento.comanda_id, status: atendimento.comanda_status }, cozinha),
      atendimento_id: atendimento.id, pessoa_id: atendimento.pessoa_id, cliente_nome: atendimento.cliente_atual });
  }

  // Uma conta antiga pode ter usado o texto NDEF como chave. Não abra outra
  // conta nem atribua esse saldo a qualquer cartão que tenha o mesmo texto.
  if (body.uid && body.payload && !(await mesaDoCartao(env, cartao))) {
    const legado = String(body.payload).replace(/[\u0000-\u001F\u007F\s]/g, '').toUpperCase();
    if (legado !== cartao && /^[\x21-\x7E]{1,64}$/.test(legado)) {
      const mesaAntiga = await mesaDoCartao(env, legado);
      if (mesaAntiga && await comandaAtual(env, mesaAntiga.id)) {
        return c.json({ error: `Há uma conta antiga no cartão ${legado}, identificado pelo texto gravado. Feche essa conta pela tela Mesas antes de usar o UID do cartão.` }, 409);
      }
    }
  }

  if (acao === 'fechar') {
    const mesa = await mesaDoCartao(env, cartao);
    const comanda = mesa?.ativo ? await comandaAtual(env, mesa.id) : null;
    if (!mesa || !comanda) return c.json({ error: 'Este cartão não tem conta aberta' }, 404);
    return c.json(resposta(cartao, mesa, comanda));
  }

  // Contas anteriores continuam acessíveis, mas novos cartões são cadastrados na Recepção.
  const mesa = await mesaDoCartao(env, cartao);
  const comanda = mesa?.ativo ? await comandaAtual(env, mesa.id) : null;
  if (!comanda) return c.json({ error: 'Cartão sem atendimento. Cadastre o cliente e a mesa na Recepção.', code: 'CARTAO_SEM_ATENDIMENTO' }, 404);
  if (acao === 'lancar' && comanda?.status === 'pre_fechamento') {
    return c.json({ error: 'Este cartão já está em fechamento. Use Fechamento de cartão.' }, 409);
  }
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
