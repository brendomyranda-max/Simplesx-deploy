import {
  now,
  hoje,
  num,
  addDays,
  diasAte,
  getConfig,
  getConfigValue,
  getProdutoFull,
  buscarProdutoPorCodigo,
  registrarMovimentacao,
  baixarEstoque,
  registrarLancamento,
  registrarCaixa,
  criarPerda,
  gerarNumeroVenda,
  httpError,
} from './util.js';
import { converterQuantidade } from './units.js';

// ============================ VALIDADE ============================

export async function listValidadeHandler(c, env) {
  const status = c.req.query('status') || '';
  const dias = c.req.query('vencendo_dias') || '';
  let sql =
    'SELECT v.*, p.nome AS produto_nome, p.unidade FROM validade_controles v LEFT JOIN produtos p ON p.id=v.produto_id';
  const where = [];
  const params = [];
  if (status) {
    where.push('v.status=?');
    params.push(status);
  }
  if (dias) {
    where.push("v.status='ativo' AND v.data_vencimento <= ?");
    params.push(addDays(now(), num(dias)));
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY v.data_vencimento ASC';
  const rows = await env.DB.prepare(sql).bind(...params).all();
  return c.json(rows.results);
}

export async function criarValidadeHandler(c, env) {
  const b = await c.req.json();
  const p = await env.DB.prepare('SELECT * FROM produtos WHERE id=?').bind(b.produto_id).first();
  if (!p) return c.json({ error: 'Produto não encontrado' }, 404);
  const validadeAberto = b.validade_aberto_dias || p.validade_aberto_dias;
  if (!validadeAberto && !b.data_vencimento) {
    return c.json(
      { error: 'Produto sem validade de aberto definida. Informe a data de vencimento manualmente.' },
      400
    );
  }
  const dataAbertura = b.data_abertura || hoje();
  const dataVencimento = b.data_vencimento || addDays(dataAbertura, num(validadeAberto));
  const r = await env.DB.prepare(
    `INSERT INTO validade_controles (produto_id, tipo, quantidade, data_fabricacao, data_abertura, data_vencimento,
     temperatura, responsavel, observacoes, status, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      b.produto_id,
      b.tipo || 'aberto',
      num(b.quantidade || 1),
      b.data_fabricacao || null,
      dataAbertura,
      dataVencimento,
      b.temperatura || p.temperatura || null,
      b.responsavel || null,
      b.observacoes || null,
      'ativo',
      now()
    )
    .run();
  const id = r.meta.last_row_id;
  const controle = await env.DB.prepare(
    `SELECT v.*, p.nome AS produto_nome, p.unidade, p.marca, p.codigo_interno
     FROM validade_controles v JOIN produtos p ON p.id=v.produto_id WHERE v.id=?`
  )
    .bind(id)
    .first();
  return c.json(controle, 201);
}

export async function concluirValidadeHandler(c, env) {
  await env.DB.prepare("UPDATE validade_controles SET status='concluido' WHERE id=?")
    .bind(c.params.id)
    .run();
  return c.json({ ok: true });
}

export async function descartarValidadeHandler(c, env) {
  const v = await env.DB.prepare('SELECT * FROM validade_controles WHERE id=?').bind(c.params.id).first();
  if (!v) return c.json({ error: 'Controle não encontrado' }, 404);
  await env.DB.prepare("UPDATE validade_controles SET status='vencido' WHERE id=?").bind(c.params.id).run();
  await criarPerda(env, {
    produto_id: v.produto_id,
    quantidade: num(v.quantidade),
    motivo: 'Vencido',
    origem: 'validade',
    responsavel: v.responsavel,
  });
  return c.json({ ok: true });
}

export async function etiquetaValidadeHandler(c, env) {
  const v = await env.DB.prepare(
    `SELECT v.*, p.nome AS produto_nome, p.unidade, p.marca, p.codigo_interno, p.preco,
     (SELECT codigo FROM produto_codigos_barras WHERE produto_id=v.produto_id AND principal=1 LIMIT 1) AS codigo_barras
     FROM validade_controles v JOIN produtos p ON p.id=v.produto_id WHERE v.id=?`
  )
    .bind(c.params.id)
    .first();
  if (!v) return c.json({ error: 'Controle não encontrado' }, 404);
  return c.json(v);
}

// ============================ VENDAS (PDV) ============================

export async function criarVendaHandler(c, env) {
  const b = await c.req.json();
  if (!Array.isArray(b.itens) || !b.itens.length) return c.json({ error: 'Nenhum item na venda' }, 400);
  const config = await getConfig(env);
  const precisaPreco = config.modo_operacao !== 'estoque';

  let subtotal = 0;
  const itensNorm = [];
  for (const it of b.itens) {
    const p = await getProdutoFull(env, it.produto_id);
    if (!p) return c.json({ error: 'Produto não encontrado' }, 404);
    if (!p.ativo) return c.json({ error: `Produto inativo: ${p.nome}` }, 400);
    const qtd = num(it.quantidade);
    if (qtd <= 0) return c.json({ error: 'Quantidade inválida' }, 400);
    if (precisaPreco && !p.preco) {
      return c.json({ error: `Produto sem preço: ${p.nome}` }, 400);
    }
    const preco = num(p.preco) || 0;
    let composto = false;
    if (p.tipo === 'composto' && Array.isArray(p.ficha) && p.ficha.length) {
      // Valida o estoque dos insumos da ficha técnica
      for (const ing of p.ficha) {
        const conv = converterQuantidade(ing.quantidade, ing.unidade, ing.insumo_unidade);
        if (conv === null) {
          return c.json({ error: `Unidade incompatível na ficha de ${p.nome} (${ing.insumo_nome})` }, 400);
        }
        const needed = conv * qtd;
        if (num(ing.insumo_estoque) < needed - 0.0001) {
          return c.json(
            { error: `Estoque insuficiente de ${ing.insumo_nome} para ${qtd}x ${p.nome} (${num(ing.insumo_estoque)} disponível)` },
            400
          );
        }
      }
      composto = true;
    } else if (num(p.estoque_atual) < qtd) {
      return c.json({ error: `Estoque insuficiente para ${p.nome} (${num(p.estoque_atual)} disponível)` }, 400);
    }
    itensNorm.push({ produto: p, qtd, preco, total: preco * qtd, composto });
    subtotal += preco * qtd;
  }

  const desconto = Math.min(num(b.desconto), subtotal);
  const total = Math.max(0, subtotal - desconto);
  const pagamentos = Array.isArray(b.pagamentos) && b.pagamentos.length
    ? b.pagamentos
    : [{ forma: b.forma || 'dinheiro', valor: total }];
  const somaPagtos = pagamentos.reduce((s, pg) => s + num(pg.valor), 0);
  if (somaPagtos + 0.005 < total) {
    return c.json({ error: 'Os pagamentos não cobrem o total da venda' }, 400);
  }

  const numero = await gerarNumeroVenda(env, 'pdv');
  const responsavel = b.responsavel || null;
  const vr = await env.DB.prepare(
    `INSERT INTO vendas (numero, tipo, subtotal, desconto, taxa_servico, total, status, funcionario, responsavel, observacoes, criado_em)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      numero,
      'pdv',
      subtotal,
      desconto,
      0,
      total,
      'concluida',
      responsavel,
      responsavel,
      b.observacoes || null,
      now()
    )
    .run();
  const vendId = vr.meta.last_row_id;

  const stmts = [];
  for (const it of itensNorm) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO venda_itens (venda_id, produto_id, nome, quantidade, custo_unitario, preco_unitario, total)
         VALUES (?,?,?,?,?,?,?)`
      ).bind(vendId, it.produto.id, it.produto.nome, it.qtd, num(it.produto.custo), it.preco, it.total)
    );
    if (it.composto) {
      for (const ing of it.produto.ficha) {
        const conv = converterQuantidade(ing.quantidade, ing.unidade, ing.insumo_unidade);
        const needed = conv * it.qtd;
        stmts.push(
          env.DB.prepare('UPDATE produtos SET estoque_atual = estoque_atual - ? WHERE id=?').bind(needed, ing.insumo_id)
        );
      }
    } else {
      stmts.push(
        env.DB.prepare('UPDATE produtos SET estoque_atual = estoque_atual - ? WHERE id=?').bind(it.qtd, it.produto.id)
      );
    }
  }
  for (const pg of pagamentos) {
    stmts.push(
      env.DB.prepare('INSERT INTO pagamentos (venda_id, forma, valor) VALUES (?,?,?)').bind(
        vendId,
        pg.forma || 'dinheiro',
        num(pg.valor)
      )
    );
  }
  if (stmts.length) await env.DB.batch(stmts);

  for (const it of itensNorm) {
    if (it.composto) {
      for (const ing of it.produto.ficha) {
        const conv = converterQuantidade(ing.quantidade, ing.unidade, ing.insumo_unidade);
        const needed = conv * it.qtd;
        const saldo = await env.DB.prepare('SELECT estoque_atual FROM produtos WHERE id=?').bind(ing.insumo_id).first();
        await registrarMovimentacao(env, {
          produto_id: ing.insumo_id,
          tipo: 'saida',
          quantidade: needed,
          saldo_apos: num(saldo.estoque_atual),
          custo_unitario: num(ing.insumo_custo),
          origem: 'venda',
          ref_id: vendId,
          responsavel,
          observacoes: `Venda ${numero} · ${it.qtd}x ${it.produto.nome}`,
        });
      }
    } else {
      const saldo = await env.DB.prepare('SELECT estoque_atual FROM produtos WHERE id=?').bind(it.produto.id).first();
      await registrarMovimentacao(env, {
        produto_id: it.produto.id,
        tipo: 'saida',
        quantidade: it.qtd,
        saldo_apos: num(saldo.estoque_atual),
        custo_unitario: num(it.produto.custo),
        preco_unitario: it.preco,
        origem: 'venda',
        ref_id: vendId,
        responsavel,
        observacoes: `Venda ${numero}`,
      });
    }
  }
  await registrarLancamento(env, {
    data: now(),
    tipo: 'receita',
    categoria: 'Venda',
    descricao: `Venda ${numero}`,
    valor: total,
    metodo: pagamentos[0].forma || 'dinheiro',
    ref_tipo: 'venda',
    ref_id: vendId,
  });
  await registrarCaixa(env, {
    data: now(),
    tipo: 'entrada',
    valor: total,
    metodo: pagamentos.map((p) => p.forma).join('+'),
    observacao: `Venda ${numero}`,
    funcionario: responsavel,
  });

  return c.json({ venda_id: vendId, numero, subtotal, desconto, total, pagamentos, itens: itensNorm.map((i) => ({ nome: i.produto.nome, qtd: i.qtd, preco: i.preco, total: i.total })) }, 201);
}

export async function listVendasHandler(c, env) {
  const de = c.req.query('de') || '';
  const ate = c.req.query('ate') || '';
  let sql = 'SELECT * FROM vendas';
  const where = [];
  const params = [];
  if (de) {
    where.push('criado_em >= ?');
    params.push(`${de}T00:00:00`);
  }
  if (ate) {
    where.push('criado_em <= ?');
    params.push(`${ate}T23:59:59`);
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY id DESC LIMIT 200';
  const rows = await env.DB.prepare(sql).bind(...params).all();
  return c.json(rows.results);
}

export async function getVendaHandler(c, env) {
  const v = await env.DB.prepare('SELECT * FROM vendas WHERE id=?').bind(c.params.id).first();
  if (!v) return c.json({ error: 'Venda não encontrada' }, 404);
  const itens = await env.DB.prepare('SELECT * FROM venda_itens WHERE venda_id=?').bind(v.id).all();
  const pagamentos = await env.DB.prepare('SELECT * FROM pagamentos WHERE venda_id=?').bind(v.id).all();
  return c.json({ ...v, itens: itens.results, pagamentos: pagamentos.results });
}

export async function cancelarVendaHandler(c, env) {
  const v = await env.DB.prepare('SELECT * FROM vendas WHERE id=?').bind(c.params.id).first();
  if (!v) return c.json({ error: 'Venda não encontrada' }, 404);
  if (v.status !== 'concluida') return c.json({ error: 'Venda já cancelada' }, 400);
  await env.DB.prepare("UPDATE vendas SET status='cancelada' WHERE id=?").bind(v.id).run();
  // Reverte todas as baixas da venda (produtos simples e insumos de fichas técnicas),
  // usando as movimentações registradas na venda.
  const movs = await env.DB.prepare("SELECT * FROM estoque_movimentacoes WHERE origem='venda' AND ref_id=?")
    .bind(v.id)
    .all();
  for (const m of movs.results) {
    await env.DB.prepare('UPDATE produtos SET estoque_atual = estoque_atual + ? WHERE id=?')
      .bind(m.quantidade, m.produto_id)
      .run();
    const saldo = await env.DB.prepare('SELECT estoque_atual FROM produtos WHERE id=?').bind(m.produto_id).first();
    await registrarMovimentacao(env, {
      produto_id: m.produto_id,
      tipo: 'entrada',
      quantidade: m.quantidade,
      saldo_apos: num(saldo.estoque_atual),
      custo_unitario: m.custo_unitario,
      origem: 'estorno',
      ref_id: v.id,
      responsavel: null,
      observacoes: `Estorno da venda ${v.numero}${m.observacoes ? ' · ' + m.observacoes.replace(`Venda ${v.numero}`, '').trim() : ''}`,
    });
  }
  await registrarLancamento(env, {
    data: now(),
    tipo: 'despesa',
    categoria: 'Estorno',
    descricao: `Estorno da venda ${v.numero}`,
    valor: num(v.total),
    metodo: null,
    ref_tipo: 'venda',
    ref_id: v.id,
  });
  await registrarCaixa(env, {
    data: now(),
    tipo: 'saida',
    valor: num(v.total),
    metodo: null,
    observacao: `Estorno da venda ${v.numero}`,
    funcionario: null,
  });
  return c.json({ ok: true });
}

// ============================ MESAS ============================

export async function listMesasHandler(c, env) {
  const rows = await env.DB.prepare('SELECT * FROM mesas ORDER BY numero').all();
  const comandas = await env.DB.prepare(
    `SELECT c.*, m.numero AS mesa_numero,
     (SELECT COALESCE(SUM(i.quantidade * i.preco_unitario),0) FROM comanda_itens i WHERE i.comanda_id=c.id AND i.status!='cancelado') AS total,
     (SELECT COUNT(*) FROM comanda_itens i WHERE i.comanda_id=c.id AND i.status!='cancelado') AS itens_count
     FROM comandas c JOIN mesas m ON m.id=c.mesa_id WHERE c.status IN ('aberta','pre_fechamento')`
  ).all();
  return c.json({ mesas: rows.results, comandas: comandas.results });
}

export async function createMesaHandler(c, env) {
  const b = await c.req.json();
  if (!b.numero) return c.json({ error: 'Número obrigatório' }, 400);
  const r = await env.DB.prepare(
    'INSERT INTO mesas (numero, nome, capacidade, setor, status, ativo, criado_em) VALUES (?,?,?,?,?,1,?)'
  )
    .bind(num(b.numero), b.nome || `Mesa ${b.numero}`, num(b.capacidade) || 4, b.setor || null, b.status || 'livre', now())
    .run();
  return c.json({ id: r.meta.last_row_id, ...b }, 201);
}

export async function updateMesaHandler(c, env) {
  const b = await c.req.json();
  await env.DB.prepare('UPDATE mesas SET numero=?, nome=?, capacidade=?, setor=?, ativo=? WHERE id=?')
    .bind(num(b.numero), b.nome, num(b.capacidade) || 4, b.setor || null, b.ativo === false ? 0 : 1, c.params.id)
    .run();
  return c.json({ ok: true });
}

export async function deleteMesaHandler(c, env) {
  await env.DB.prepare('UPDATE mesas SET ativo=0 WHERE id=?').bind(c.params.id).run();
  return c.json({ ok: true });
}

// ============================ COMANDAS ============================

export async function abrirComandaHandler(c, env) {
  const b = await c.req.json();
  const mesa = await env.DB.prepare('SELECT * FROM mesas WHERE id=?').bind(c.params.id).first();
  if (!mesa) return c.json({ error: 'Mesa não encontrada' }, 404);
  const ocupada = await env.DB.prepare("SELECT COUNT(*) c FROM comandas WHERE mesa_id=? AND status='aberta'")
    .bind(c.params.id)
    .first();
  if (num(ocupada.c) > 0) return c.json({ error: 'Mesa já está ocupada' }, 400);

  const taxa = b.taxa_garcom_pct ?? (await getConfigValue(env, 'taxa_garcom_pct', '0'));
  const r = await env.DB.prepare(
    `INSERT INTO comandas (mesa_id, cliente_nome, garcom_nome, status, taxa_garcom_pct, fechamento_tipo, pessoas_count, criado_em)
     VALUES (?,?,?,?,?,?,?,?)`
  )
    .bind(
      c.params.id,
      b.cliente_nome || null,
      b.garcom_nome || null,
      'aberta',
      num(taxa),
      null,
      num(b.pessoas_count) || 1,
      now()
    )
    .run();
  const comandaId = r.meta.last_row_id;
  const CORES = ['#6366f1', '#16a34a', '#f59e0b', '#ec4899', '#0ea5e9', '#ef4444'];
  const qtd = num(b.pessoas_count) || 1;
  const pStmts = [];
  for (let i = 1; i <= qtd; i++) {
    pStmts.push(
      env.DB.prepare('INSERT INTO comanda_pessoas (comanda_id, nome, cor, criado_em) VALUES (?,?,?,?)').bind(
        comandaId,
        `Pessoa ${i}`,
        CORES[(i - 1) % CORES.length],
        now()
      )
    );
  }
  if (pStmts.length) await env.DB.batch(pStmts);
  await env.DB.prepare("UPDATE mesas SET status='ocupada', aberta_em=? WHERE id=?").bind(now(), c.params.id).run();
  return c.json(await getComandaFull(env, comandaId), 201);
}

async function getComandaFull(env, id) {
  const c = await env.DB.prepare('SELECT * FROM comandas WHERE id=?').bind(id).first();
  if (!c) return null;
  const pessoas = await env.DB.prepare('SELECT * FROM comanda_pessoas WHERE comanda_id=? ORDER BY id').bind(id).all();
  const itens = await env.DB.prepare(
    `SELECT i.*, p.nome AS produto_nome, p.unidade FROM comanda_itens i
     LEFT JOIN produtos p ON p.id=i.produto_id WHERE i.comanda_id=? ORDER BY i.id`
  )
    .bind(id)
    .all();
  const mesa = await env.DB.prepare('SELECT * FROM mesas WHERE id=?').bind(c.mesa_id).first();
  const ativos = itens.results.filter((i) => i.status !== 'cancelado');
  const subtotal = ativos.reduce((s, i) => s + num(i.quantidade) * num(i.preco_unitario), 0);
  const transfer = await env.DB.prepare(
    'SELECT id, status FROM comandas WHERE comanda_origem_id=? ORDER BY id DESC LIMIT 1'
  )
    .bind(id)
    .first();
  return {
    ...c,
    mesa: mesa || null,
    pessoas: pessoas.results,
    itens: itens.results,
    subtotal,
    transfer_comanda_id: transfer?.id ?? null,
    transfer_comanda_status: transfer?.status ?? null,
  };
}

export async function getComandaHandler(c, env) {
  const data = await getComandaFull(env, c.params.id);
  if (!data) return c.json({ error: 'Comanda não encontrada' }, 404);
  return c.json(data);
}

export async function addPessoaHandler(c, env) {
  const b = await c.req.json();
  const com = await env.DB.prepare("SELECT * FROM comandas WHERE id=? AND status='aberta'").bind(c.params.id).first();
  if (!com) return c.json({ error: 'Comanda não encontrada' }, 404);
  const r = await env.DB.prepare('INSERT INTO comanda_pessoas (comanda_id, nome, cor, criado_em) VALUES (?,?,?,?)')
    .bind(c.params.id, b.nome || null, b.cor || '#6366f1', now())
    .run();
  const pCount = await env.DB.prepare('SELECT COUNT(*) c FROM comanda_pessoas WHERE comanda_id=?').bind(c.params.id).first();
  await env.DB.prepare('UPDATE comandas SET pessoas_count=? WHERE id=?').bind(num(pCount.c), c.params.id).run();
  return c.json({ id: r.meta.last_row_id, comanda_id: num(c.params.id), nome: b.nome || null, cor: b.cor || '#6366f1' }, 201);
}

export async function removePessoaHandler(c, env) {
  await env.DB.prepare('DELETE FROM comanda_pessoas WHERE id=?').bind(c.params.pid).run();
  await env.DB.prepare('UPDATE comanda_itens SET pessoa_id=NULL WHERE pessoa_id=?').bind(c.params.pid).run();
  return c.json({ ok: true });
}

export async function updatePessoaComandaHandler(c, env) {
  const b = await c.req.json();
  const p = await env.DB.prepare('SELECT * FROM comanda_pessoas WHERE id=? AND comanda_id=?')
    .bind(c.params.pid, c.params.id)
    .first();
  if (!p) return c.json({ error: 'Pessoa não encontrada' }, 404);
  const nome = typeof b.nome === 'string' ? b.nome.trim() : p.nome;
  if (!nome) return c.json({ error: 'Nome obrigatório' }, 400);
  await env.DB.prepare('UPDATE comanda_pessoas SET nome=? WHERE id=?').bind(nome, p.id).run();
  return c.json({ id: p.id, nome, cor: p.cor });
}

export async function addItemComandaHandler(c, env) {
  const b = await c.req.json();
  const com = await env.DB.prepare("SELECT * FROM comandas WHERE id=? AND status='aberta'").bind(c.params.id).first();
  if (!com) return c.json({ error: 'Comanda não encontrada' }, 404);

  let produto = null;
  if (b.produto_id) {
    produto = await getProdutoFull(env, b.produto_id);
  } else if (b.codigo) {
    produto = await buscarProdutoPorCodigo(env, b.codigo);
  }
  const qtd = num(b.quantidade) || 1;
  const preco = b.preco_unitario !== undefined && b.preco_unitario !== null ? num(b.preco_unitario) : num(produto?.preco || 0);
  const nome = b.nome || produto?.nome || 'Item avulso';

  const r = await env.DB.prepare(
    `INSERT INTO comanda_itens (comanda_id, pessoa_id, produto_id, nome, quantidade, preco_unitario, observacao, status, responsavel, criado_em)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      c.params.id,
      b.pessoa_id || null,
      produto?.id || null,
      nome,
      qtd,
      preco,
      b.observacao || null,
      'novo',
      b.responsavel || null,
      now()
    )
    .run();
  const item = await env.DB.prepare('SELECT * FROM comanda_itens WHERE id=?').bind(r.meta.last_row_id).first();
  return c.json(item, 201);
}

