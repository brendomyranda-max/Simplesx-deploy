import { now, hoje, num, diasAte, addDays, criarPerda, registrarLancamento, registrarCaixa, registrarMovimentacao } from './util.js';

// ============================ PERDAS ============================

export async function listPerdasHandler(c, env) {
  const de = c.req.query('de') || '';
  const ate = c.req.query('ate') || '';
  let sql =
    `SELECT pe.*, p.nome AS produto_nome, p.codigo_interno, p.unidade,
     vi.venda_id, v.numero AS venda_numero, v.tipo AS venda_tipo
     FROM perdas pe LEFT JOIN produtos p ON p.id=pe.produto_id
     LEFT JOIN venda_itens vi ON vi.id=pe.item_id LEFT JOIN vendas v ON v.id=vi.venda_id`;
  const where = [];
  const params = [];
  if (de) {
    where.push("date(datetime(pe.criado_em, '-3 hours')) >= ?");
    params.push(de);
  }
  if (ate) {
    where.push("date(datetime(pe.criado_em, '-3 hours')) <= ?");
    params.push(ate);
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
  const rows = await env.DB.prepare("SELECT * FROM caixa WHERE date(datetime(data, '-3 hours'))=? ORDER BY id DESC").bind(data).all();
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

// ============================ FECHAMENTO DE CAIXA ============================

const FORMAS_CAIXA = ['dinheiro', 'pix', 'credito', 'debito', 'vale', 'boleto', 'outro'];

async function calcularResumoFechamento(env, data) {
  const vendasRes = await env.DB.prepare(
    `SELECT v.id, v.numero, v.tipo, v.status, v.total, v.criado_em,
     p.forma, p.valor AS pagamento_valor
     FROM vendas v LEFT JOIN pagamentos p ON p.venda_id=v.id
     WHERE date(datetime(v.criado_em, '-3 hours'))=? ORDER BY v.id, p.id`
  ).bind(data).all();
  const vendas = new Map();
  for (const row of vendasRes.results) {
    if (!vendas.has(row.id)) vendas.set(row.id, { id: row.id, numero: row.numero, tipo: row.tipo, status: row.status, total: num(row.total), criado_em: row.criado_em, pagamentos: [] });
    if (row.forma) vendas.get(row.id).pagamentos.push({ forma: row.forma, valor: num(row.pagamento_valor) });
  }
  const formas = Object.fromEntries(FORMAS_CAIXA.map((forma) => [forma, 0]));
  let vendasMercado = 0, totalMercado = 0, vendasRestaurante = 0, totalRestaurante = 0, canceladas = 0;
  const detalhes = [];
  for (const venda of vendas.values()) {
    if (venda.status === 'cancelada') { canceladas++; detalhes.push(venda); continue; }
    if (venda.tipo === 'pdv') { vendasMercado++; totalMercado += venda.total; }
    else { vendasRestaurante++; totalRestaurante += venda.total; }
    const pago = venda.pagamentos.reduce((s, p) => s + p.valor, 0);
    const troco = Math.max(0, pago - venda.total);
    let trocoRestante = troco;
    for (const pg of venda.pagamentos) {
      const forma = FORMAS_CAIXA.includes(pg.forma) ? pg.forma : 'outro';
      const desconta = forma === 'dinheiro' ? Math.min(trocoRestante, pg.valor) : 0;
      formas[forma] += pg.valor - desconta;
      trocoRestante -= desconta;
    }
    detalhes.push(venda);
  }
  const caixaRes = await env.DB.prepare("SELECT * FROM caixa WHERE date(datetime(data, '-3 hours'))=?").bind(data).all();
  const entradas = caixaRes.results.filter((x) => x.tipo === 'entrada').reduce((s, x) => s + num(x.valor), 0);
  const saidas = caixaRes.results.filter((x) => x.tipo === 'saida').reduce((s, x) => s + num(x.valor), 0);
  const totalVendas = totalMercado + totalRestaurante;
  return {
    data, vendas_mercado: vendasMercado, total_mercado: totalMercado,
    vendas_restaurante: vendasRestaurante, total_restaurante: totalRestaurante,
    vendas_canceladas: canceladas, total_vendas: totalVendas, formas,
    entradas, saidas, saldo_caixa: entradas - saidas, vendas: detalhes,
  };
}

export async function resumoFechamentoCaixaHandler(c, env) {
  return c.json(await calcularResumoFechamento(env, c.req.query('data') || hoje()));
}

export async function listFechamentosCaixaHandler(c, env) {
  const rows = await env.DB.prepare('SELECT * FROM fechamentos_caixa ORDER BY data DESC, id DESC LIMIT 100').all();
  return c.json(rows.results);
}

export async function createFechamentoCaixaHandler(c, env) {
  const b = await c.req.json();
  const data = b.data || hoje();
  const resumo = await calcularResumoFechamento(env, data);
  const justificativa = String(b.justificativa || '').trim();
  const pendentes = resumo.vendas.filter((v) => v.status === 'aguardando_fechamento');
  const confirmadas = new Set((Array.isArray(b.vendas_confirmadas) ? b.vendas_confirmadas : pendentes.map((v) => v.id)).map(num));
  const rejeitadas = pendentes.filter((v) => !confirmadas.has(v.id));
  if (rejeitadas.length && justificativa.length < 5) {
    return c.json({ error: 'Justifique as operações marcadas como não realizadas' }, 400);
  }
  const formasConfirmadas = { ...resumo.formas };
  for (const venda of rejeitadas) {
    const pago = venda.pagamentos.reduce((s, p) => s + p.valor, 0);
    let troco = Math.max(0, pago - venda.total);
    for (const pg of venda.pagamentos) {
      const forma = FORMAS_CAIXA.includes(pg.forma) ? pg.forma : 'outro';
      const desconta = forma === 'dinheiro' ? Math.min(troco, pg.valor) : 0;
      formasConfirmadas[forma] -= pg.valor - desconta;
      troco -= desconta;
    }
  }
  const informados = b.valores && typeof b.valores === 'object' ? b.valores : {};
  const itens = FORMAS_CAIXA.map((forma) => ({ forma, esperado: num(formasConfirmadas[forma]), informado: num(informados[forma]) }));
  const totalEsperado = itens.reduce((s, x) => s + x.esperado, 0);
  const totalInformado = itens.reduce((s, x) => s + x.informado, 0);
  const diferenca = Math.round((totalInformado - totalEsperado) * 100) / 100;
  if (Math.abs(diferenca) >= 0.01 && justificativa.length < 5) {
    return c.json({ error: 'Informe uma justificativa para a diferença do caixa' }, 400);
  }
  for (const venda of pendentes) {
    if (confirmadas.has(venda.id)) {
      await env.DB.prepare("UPDATE vendas SET status='concluida' WHERE id=?").bind(venda.id).run();
      continue;
    }
    await env.DB.prepare("UPDATE vendas SET status='cancelada', observacoes=? WHERE id=?")
      .bind(`Não confirmada no fechamento de caixa: ${justificativa}`, venda.id).run();
    const movs = await env.DB.prepare("SELECT * FROM estoque_movimentacoes WHERE origem='venda' AND ref_id=?").bind(venda.id).all();
    for (const m of movs.results) {
      await env.DB.prepare('UPDATE produtos SET estoque_atual=estoque_atual+? WHERE id=?').bind(m.quantidade, m.produto_id).run();
      const saldo = await env.DB.prepare('SELECT estoque_atual FROM produtos WHERE id=?').bind(m.produto_id).first();
      await registrarMovimentacao(env, { produto_id: m.produto_id, tipo: 'entrada', quantidade: m.quantidade,
        saldo_apos: num(saldo.estoque_atual), custo_unitario: m.custo_unitario, origem: 'estorno', ref_id: venda.id,
        responsavel: b.responsavel || null, observacoes: `Venda ${venda.numero} não confirmada no fechamento` });
    }
    await registrarLancamento(env, { data: now(), tipo: 'despesa', categoria: 'Estorno', descricao: `Venda ${venda.numero} não confirmada`, valor: venda.total, ref_tipo: 'venda', ref_id: venda.id });
    await registrarCaixa(env, { data: now(), tipo: 'saida', valor: venda.total, observacao: `Estorno da venda ${venda.numero}`, funcionario: b.responsavel || null });
  }
  const r = await env.DB.prepare(
    `INSERT INTO fechamentos_caixa (data, vendas_mercado, total_mercado, vendas_restaurante, total_restaurante,
     vendas_canceladas, entradas, saidas, total_esperado, total_informado, diferenca, status, justificativa, responsavel, criado_em)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(data, resumo.vendas_mercado - rejeitadas.filter((v) => v.tipo === 'pdv').length,
    resumo.total_mercado - rejeitadas.filter((v) => v.tipo === 'pdv').reduce((s, v) => s + v.total, 0),
    resumo.vendas_restaurante - rejeitadas.filter((v) => v.tipo !== 'pdv').length,
    resumo.total_restaurante - rejeitadas.filter((v) => v.tipo !== 'pdv').reduce((s, v) => s + v.total, 0),
    resumo.vendas_canceladas, resumo.entradas, resumo.saidas, totalEsperado, totalInformado, diferenca,
    Math.abs(diferenca) < 0.01 ? 'conferido' : 'divergente', justificativa || null, b.responsavel || null, now()).run();
  await env.DB.batch(itens.map((x) => env.DB.prepare(
    'INSERT INTO fechamento_caixa_itens (fechamento_id, forma, esperado, informado, diferenca) VALUES (?,?,?,?,?)'
  ).bind(r.meta.last_row_id, x.forma, x.esperado, x.informado, x.informado - x.esperado)));
  return c.json({ id: r.meta.last_row_id, diferenca, status: Math.abs(diferenca) < 0.01 ? 'conferido' : 'divergente' }, 201);
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
