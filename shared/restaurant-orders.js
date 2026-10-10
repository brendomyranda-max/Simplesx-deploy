import { estabelecimentoId, getProdutoFull, buscarProdutoPorCodigo, httpError, now, sha256 } from './util.js';
import { idsAcrescimo, observacaoComAcrescimos, precoComAcrescimos, selecionarAcrescimos } from './acrescimos.js';

// A chave pertence à intenção do cliente e sobrevive a timeout/reenvio.
export async function saveOrderItems(c, env, body) {
  const tenant = estabelecimentoId(env);
  const key = String(body?.chave || '').trim();
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(key)) throw httpError(400, 'Identificador do lançamento inválido');
  if (!Array.isArray(body?.itens) || !body.itens.length || body.itens.length > 50) throw httpError(400, 'Envie de 1 a 50 itens por lançamento');
  const input = body.itens.map((b) => ({
    produto_id: b.produto_id == null ? null : Number(b.produto_id), codigo: String(b.codigo || ''),
    nome: String(b.nome || '').trim(), quantidade: b.quantidade == null ? 1 : Number(b.quantidade),
    preco_unitario: b.preco_unitario == null ? null : Number(b.preco_unitario),
    pessoa_id: b.pessoa_id == null ? null : Number(b.pessoa_id), observacao: String(b.observacao || '').trim(),
    acrescimos: idsAcrescimo(b.acrescimos),
  }));
  for (const b of input) {
    if (!Number.isFinite(b.quantidade) || b.quantidade <= 0 || b.quantidade > 10000 ||
      (b.preco_unitario !== null && (!Number.isFinite(b.preco_unitario) || b.preco_unitario < 0)) ||
      (b.produto_id !== null && (!Number.isInteger(b.produto_id) || b.produto_id <= 0)) ||
      (b.pessoa_id !== null && (!Number.isInteger(b.pessoa_id) || b.pessoa_id <= 0)) ||
      b.observacao.length > 4000 || b.nome.length > 200) throw httpError(400, 'Dados do item inválidos');
  }
  const hash = await sha256(JSON.stringify({ comanda: Number(c.params.id), funcionario: c.user.id, itens: input }));
  const previous = () => env.DB.prepare('SELECT * FROM comanda_lancamentos WHERE chave=?').bind(key).first();
  const replay = async (saved) => {
    if (saved.conteudo_hash !== hash) throw httpError(409, 'Este identificador já foi usado em outro lançamento');
    const rows = await env.DB.prepare('SELECT * FROM comanda_itens WHERE lancamento_id=? ORDER BY id').bind(saved.id).all();
    return { itens: rows.results, repetido: true };
  };
  const saved = await previous();
  if (saved) return replay(saved);

  const command = await env.DB.prepare("SELECT id FROM comandas WHERE id=? AND status='aberta' AND comanda_origem_id IS NULL").bind(c.params.id).first();
  if (!command) throw httpError(409, 'A comanda não está aberta para novos pedidos');
  const items = [];
  for (const b of input) {
    const product = b.produto_id ? await getProdutoFull(env, b.produto_id) : b.codigo ? await buscarProdutoPorCodigo(env, b.codigo) : null;
    if ((b.produto_id || b.codigo) && (!product || !product.ativo)) throw httpError(400, 'Produto não encontrado ou inativo');
    const escolhidos = selecionarAcrescimos(b.acrescimos, product?.acrescimos || []);
    const preco = escolhidos.length
      ? precoComAcrescimos(product?.preco, escolhidos)
      : (b.preco_unitario ?? Number(product?.preco || 0));
    const observacao = escolhidos.length ? observacaoComAcrescimos(b.observacao, escolhidos) : b.observacao;
    items.push({
      ...b,
      produto_id: product?.id ?? null,
      nome: b.nome || product?.nome || 'Item avulso',
      preco_unitario: preco,
      observacao,
    });
  }
  const id = crypto.randomUUID();
  const timestamp = now();
  const db = env.rawDB;
  const data = JSON.stringify(items);
  const results = await db.batch([
    db.prepare(`INSERT INTO comanda_lancamentos (id,estabelecimento_id,chave,conteudo_hash,comanda_id,funcionario_id,criado_em)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM comandas c WHERE c.id=? AND c.estabelecimento_id=?
        AND c.status='aberta' AND c.comanda_origem_id IS NULL AND (c.fechamento_bloqueado_ate IS NULL OR c.fechamento_bloqueado_ate<=?))
      AND NOT EXISTS (SELECT 1 FROM json_each(?) j WHERE
        (json_extract(j.value,'$.pessoa_id') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM comanda_pessoas p
          WHERE p.id=json_extract(j.value,'$.pessoa_id') AND p.comanda_id=? AND p.estabelecimento_id=? AND p.status='pendente'))
        OR (json_extract(j.value,'$.produto_id') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM produtos p
          WHERE p.id=json_extract(j.value,'$.produto_id') AND p.estabelecimento_id=? AND p.ativo=1)))
      ON CONFLICT(estabelecimento_id,chave) DO NOTHING`)
      .bind(id, tenant, key, hash, command.id, c.user.id, timestamp, command.id, tenant, timestamp, data, command.id, tenant, tenant),
    db.prepare(`INSERT INTO comanda_itens
      (estabelecimento_id,comanda_id,pessoa_id,produto_id,nome,quantidade,preco_unitario,observacao,status,responsavel,criado_em,lancamento_id,funcionario_id)
      SELECT ?,?,json_extract(j.value,'$.pessoa_id'),json_extract(j.value,'$.produto_id'),json_extract(j.value,'$.nome'),
        json_extract(j.value,'$.quantidade'),json_extract(j.value,'$.preco_unitario'),NULLIF(json_extract(j.value,'$.observacao'),''),
        'novo',?,?,?,? FROM json_each(?) j WHERE EXISTS (SELECT 1 FROM comanda_lancamentos WHERE id=?)`)
      .bind(tenant, command.id, c.user.nome || `Funcionário ${c.user.id}`, timestamp, id, c.user.id, data, id),
  ]);
  if (!results[0].meta.changes) {
    const raced = await previous();
    if (raced) return replay(raced);
    throw httpError(409, 'A comanda, a pessoa ou o produto mudou. Atualize antes de lançar novamente.');
  }
  const rows = await env.DB.prepare('SELECT * FROM comanda_itens WHERE lancamento_id=? ORDER BY id').bind(id).all();
  return { itens: rows.results, repetido: false };
}

export async function addOrderItemsHandler(c, env) {
  const result = await saveOrderItems(c, env, await c.req.json());
  return c.json(result, result.repetido ? 200 : 201);
}