export async function updateItemStatusHandler(c, env) {
  const b = await c.req.json();
  const item = await env.DB.prepare('SELECT * FROM comanda_itens WHERE id=?').bind(c.params.item_id).first();
  if (!item) return c.json({ error: 'Item não encontrado' }, 404);
  const novoStatus = b.status;
  const validos = ['novo', 'enviado', 'entregue', 'cancelado', 'perda'];
  if (!validos.includes(novoStatus)) return c.json({ error: 'Status inválido' }, 400);

  await env.DB.prepare('UPDATE comanda_itens SET status=?, enviado_em=? WHERE id=?')
    .bind(novoStatus, novoStatus === 'enviado' ? now() : item.enviado_em, item.id)
    .run();

  if (novoStatus === 'cancelado') {
    const timeout = num(await getConfigValue(env, 'perda_timeout_min', '2'));
    const criado = new Date(item.criado_em).getTime();
    const minutos = (Date.now() - criado) / 60000;
    if (minutos >= timeout) {
      await criarPerda(env, {
        produto_id: item.produto_id,
        quantidade: num(item.quantidade),
        valor_unitario: item.custo_unitario || num(item.preco_unitario),
        motivo: 'Cancelamento de pedido',
        origem: 'cancelamento',
        comanda_id: item.comanda_id,
        item_id: item.id,
        responsavel: b.responsavel,
        movimentaEstoque: false,
      });
    }
  }
  return c.json({ ok: true });
}

