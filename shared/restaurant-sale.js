import { estabelecimentoId, httpError, now, num } from './util.js';
import { quantidadeEmUnidadesEstoque } from './units.js';

// Uma leitura carrega o grafo da receita. Repetir 50 drinks não deve fazer
// 50 viagens ao banco para buscar os mesmos três ingredientes.
async function planejarVenda(env, itens) {
  const escolhasDe = (item) => {
    if (!item.combo_escolhas_json) return [];
    try {
      const grupos = JSON.parse(item.combo_escolhas_json);
      if (!Array.isArray(grupos) || !grupos.every(Array.isArray)) throw new Error();
      const ids = grupos.flat().map(Number);
      if (ids.some((id) => !Number.isInteger(id) || id <= 0)) throw new Error();
      return ids;
    } catch { throw httpError(400, 'Escolhas do combo inválidas'); }
  };
  const ids = [...new Set(itens.flatMap((item) => [item.produto_id, ...escolhasDe(item)]).filter(Boolean))];
  const rows = await env.DB.prepare(`WITH RECURSIVE receita_ids(id) AS (
    SELECT CAST(value AS INTEGER) FROM json_each(?)
    UNION
    SELECT f.insumo_id FROM ficha_tecnica f JOIN receita_ids r ON r.id=f.produto_id
  ) SELECT p.*, (SELECT json_group_array(json_object('insumo_id',f.insumo_id,'quantidade',f.quantidade,'unidade',f.unidade))
    FROM ficha_tecnica f WHERE f.produto_id=p.id) AS ficha_json
    FROM produtos p JOIN receita_ids r ON r.id=p.id`).bind(JSON.stringify(ids)).all();
  const produtos = new Map(rows.results.map((p) => [p.id, { ...p, ficha: JSON.parse(p.ficha_json || '[]') }]));
  const cache = new Map();
  const folhasDe = (id, caminho = []) => {
    if (caminho.includes(id)) throw httpError(400, 'Ficha técnica circular: um produto não pode depender dele mesmo');
    if (cache.has(id)) return cache.get(id);
    const p = produtos.get(id);
    if (!p) throw httpError(400, 'Produto não encontrado na ficha técnica');
    if (p.tipo === 'combo') throw httpError(400, 'Um combo não pode compor outro combo');
    if (p.tipo !== 'composto') return [{ produto_id: p.id, quantidade: 1 }];
    if (!p.ficha.length) throw httpError(400, `Produto composto sem ficha técnica: ${p.nome}`);
    const total = new Map();
    for (const ing of p.ficha) {
      const insumo = produtos.get(ing.insumo_id);
      if (!insumo) throw httpError(400, 'Insumo não encontrado na ficha técnica');
      const q = quantidadeEmUnidadesEstoque(ing.quantidade, ing.unidade, insumo.unidade, insumo.conteudo_quantidade, insumo.conteudo_unidade);
      if (q === null || !Number.isFinite(q) || q <= 0) throw httpError(400, `Unidade ou quantidade incompatível na ficha de ${p.nome}`);
      for (const folha of folhasDe(insumo.id, [...caminho, id])) {
        total.set(folha.produto_id, (total.get(folha.produto_id) || 0) + folha.quantidade * q);
      }
    }
    const folhas = [...total].map(([produto_id, quantidade]) => ({ produto_id, quantidade }));
    cache.set(id, folhas);
    return folhas;
  };
  const baixas = new Map();
  const linhas = itens.map((it) => {
    const p = produtos.get(it.produto_id);
    if (p?.tipo === 'combo' && !it.combo_escolhas_json) throw httpError(400, 'Combo sem escolhas registradas');
    const comboIds = p?.tipo === 'combo' ? escolhasDe(it) : [];
    if (p?.tipo === 'combo' && !comboIds.length) throw httpError(400, 'Combo sem produtos escolhidos');
    const folhas = p?.tipo === 'combo' ? comboIds.flatMap((id) => folhasDe(id)) : p ? folhasDe(p.id) : [];
    for (const folha of folhas) {
      const insumo = produtos.get(folha.produto_id);
      const baixa = baixas.get(insumo.id) || { produto_id: insumo.id, nome: insumo.nome, quantidade: 0,
        custo_unitario: num(insumo.custo), disponivel: num(insumo.estoque_atual), verificar: false, receita_direta: 0, descricoes: new Set() };
      baixa.quantidade += folha.quantidade * num(it.quantidade);
      baixa.verificar ||= p.tipo === 'composto' || p.tipo === 'combo';
      if (p.id === insumo.id) baixa.receita_direta += num(it.quantidade) * num(it.preco_unitario);
      baixa.descricoes.add(p.nome);
      baixas.set(insumo.id, baixa);
    }
    const custoCombo = folhas.reduce((s, folha) => s + folha.quantidade * num(produtos.get(folha.produto_id)?.custo), 0);
    return { produto_id: it.produto_id ?? null, nome: it.nome, quantidade: num(it.quantidade),
      custo_unitario: p?.tipo === 'combo' ? custoCombo : it.custo_unitario ?? num(p?.custo), preco_unitario: num(it.preco_unitario), total: it.total,
      combo_escolhas_json: it.combo_escolhas_json || null };
  });
  for (const baixa of baixas.values()) {
    if (baixa.verificar && baixa.disponivel < baixa.quantidade - 0.0001) {
      throw httpError(400, `Estoque insuficiente de ${baixa.nome}: necessário ${Number(baixa.quantidade.toFixed(6))}, disponível ${baixa.disponivel}`);
    }
  }
  return { linhas, baixas: [...baixas.values()].map((b) => ({ ...b,
    preco_unitario: b.verificar ? null : b.receita_direta / b.quantidade,
    descricoes: [...b.descricoes].join(', '),
  })) };
}

