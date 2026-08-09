import { now, hoje, num, diasAte, addDays, criarPerda, registrarLancamento, registrarCaixa } from './util.js';

// ============================ PERDAS ============================

export async function listPerdasHandler(c, env) {
  const de = c.req.query('de') || '';
  const ate = c.req.query('ate') || '';
  let sql =
    'SELECT pe.*, p.nome AS produto_nome FROM perdas pe LEFT JOIN produtos p ON p.id=pe.produto_id';
  const where = [];
  const params = [];
  if (de) {
    where.push('pe.criado_em >= ?');
    params.push(`${de}T00:00:00`);
  }
  if (ate) {
    where.push('pe.criado_em <= ?');
    params.push(`${ate}T23:59:59`);
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY pe.id DESC LIMIT 300';
  const rows = await env.DB.prepare(sql).bind(...params).all();
  return c.json(rows.results);
}

export async function createPerdaHandler(c, env) {
  const b = await c.req.json();
  if (!b.produto_id) return c.json({ error: 'Produto obrigatório' }, 400);
  const qtd = num(b.quantidade);
  if (qtd <= 0) return c.json({ error: 'Quantidade inválida' }, 400);
  const p = await env.DB.prepare('SELECT * FROM produtos WHERE id=?').bind(b.produto_id).first();
  if (!p) return c.json({ error: 'Produto não encontrado' }, 404);
  const id = await criarPerda(env, {
    produto_id: b.produto_id,
    quantidade: qtd,
    valor_unitario: b.valor_unitario ?? num(p.custo),
    motivo: b.motivo || 'Perda não especificada',
    origem: b.origem || 'quebra',
    responsavel: b.responsavel || null,
  });
  return c.json({ id, ok: true }, 201);
}

// ============================ DESPESAS ============================

export async function listDespesasHandler(c, env) {
  const rows = await env.DB.prepare('SELECT * FROM despesas ORDER BY id DESC LIMIT 300').all();
  return c.json(rows.results);
}

export async function createDespesaHandler(c, env) {
  const b = await c.req.json();
  if (!b.descricao || !num(b.valor)) return c.json({ error: 'Descrição e valor obrigatórios' }, 400);
  const r = await env.DB.prepare(
    'INSERT INTO despesas (descricao, categoria, valor, data, forma_pagamento, funcionario, criado_em) VALUES (?,?,?,?,?,?,?)'
  )
    .bind(b.descricao, b.categoria || null, num(b.valor), b.data || hoje(), b.forma_pagamento || null, b.funcionario || null, now())
    .run();
  await registrarLancamento(env, {
    data: b.data || hoje(),
    tipo: 'despesa',
    categoria: b.categoria || 'Despesa',
    descricao: b.descricao,
    valor: num(b.valor),
    metodo: b.forma_pagamento || null,
    ref_tipo: 'despesa',
    ref_id: r.meta.last_row_id,
  });
  await registrarCaixa(env, {
    data: now(),
    tipo: 'saida',
    valor: num(b.valor),
    metodo: b.forma_pagamento || null,
    observacao: b.descricao,
    funcionario: b.funcionario || null,
  });
  return c.json({ id: r.meta.last_row_id, ...b }, 201);
}

// ============================ CONTAS A PAGAR ============================

export async function listContasPagarHandler(c, env) {
  const rows = await env.DB.prepare('SELECT * FROM contas_pagar ORDER BY data_vencimento').all();
  return c.json(rows.results);
}

export async function createContaPagarHandler(c, env) {
  const b = await c.req.json();
  if (!b.descricao || !num(b.valor)) return c.json({ error: 'Descrição e valor obrigatórios' }, 400);
  const r = await env.DB.prepare(
    'INSERT INTO contas_pagar (descricao, fornecedor, valor, data_vencimento, status, criado_em) VALUES (?,?,?,?,?,?)'
  )
    .bind(b.descricao, b.fornecedor || null, num(b.valor), b.data_vencimento || hoje(), 'pendente', now())
    .run();
  return c.json({ id: r.meta.last_row_id, ...b }, 201);
}

export async function pagarContaHandler(c, env) {
  const conta = await env.DB.prepare('SELECT * FROM contas_pagar WHERE id=?').bind(c.params.id).first();
  if (!conta) return c.json({ error: 'Conta não encontrada' }, 404);
  await env.DB.prepare("UPDATE contas_pagar SET status='paga', paga_em=? WHERE id=?").bind(now(), conta.id).run();
  await registrarLancamento(env, {
    data: now(),
    tipo: 'despesa',
    categoria: 'Conta a pagar',
    descricao: conta.descricao,
    valor: num(conta.valor),
    metodo: c.req.query('metodo') || null,
    ref_tipo: 'conta_pagar',
    ref_id: conta.id,
  });
  await registrarCaixa(env, {
    data: now(),
    tipo: 'saida',
    valor: num(conta.valor),
    metodo: c.req.query('metodo') || null,
    observacao: conta.descricao,
    funcionario: null,
  });
  return c.json({ ok: true });
}

// ============================ CONTAS A RECEBER ============================

export async function listContasReceberHandler(c, env) {
  const rows = await env.DB.prepare('SELECT * FROM contas_receber ORDER BY data_vencimento').all();
  return c.json(rows.results);
}

export async function createContaReceberHandler(c, env) {
  const b = await c.req.json();
  if (!b.descricao || !num(b.valor)) return c.json({ error: 'Descrição e valor obrigatórios' }, 400);
  const r = await env.DB.prepare(
    'INSERT INTO contas_receber (descricao, cliente, valor, data_vencimento, status, criado_em) VALUES (?,?,?,?,?,?)'
  )
    .bind(b.descricao, b.cliente || null, num(b.valor), b.data_vencimento || hoje(), 'pendente', now())
    .run();
  return c.json({ id: r.meta.last_row_id, ...b }, 201);
}

export async function receberContaHandler(c, env) {
  const conta = await env.DB.prepare('SELECT * FROM contas_receber WHERE id=?').bind(c.params.id).first();
  if (!conta) return c.json({ error: 'Conta não encontrada' }, 404);
  await env.DB.prepare("UPDATE contas_receber SET status='recebido', recebido_em=? WHERE id=?").bind(now(), conta.id).run();
  await registrarLancamento(env, {
    data: now(),
    tipo: 'receita',
    categoria: 'Conta a receber',
    descricao: conta.descricao,
    valor: num(conta.valor),
    metodo: c.req.query('metodo') || null,
    ref_tipo: 'conta_receber',
    ref_id: conta.id,
  });
  await registrarCaixa(env, {
    data: now(),
    tipo: 'entrada',
    valor: num(conta.valor),
    metodo: c.req.query('metodo') || null,
    observacao: conta.descricao,
    funcionario: null,
  });
  return c.json({ ok: true });
}

// ============================ LANÇAMENTOS / CAIXA ============================

export async function listLancamentosHandler(c, env) {
  const de = c.req.query('de') || '';
  const ate = c.req.query('ate') || '';
  const tipo = c.req.query('tipo') || '';
  let sql = 'SELECT * FROM lancamentos';
  const where = [];
  const params = [];
  if (de) {
    where.push('data >= ?');
    params.push(`${de}T00:00:00`);
  }
  if (ate) {
    where.push('data <= ?');
    params.push(`${ate}T23:59:59`);
  }
  if (tipo) {
    where.push('tipo=?');
    params.push(tipo);
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY id DESC LIMIT 500';
  const rows = await env.DB.prepare(sql).bind(...params).all();
  return c.json(rows.results);
}

export async function createLancamentoHandler(c, env) {
  const b = await c.req.json();
  if (!b.descricao || !num(b.valor)) return c.json({ error: 'Descrição e valor obrigatórios' }, 400);
  const r = await env.DB.prepare(
    'INSERT INTO lancamentos (data, tipo, categoria, descricao, valor, metodo, criado_em) VALUES (?,?,?,?,?,?,?)'
  )
    .bind(b.data || hoje(), b.tipo || 'despesa', b.categoria || null, b.descricao, num(b.valor), b.metodo || null, now())
    .run();
  await registrarCaixa(env, {
    data: now(),
    tipo: b.tipo === 'receita' ? 'entrada' : 'saida',
    valor: num(b.valor),
    metodo: b.metodo || null,
    observacao: b.descricao,
    funcionario: b.funcionario || null,
  });
  return c.json({ id: r.meta.last_row_id, ...b }, 201);
}

export async function listCaixaHandler(c, env) {
  const data = c.req.query('data') || hoje();
  const rows = await env.DB.prepare('SELECT * FROM caixa WHERE data LIKE ? ORDER BY id DESC').bind(`${data}%`).all();
  return c.json(rows.results);
}

export async function createCaixaHandler(c, env) {
  const b = await c.req.json();
  if (!num(b.valor)) return c.json({ error: 'Valor obrigatório' }, 400);
  const r = await env.DB.prepare(
    'INSERT INTO caixa (data, tipo, valor, metodo, observacao, funcionario, criado_em) VALUES (?,?,?,?,?,?,?)'
  )
    .bind(now(), b.tipo || 'entrada', num(b.valor), b.metodo || null, b.observacao || null, b.funcionario || null, now())
    .run();
  return c.json({ id: r.meta.last_row_id, ...b }, 201);
}

// ============================ RELATÓRIOS ============================

export async function resumoRelatorioHandler(c, env) {
  const de = c.req.query('de') || `${hoje()}T00:00:00`;
  const ate = c.req.query('ate') || `${hoje()}T23:59:59`;

  const vendas = await env.DB.prepare(
    "SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM vendas WHERE status='concluida' AND criado_em BETWEEN ? AND ?"
  )
    .bind(`${de}T00:00:00`, `${ate}T23:59:59`)
    .first();
  const custoVendido = await env.DB.prepare(
    `SELECT COALESCE(SUM(vi.custo_unitario * vi.quantidade),0) s FROM venda_itens vi
     JOIN vendas v ON v.id=vi.venda_id WHERE v.status='concluida' AND v.criado_em BETWEEN ? AND ?`
  )
    .bind(`${de}T00:00:00`, `${ate}T23:59:59`)
    .first();
  const despesas = await env.DB.prepare(
    "SELECT COALESCE(SUM(valor),0) s FROM lancamentos WHERE tipo='despesa' AND data BETWEEN ? AND ?"
  )
    .bind(`${de}T00:00:00`, `${ate}T23:59:59`)
    .first();
  const outrasReceitas = await env.DB.prepare(
    "SELECT COALESCE(SUM(valor),0) s FROM lancamentos WHERE tipo='receita' AND data BETWEEN ? AND ? AND (categoria IS NULL OR categoria!='Venda')"
  )
    .bind(`${de}T00:00:00`, `${ate}T23:59:59`)
    .first();
  const perdas = await env.DB.prepare(
    "SELECT COALESCE(SUM(quantidade * valor_unitario),0) s FROM perdas WHERE criado_em BETWEEN ? AND ?"
  )
    .bind(`${de}T00:00:00`, `${ate}T23:59:59`)
    .first();

  const receita = num(vendas.s) + num(outrasReceitas.s);
  const cmv = num(custoVendido.s) + num(perdas.s);
  const lucroBruto = receita - cmv;
  const lucroLiquido = lucroBruto - num(despesas.s);
  const margem = receita > 0 ? (lucroBruto / receita) * 100 : 0;
  const cmvPct = receita > 0 ? (cmv / receita) * 100 : 0;

  return c.json({
    vendas_count: num(vendas.c),
    faturamento: receita,
    custo_vendido: num(custoVendido.s),
    despesas: num(despesas.s),
    perdas: num(perdas.s),
    outras_receitas: num(outrasReceitas.s),
    cmv,
    cmv_pct: cmvPct,
    lucro_bruto: lucroBruto,
    lucro_liquido: lucroLiquido,
    margem_pct: margem,
    ticket_medio: num(vendas.c) > 0 ? receita / num(vendas.c) : 0,
  });
}

export async function maisVendidosHandler(c, env) {
  const de = c.req.query('de') || `${hoje()}T00:00:00`;
  const ate = c.req.query('ate') || `${hoje()}T23:59:59`;
  const rows = await env.DB.prepare(
    `SELECT vi.produto_id, vi.nome, SUM(vi.quantidade) qtd, SUM(vi.total) total
     FROM venda_itens vi JOIN vendas v ON v.id=vi.venda_id
     WHERE v.status='concluida' AND v.criado_em BETWEEN ? AND ?
     GROUP BY vi.produto_id, vi.nome ORDER BY qtd DESC LIMIT 20`
  )
    .bind(`${de}T00:00:00`, `${ate}T23:59:59`)
    .all();
  return c.json(rows.results);
}

export async function estoqueBaixoHandler(c, env) {
  const rows = await env.DB.prepare(
    `SELECT p.*, f.nome AS fornecedor_nome FROM produtos p LEFT JOIN fornecedores f ON f.id=p.fornecedor_id
     WHERE p.ativo=1 AND p.estoque_atual <= p.estoque_minimo ORDER BY (p.estoque_atual - p.estoque_minimo) ASC`
  ).all();
  return c.json(rows.results);
}

export async function vencimentosRelatorioHandler(c, env) {
  const dias = c.req.query('dias') || '';
  const limite = dias ? addDays(now(), num(dias)) : addDays(now(), 9999);
  const rows = await env.DB.prepare(
    `SELECT v.*, p.nome AS produto_nome, p.unidade FROM validade_controles v JOIN produtos p ON p.id=v.produto_id
     WHERE v.status='ativo' AND v.data_vencimento <= ? ORDER BY v.data_vencimento`
  )
    .bind(limite)
    .all();
  return c.json(rows.results);
}

export async function perdasRelatorioHandler(c, env) {
  const de = c.req.query('de') || `${hoje()}T00:00:00`;
  const ate = c.req.query('ate') || `${hoje()}T23:59:59`;
  const rows = await env.DB.prepare(
    `SELECT origem, motivo, COUNT(*) qtd, COALESCE(SUM(quantidade),0) unidades, COALESCE(SUM(quantidade * valor_unitario),0) valor
     FROM perdas WHERE criado_em BETWEEN ? AND ? GROUP BY origem, motivo ORDER BY valor DESC`
  )
    .bind(`${de}T00:00:00`, `${ate}T23:59:59`)
    .all();
  return c.json(rows.results);
}

export async function vendasPorDiaHandler(c, env) {
  const de = c.req.query('de') || addDays(hoje(), -30);
  const ate = c.req.query('ate') || hoje();
  const rows = await env.DB.prepare(
    `SELECT substr(criado_em, 1, 10) dia, COUNT(*) vendas, COALESCE(SUM(total),0) total
     FROM vendas WHERE status='concluida' AND criado_em BETWEEN ? AND ? GROUP BY dia ORDER BY dia`
  )
    .bind(`${de}T00:00:00`, `${ate}T23:59:59`)
    .all();
  return c.json(rows.results);
}

export async function lucroPorCategoriaHandler(c, env) {
  const de = c.req.query('de') || `${hoje()}T00:00:00`;
  const ate = c.req.query('ate') || `${hoje()}T23:59:59`;
  const rows = await env.DB.prepare(
    `SELECT COALESCE(c.nome, 'Sem categoria') categoria,
       COALESCE(SUM(vi.total),0) faturamento,
       COALESCE(SUM(vi.custo_unitario * vi.quantidade),0) custo,
       COALESCE(SUM(vi.total - vi.custo_unitario * vi.quantidade),0) lucro,
       COUNT(DISTINCT vi.venda_id) vendas
     FROM venda_itens vi
     JOIN vendas v ON v.id=vi.venda_id
     LEFT JOIN produto_categorias pc ON pc.produto_id=vi.produto_id
     LEFT JOIN categorias c ON c.id=pc.categoria_id
     WHERE v.status='concluida' AND v.criado_em BETWEEN ? AND ?
     GROUP BY c.id, c.nome ORDER BY lucro DESC`
  )
    .bind(`${de}T00:00:00`, `${ate}T23:59:59`)
    .all();
  return c.json(rows.results);
}

export async function vendasPorFuncionarioHandler(c, env) {
  const de = c.req.query('de') || `${hoje()}T00:00:00`;
  const ate = c.req.query('ate') || `${hoje()}T23:59:59`;
  const rows = await env.DB.prepare(
    `SELECT COALESCE(NULLIF(v.funcionario, ''), 'Não informado') funcionario,
       COUNT(*) vendas,
       COALESCE(SUM(v.total),0) faturamento,
       CASE WHEN COUNT(*)>0 THEN COALESCE(SUM(v.total),0)/COUNT(*) ELSE 0 END ticket
     FROM vendas v
     WHERE v.status='concluida' AND v.criado_em BETWEEN ? AND ?
     GROUP BY v.funcionario ORDER BY faturamento DESC`
  )
    .bind(`${de}T00:00:00`, `${ate}T23:59:59`)
    .all();
  return c.json(rows.results);
}