export async function fecharComandaHandler(c, env) {
  const b = await c.req.json();
  const com = await env.DB.prepare('SELECT * FROM comandas WHERE id=? AND status IN (?,?)')
    .bind(c.params.id, 'aberta', 'pre_fechamento')
    .first();
  if (!com) return c.json({ error: 'Comanda não encontrada' }, 404);
  const itens = await env.DB.prepare(
    "SELECT * FROM comanda_itens WHERE comanda_id=? AND status!='cancelado'"
  )
    .bind(com.id)
    .all();

  // Mesa aberta sem itens: fecha sem custos, sem gerar venda.
  if (!itens.results.length) {
    const tipoVazio = b.tipo || com.fechamento_tipo || 'unica';
    await env.DB.prepare(
      `UPDATE comandas SET status='fechada', fechamento_tipo=?, fechada_em=?, baixada_em=? WHERE id=?`
    )
      .bind(tipoVazio, now(), now(), com.id)
      .run();
    await env.DB.prepare("UPDATE mesas SET status='livre', aberta_em=NULL WHERE id=?").bind(com.mesa_id).run();
    return c.json({ ok: true, comanda_id: com.id, vendas: [], total: 0, mensagem: 'Mesa fechada sem itens' });
  }

  const taxaPct = b.taxa_garcom_pct !== undefined ? num(b.taxa_garcom_pct) : num(com.taxa_garcom_pct);
  const tipo = b.tipo || com.fechamento_tipo || 'unica';
  const responsavel = b.responsavel || com.garcom_nome || null;

  // Pagamento individual: transfere os itens para a mesa "Pagamentos Individuais"
  // e deixa a comanda em pré-fechamento. A baixa é feita pessoa por pessoa lá.
  if (com.status === 'aberta' && tipo === 'individual') {
    const transfer = await transferirParaPagamentos(env, com, taxaPct, b);
    if (!transfer) return c.json({ error: 'Não foi possível iniciar os pagamentos individuais' }, 400);
    return c.json({
      ok: true,
      pre_fechamento: true,
      comanda_id: com.id,
      comanda_pagamentos_id: transfer.id,
      pessoas: transfer.pessoas,
      total: transfer.total,
      mensagem: 'Pagamentos individuais iniciados. Baixe cada pessoa na mesa Pagamentos Individuais.',
    });
  }

  // Pré-fechamento (1ª etapa): imprime a conta e bloqueia novos pedidos,
  // mas NÃO baixa no sistema. A mesa continua reservada e dá para reabrir.
  if (com.status === 'aberta' && b.pre_fechar === true) {
    await env.DB.prepare(
      "UPDATE comandas SET status='pre_fechamento', fechamento_tipo=?, taxa_garcom_pct=?, pre_fechamento_em=? WHERE id=?"
    )
      .bind(tipo, taxaPct, now(), com.id)
      .run();
    const subtotal = itens.results.reduce((s, i) => s + num(i.quantidade) * num(i.preco_unitario), 0);
    return c.json({
      ok: true,
      pre_fechamento: true,
      comanda_id: com.id,
      total: num((subtotal * (1 + taxaPct / 100)).toFixed(2)),
      mensagem: 'Conta pré-fechada. Imprima e baixe quando o pagamento for recebido.',
    });
  }

  const pessoas = await env.DB.prepare('SELECT * FROM comanda_pessoas WHERE comanda_id=? ORDER BY id')
    .bind(com.id)
    .all();
  const porPessoa = {};
  for (const p of pessoas.results) porPessoa[p.id] = [];
  porPessoa['geral'] = [];

  const itemsComanda = itens.results.map((i) => {
    const total = num(i.quantidade) * num(i.preco_unitario);
    const bucket = i.pessoa_id ? porPessoa[i.pessoa_id] : porPessoa['geral'];
    if (bucket) bucket.push({ ...i, total });
    return { ...i, total };
  });

  let vendasCriadas = [];
  const totalGeral = itemsComanda.reduce((s, i) => s + i.total, 0);

  const taxa = totalGeral * (taxaPct / 100);
  const venda = await criarVendaInterna(env, {
    numero: await gerarNumeroVenda(env, 'rest'),
    tipo: 'restaurante',
    comanda_id: com.id,
    mesa_id: com.mesa_id,
    subtotal: totalGeral,
    desconto: 0,
    taxa_servico: taxa,
    total: totalGeral + taxa,
    responsavel,
    itens: itemsComanda,
    pagamentos: Array.isArray(b.pagamentos) && b.pagamentos.length ? b.pagamentos : [{ forma: b.forma || 'dinheiro', valor: totalGeral + taxa }],
  });
  vendasCriadas.push(venda);

  await env.DB.prepare(
    `UPDATE comandas SET status='fechada', fechamento_tipo=?, taxa_garcom_pct=?, fechada_em=?, baixada_em=? WHERE id=?`
  )
    .bind(tipo, taxaPct, now(), now(), com.id)
    .run();
  await env.DB.prepare("UPDATE mesas SET status='livre', aberta_em=NULL WHERE id=?").bind(com.mesa_id).run();

  return c.json({ ok: true, comanda_id: com.id, vendas: vendasCriadas, total: vendasCriadas.reduce((s, v) => s + v.total, 0) });
}