export async function criarVendaRestaurante(env, o, concluir = []) {
  const tenant = estabelecimentoId(env);
  const { linhas, baixas } = await planejarVenda(env, o.itens);
  const timestamp = now();
  // O lote é uma transação: nenhuma venda de outra requisição se intercala.
  // MAX(id) sempre identifica a venda que a primeira gravação acabou de criar.
  const vendaId = '(SELECT MAX(id) FROM vendas)';
  const statements = [...(env.fechamentoValidacoes || [])];
  if (env.fechamentoReserva) {
    // SQLite só permite RAISE em triggers. Um erro deliberado de overflow
    // aborta o batch inteiro se a reserva de fechamento tiver sido perdida.
    statements.push(env.DB.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM comandas
      WHERE id=? AND fechamento_bloqueado_ate=? AND status IN ('aberta','pre_fechamento'))
      THEN 1 ELSE abs(-9223372036854775808) END`).bind(o.comanda_id, env.fechamentoReserva));
  }
  // Valida novamente DENTRO da transação, protegendo o estoque compartilhado
  // quando duas mesas fecham simultaneamente. JSON inválido aborta sem gravar.
  statements.push(env.DB.prepare(`SELECT json(CASE WHEN EXISTS (
    SELECT 1 FROM json_each(?) j LEFT JOIN produtos p ON p.id=json_extract(j.value,'$.produto_id')
    WHERE json_extract(j.value,'$.verificar')=1 AND
      (p.id IS NULL OR p.estoque_atual<json_extract(j.value,'$.quantidade')-0.0001)
    ) THEN 'estoque_alterado' ELSE '[]' END)`).bind(JSON.stringify(baixas)));
  const vendaIndex = statements.length;
  statements.push(env.DB.prepare(`INSERT INTO vendas
    (numero,tipo,comanda_id,mesa_id,subtotal,desconto,taxa_servico,total,status,funcionario,responsavel,observacoes,criado_em)
    VALUES (?,?,?,?,?,?,?,?,'concluida',?,?,?,?)`)
    .bind(o.numero, o.tipo, o.comanda_id, o.mesa_id, o.subtotal, o.desconto, o.taxa_servico, o.total,
      o.responsavel, o.responsavel, o.observacoes || null, timestamp));
  statements.push(env.DB.prepare(`INSERT INTO venda_itens
    (estabelecimento_id,venda_id,produto_id,nome,quantidade,custo_unitario,preco_unitario,total,combo_escolhas_json)
    SELECT ?,${vendaId},json_extract(value,'$.produto_id'),json_extract(value,'$.nome'),json_extract(value,'$.quantidade'),
      json_extract(value,'$.custo_unitario'),json_extract(value,'$.preco_unitario'),json_extract(value,'$.total'),json_extract(value,'$.combo_escolhas_json') FROM json_each(?)`)
    .bind(tenant, JSON.stringify(linhas)));
  statements.push(env.DB.prepare(`UPDATE produtos SET estoque_atual=estoque_atual-
    (SELECT json_extract(value,'$.quantidade') FROM json_each(?) WHERE json_extract(value,'$.produto_id')=produtos.id)
    WHERE id IN (SELECT json_extract(value,'$.produto_id') FROM json_each(?))`)
    .bind(JSON.stringify(baixas), JSON.stringify(baixas)));
  statements.push(env.DB.prepare(`INSERT INTO estoque_movimentacoes
    (estabelecimento_id,produto_id,tipo,quantidade,saldo_apos,custo_unitario,preco_unitario,origem,ref_id,responsavel,observacoes,criado_em)
    SELECT ?,p.id,'saida',json_extract(j.value,'$.quantidade'),p.estoque_atual,json_extract(j.value,'$.custo_unitario'),
      json_extract(j.value,'$.preco_unitario'),'venda',${vendaId},?,? || json_extract(j.value,'$.descricoes'),?
    FROM json_each(?) j JOIN produtos p ON p.id=json_extract(j.value,'$.produto_id')`)
    .bind(tenant, o.responsavel, `Venda ${o.numero} · `, timestamp, JSON.stringify(baixas)));
  statements.push(env.DB.prepare(`INSERT INTO pagamentos (estabelecimento_id,venda_id,forma,valor)
    SELECT ?,${vendaId},COALESCE(json_extract(value,'$.forma'),'dinheiro'),json_extract(value,'$.valor') FROM json_each(?)`)
    .bind(tenant, JSON.stringify(o.pagamentos)));
  statements.push(env.DB.prepare(`INSERT INTO lancamentos (data,tipo,categoria,descricao,valor,metodo,ref_tipo,ref_id,criado_em)
    VALUES (?,'receita','Venda',?,?,?,'venda',${vendaId},?)`)
    .bind(timestamp, `Venda ${o.numero}`, o.total, o.pagamentos[0]?.forma || 'dinheiro', timestamp));
  statements.push(env.DB.prepare(`INSERT INTO caixa (data,tipo,valor,metodo,observacao,funcionario,criado_em)
    VALUES (?,'entrada',?,?,?,?,?)`)
    .bind(timestamp, o.total, o.pagamentos.map((p) => p.forma).join('+'), `Venda ${o.numero}`, o.responsavel, timestamp));
  statements.push(...concluir);
  let results;
  try { results = await env.DB.batch(statements); }
  catch (error) {
    if (/malformed JSON/i.test(error.message)) throw httpError(400, 'Estoque insuficiente: o saldo mudou durante o fechamento. Atualize e confira os insumos.');
    if (/integer overflow/i.test(error.message)) throw httpError(409, 'A reserva do fechamento mudou. Atualize a comanda antes de tentar novamente.');
    throw error;
  }
  return { id: results[vendaIndex].meta.last_row_id, numero: o.numero, total: o.total };
}