export async function reabrirComandaHandler(c, env) {
  const com = await env.DB.prepare("SELECT * FROM comandas WHERE id=? AND status='pre_fechamento'")
    .bind(c.params.id)
    .first();
  if (!com) return c.json({ error: 'Comanda não encontrada' }, 404);
  if (com.comanda_origem_id) return c.json({ error: 'Comanda de pagamentos não pode ser reaberta' }, 400);
  await env.DB.prepare("UPDATE comandas SET status='aberta', pre_fechamento_em=NULL, fechamento_tipo=NULL WHERE id=?")
    .bind(com.id)
    .run();
  return c.json({ ok: true });
}

async function transferirParaPagamentos(env, com, taxaPct, b) {
  const itens = await env.DB.prepare(
    "SELECT * FROM comanda_itens WHERE comanda_id=? AND status!='cancelado' ORDER BY id"
  )
    .bind(com.id)
    .all();
  const pessoasOrig = await env.DB.prepare('SELECT * FROM comanda_pessoas WHERE comanda_id=? ORDER BY id')
    .bind(com.id)
    .all();
  if (!itens.results.length) return null;

  const pagMesa = await env.DB.prepare("SELECT * FROM mesas WHERE tipo='pagamentos' ORDER BY id LIMIT 1").first();
  if (!pagMesa) return null;

  const agora = now();
  const r = await env.DB.prepare(
    `INSERT INTO comandas (mesa_id, cliente_nome, garcom_nome, status, taxa_garcom_pct, fechamento_tipo, pessoas_count, comanda_origem_id, pre_fechamento_em, criado_em)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(pagMesa.id, com.cliente_nome, com.garcom_nome, 'pre_fechamento', taxaPct, 'individual', 0, com.id, agora, agora)
    .run();
  const novaId = r.meta.last_row_id;

  const grupos = {};
  for (const it of itens.results) {
    const key = it.pessoa_id ? String(it.pessoa_id) : '__geral__';
    (grupos[key] = grupos[key] || []).push(it);
  }

  const valores = Array.isArray(b.pessoas_valores) && b.pessoas_valores.length ? b.pessoas_valores : null;
  const aIncluir = new Set(Object.keys(grupos));
  if (valores) {
    for (const v of valores) aIncluir.add(v.pessoa_id ? String(v.pessoa_id) : '__geral__');
  }

  const idMap = {};
  let count = 0;
  for (const p of pessoasOrig.results) {
    if (!aIncluir.has(String(p.id))) continue;
    const pr = await env.DB.prepare(
      'INSERT INTO comanda_pessoas (comanda_id, nome, cor, criado_em) VALUES (?,?,?,?)'
    )
      .bind(novaId, p.nome, p.cor || '#6366f1', agora)
      .run();
    idMap[p.id] = pr.meta.last_row_id;
    count++;
  }
  if (aIncluir.has('__geral__')) {
    const pr = await env.DB.prepare(
      'INSERT INTO comanda_pessoas (comanda_id, nome, cor, criado_em) VALUES (?,?,?,?)'
    )
      .bind(novaId, 'Itens Gerais', '#94a3b8', agora)
      .run();
    idMap['__geral__'] = pr.meta.last_row_id;
    count++;
  }

  const batchItems = [];
  for (const key of Object.keys(grupos)) {
    const npessoa = idMap[key];
    for (const it of grupos[key]) {
      batchItems.push(
        env.DB.prepare(
          `INSERT INTO comanda_itens (comanda_id, pessoa_id, produto_id, nome, quantidade, preco_unitario, observacao, status, responsavel, criado_em)
           VALUES (?,?,?,?,?,?,?,?,?,?)`
        ).bind(novaId, npessoa, it.produto_id, it.nome, it.quantidade, it.preco_unitario, it.observacao, it.status, it.responsavel, agora)
      );
    }
  }
  if (batchItems.length) await env.DB.batch(batchItems);

  const valObj = {};
  const formaObj = {};
  let total = 0;
  if (valores) {
    for (const v of valores) {
      const src = v.pessoa_id ? String(v.pessoa_id) : '__geral__';
      const dst = idMap[src];
      if (dst !== undefined && num(v.valor) > 0) {
        valObj[dst] = num(v.valor);
        formaObj[dst] = v.forma || b.forma || 'dinheiro';
        total += num(v.valor);
      }
    }
  } else {
    for (const key of Object.keys(grupos)) {
      const dst = idMap[key];
      const sub = grupos[key].reduce((s, i) => s + num(i.quantidade) * num(i.preco_unitario), 0);
      if (sub > 0) {
        valObj[dst] = num((sub * (1 + taxaPct / 100)).toFixed(2));
        formaObj[dst] = b.forma || 'dinheiro';
        total += valObj[dst];
      }
    }
  }
  await env.DB.prepare('UPDATE comandas SET pessoas_count=?, individual_valores=? WHERE id=?')
    .bind(count, JSON.stringify({ valores: valObj, formas: formaObj }), novaId)
    .run();

  await env.DB.prepare(
    "UPDATE comandas SET status='pre_fechamento', fechamento_tipo='individual', pre_fechamento_em=? WHERE id=?"
  )
    .bind(agora, com.id)
    .run();

  return { id: novaId, pessoas: count, total: num(total.toFixed(2)) };
}

export async function baixarPessoaComandaHandler(c, env) {
  const com = await env.DB.prepare("SELECT * FROM comandas WHERE id=? AND status='pre_fechamento'")
    .bind(c.params.id)
    .first();
  if (!com) return c.json({ error: 'Comanda não está em pré-fechamento' }, 400);
  const b = await c.req.json();
  const pessoa = await env.DB.prepare('SELECT * FROM comanda_pessoas WHERE id=? AND comanda_id=?')
    .bind(b.pessoa_id, com.id)
    .first();
  if (!pessoa) return c.json({ error: 'Pessoa não encontrada' }, 404);
  if (pessoa.status === 'baixado') return c.json({ error: 'Pessoa já baixada' }, 400);

  const itens = await env.DB.prepare(
    "SELECT * FROM comanda_itens WHERE comanda_id=? AND pessoa_id=? AND status!='cancelado'"
  )
    .bind(com.id, pessoa.id)
    .all();
  const itensVenda = itens.results.map((i) => ({
    ...i,
    total: num(i.quantidade) * num(i.preco_unitario),
  }));
  const individual = com.individual_valores ? JSON.parse(com.individual_valores) : null;
  const valorPessoa = individual?.valores?.[pessoa.id];
  const formaPessoa = individual?.formas?.[pessoa.id] || b.forma || 'dinheiro';
  const sub = itens.results.reduce((s, i) => s + num(i.quantidade) * num(i.preco_unitario), 0);
  const valor = valorPessoa !== undefined ? num(valorPessoa) : num(sub * (1 + num(com.taxa_garcom_pct) / 100));
  if (!itens.results.length && valor <= 0) return c.json({ error: 'Pessoa sem itens para baixar' }, 400);

  const responsavel = b.responsavel || com.garcom_nome || null;
  const venda = await criarVendaInterna(env, {
    numero: await gerarNumeroVenda(env, 'rest'),
    tipo: 'restaurante',
    comanda_id: com.id,
    mesa_id: com.mesa_id,
    subtotal: num(valor),
    desconto: 0,
    taxa_servico: 0,
    total: num(valor),
    responsavel,
    itens: itensVenda,
    pagamentos: [{ forma: formaPessoa, valor: num(valor) }],
  });

  await env.DB.prepare("UPDATE comanda_pessoas SET status='baixado', baixada_em=? WHERE id=?")
    .bind(now(), pessoa.id)
    .run();

  const pendentes = await env.DB.prepare(
    "SELECT COUNT(*) c FROM comanda_pessoas WHERE comanda_id=? AND status='pendente'"
  )
    .bind(com.id)
    .first();
  let fechou = false;
  if (num(pendentes.c) === 0) {
    await env.DB.prepare("UPDATE comandas SET status='fechada', baixada_em=? WHERE id=?").bind(now(), com.id).run();
    if (com.comanda_origem_id) {
      const orig = await env.DB.prepare('SELECT * FROM comandas WHERE id=?').bind(com.comanda_origem_id).first();
      if (orig) {
        await env.DB.prepare("UPDATE comandas SET status='fechada', fechada_em=? WHERE id=?").bind(now(), orig.id).run();
        await env.DB.prepare("UPDATE mesas SET status='livre', aberta_em=NULL WHERE id=?").bind(orig.mesa_id).run();
      }
    }
    fechou = true;
  }

  const data = await getComandaFull(env, com.id);
  return c.json({ ok: true, venda, fechou, comanda: data });
}

async function criarVendaInterna(env, o) {
  const produtosCache = new Map();
  async function getProd(id) {
    if (!produtosCache.has(id)) {
      const p = await getProdutoFull(env, id);
      produtosCache.set(id, p);
    }
    return produtosCache.get(id);
  }

  // Valida tudo antes de gravar, para não deixar venda órfã em caso de erro.
  const planos = [];
  for (const it of o.itens) {
    const p = it.produto_id ? await getProd(it.produto_id) : null;
    const baixas = [];
    if (p && p.tipo === 'composto' && Array.isArray(p.ficha) && p.ficha.length) {
      for (const ing of p.ficha) {
        const conv = converterQuantidade(ing.quantidade, ing.unidade, ing.insumo_unidade);
        if (conv === null) {
          throw httpError(400, `Unidade incompatível na ficha de ${p.nome} (${ing.insumo_nome})`);
        }
        const needed = conv * num(it.quantidade);
        if (num(ing.insumo_estoque) < needed - 0.0001) {
          throw httpError(
            400,
            `Estoque insuficiente de ${ing.insumo_nome} para ${num(it.quantidade)}x ${p.nome} (${num(ing.insumo_estoque)} disponível)`
          );
        }
        baixas.push({ insumo_id: ing.insumo_id, quantidade: needed, custo_unitario: num(ing.insumo_custo), nome: p.nome });
      }
    } else if (p) {
      baixas.push({ insumo_id: it.produto_id, quantidade: num(it.quantidade), custo_unitario: num(p.custo ?? 0) });
    }
    planos.push({ it, p, baixas });
  }

  const vr = await env.DB.prepare(
    `INSERT INTO vendas (numero, tipo, comanda_id, mesa_id, subtotal, desconto, taxa_servico, total, status, funcionario, responsavel, observacoes, criado_em)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      o.numero,
      o.tipo,
      o.comanda_id,
      o.mesa_id,
      o.subtotal,
      o.desconto,
      o.taxa_servico,
      o.total,
      'concluida',
      o.responsavel,
      o.responsavel,
      o.observacoes || null,
      now()
    )
    .run();
  const vendId = vr.meta.last_row_id;

  const stmts = [];
  for (const { it, p } of planos) {
    const custoUnit = it.custo_unitario ?? (p ? num(p.custo) : 0);
    stmts.push(
      env.DB.prepare(
        `INSERT INTO venda_itens (venda_id, produto_id, nome, quantidade, custo_unitario, preco_unitario, total)
         VALUES (?,?,?,?,?,?,?)`
      ).bind(vendId, it.produto_id, it.nome, num(it.quantidade), custoUnit, num(it.preco_unitario), it.total)
    );
    for (const b of planos.find((x) => x.it === it).baixas) {
      stmts.push(env.DB.prepare('UPDATE produtos SET estoque_atual = estoque_atual - ? WHERE id=?').bind(b.quantidade, b.insumo_id));
    }
  }
  for (const pg of o.pagamentos) {
    stmts.push(env.DB.prepare('INSERT INTO pagamentos (venda_id, forma, valor) VALUES (?,?,?)').bind(vendId, pg.forma || 'dinheiro', num(pg.valor)));
  }
  if (stmts.length) await env.DB.batch(stmts);

  for (const { it, p, baixas } of planos) {
    if (!it.produto_id) continue;
    for (const b of baixas) {
      const saldo = await env.DB.prepare('SELECT estoque_atual FROM produtos WHERE id=?').bind(b.insumo_id).first();
      await registrarMovimentacao(env, {
        produto_id: b.insumo_id,
        tipo: 'saida',
        quantidade: b.quantidade,
        saldo_apos: num(saldo.estoque_atual),
        custo_unitario: b.custo_unitario,
        preco_unitario: b.insumo_id === it.produto_id ? num(it.preco_unitario) : null,
        origem: 'venda',
        ref_id: vendId,
        responsavel: o.responsavel,
        observacoes: b.nome
          ? `Venda ${o.numero} · ${num(it.quantidade)}x ${p.nome}`
          : `Venda ${o.numero}`,
      });
    }
  }
  await registrarLancamento(env, {
    data: now(),
    tipo: 'receita',
    categoria: 'Venda',
    descricao: `Venda ${o.numero}`,
    valor: o.total,
    metodo: o.pagamentos[0]?.forma || 'dinheiro',
    ref_tipo: 'venda',
    ref_id: vendId,
  });
  await registrarCaixa(env, {
    data: now(),
    tipo: 'entrada',
    valor: o.total,
    metodo: o.pagamentos.map((p) => p.forma).join('+'),
    observacao: `Venda ${o.numero}`,
    funcionario: o.responsavel,
  });
  return { id: vendId, numero: o.numero, total: o.total };
}
