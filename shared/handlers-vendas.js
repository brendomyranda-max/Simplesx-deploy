/**
 * Arquivo: handlers-vendas.js
 * Responsabilidade: Implementa mesas, comandas, PDV, pagamentos, vendas e perdas.
 */

import {
  now,
  hoje,
  num,
  addDays,
  diasAte,
  getConfig,
  getConfigValue,
  getProdutoFull,
  registrarMovimentacao,
  baixarEstoque,
  registrarLancamento,
  registrarCaixa,
  criarPerda,
  gerarNumeroVenda,
  httpError,
  estabelecimentoId,
  calcularBaixasProduto,
  acrescimosDoProduto,
} from './util.js';
import { quantidadeEmUnidadesEstoque, arredondar } from './units.js';
import { idsAcrescimo, observacaoComAcrescimos, precoComAcrescimos, selecionarAcrescimos, separarObservacao } from './acrescimos.js';
import { emitirNfceVenda } from './handlers-fiscal.js';
import { saveOrderItems } from './restaurant-orders.js';
import { dispatchOrders } from './order-printing.js';
import { criarVendaRestaurante } from './restaurant-sale.js';
import { transferirParaPagamentos } from './restaurant-payments.js';
import { montarCombo } from './combo.js';
import { somentePedidosPosteriores, validarHistoricoFechamento } from './restaurant-close-history.js';

// ============================ VALIDADE ============================

export async function listValidadeHandler(c, env) {
  const status = c.req.query('status') || '';
  const dias = c.req.query('vencendo_dias') || '';
  const categoriaId = num(c.req.query('categoria_id'));
  const produtoTipo = c.req.query('produto_tipo') || '';
  let sql =
    `SELECT v.*, p.nome AS produto_nome, p.unidade, p.tipo AS produto_tipo, p.validade_aberto_dias,
     (SELECT GROUP_CONCAT(ca.nome, ', ') FROM produto_categorias pc JOIN categorias ca ON ca.id=pc.categoria_id WHERE pc.produto_id=p.id) AS categorias_nomes
     FROM validade_controles v LEFT JOIN produtos p ON p.id=v.produto_id`;
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
  if (categoriaId) {
    where.push('EXISTS (SELECT 1 FROM produto_categorias pc WHERE pc.produto_id=v.produto_id AND pc.categoria_id=?)');
    params.push(categoriaId);
  }
  if (['produto', 'composto', 'insumo'].includes(produtoTipo)) {
    where.push('p.tipo=?');
    params.push(produtoTipo);
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
    if (p.tipo === 'combo' && !Number.isInteger(qtd)) return c.json({ error: 'Quantidade do combo deve ser inteira' }, 400);
    if (precisaPreco && !p.preco) {
      return c.json({ error: `Produto sem preço: ${p.nome}` }, 400);
    }
    const combo = p.tipo === 'combo' ? await montarCombo(env, p, it.combo_escolhas) : null;
    if (!combo && it.combo_escolhas != null) return c.json({ error: 'Este produto não é um combo' }, 400);
    const preco = Math.round((num(p.preco) + (combo?.adicional || 0)) * 100) / 100;
    const composto = (p.tipo === 'composto' && Array.isArray(p.ficha) && p.ficha.length) || !!combo;
    const baixas = combo ? [] : composto ? await calcularBaixasProduto(env, p.id, qtd) : [];
    if (combo) {
      const mapa = new Map();
      for (const id of combo.componentes) {
        for (const baixa of await calcularBaixasProduto(env, id, qtd)) {
          const atual = mapa.get(baixa.produto_id) || { ...baixa, quantidade: 0 };
          atual.quantidade += baixa.quantidade;
          mapa.set(baixa.produto_id, atual);
        }
      }
      baixas.push(...mapa.values());
    }
    if (composto) {
      for (const baixa of baixas) {
        if (baixa.disponivel < baixa.quantidade - 0.0001) {
          return c.json(
            { error: `Estoque insuficiente de ${baixa.nome} para ${qtd}x ${p.nome} (${baixa.disponivel} disponível)` },
            400
          );
        }
      }
    } else if (num(p.estoque_atual) < qtd) {
      return c.json({ error: `Estoque insuficiente para ${p.nome} (${num(p.estoque_atual)} disponível)` }, 400);
    }
    const custo = combo ? baixas.reduce((s, baixa) => s + baixa.quantidade * baixa.custo_unitario, 0) / qtd : num(p.custo);
    itensNorm.push({ produto: p, qtd, preco, total: preco * qtd, composto, baixas, combo, custo });
    subtotal += preco * qtd;
  }

  const consumo = new Map();
  for (const it of itensNorm) {
    const linhas = it.composto ? it.baixas : [{ produto_id: it.produto.id, nome: it.produto.nome, quantidade: it.qtd, disponivel: num(it.produto.estoque_atual) }];
    for (const baixa of linhas) {
      const atual = consumo.get(baixa.produto_id) || { nome: baixa.nome, quantidade: 0, disponivel: baixa.disponivel };
      atual.quantidade += baixa.quantidade;
      consumo.set(baixa.produto_id, atual);
    }
  }
  for (const item of consumo.values()) if (item.quantidade > item.disponivel + 0.0001) {
    return c.json({ error: `Estoque insuficiente de ${item.nome}` }, 400);
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
      'aguardando_fechamento',
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
        `INSERT INTO venda_itens (venda_id, produto_id, nome, quantidade, custo_unitario, preco_unitario, total, combo_escolhas_json)
         VALUES (?,?,?,?,?,?,?,?)`
      ).bind(vendId, it.produto.id, it.combo ? `${it.produto.nome} · ${it.combo.descricao}` : it.produto.nome, it.qtd, it.custo, it.preco, it.total, it.combo ? JSON.stringify(it.combo.escolhas) : null)
    );
    if (it.composto) {
      for (const baixa of it.baixas) {
        stmts.push(
          env.DB.prepare('UPDATE produtos SET estoque_atual = estoque_atual - ? WHERE id=?').bind(baixa.quantidade, baixa.produto_id)
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
      for (const baixa of it.baixas) {
        const saldo = await env.DB.prepare('SELECT estoque_atual FROM produtos WHERE id=?').bind(baixa.produto_id).first();
        await registrarMovimentacao(env, {
          produto_id: baixa.produto_id,
          tipo: 'saida',
          quantidade: baixa.quantidade,
          saldo_apos: num(saldo.estoque_atual),
          custo_unitario: baixa.custo_unitario,
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

  let nfce = null;
  let nfce_erro = null;
  try {
    nfce = await emitirNfceVenda(env, vendId, { automatico: true });
  } catch (e) {
    nfce_erro = e?.message || 'Não foi possível emitir a NFC-e automaticamente';
  }
  return c.json({ venda_id: vendId, numero, subtotal, desconto, total, pagamentos,
    itens: itensNorm.map((i) => ({ nome: i.combo ? `${i.produto.nome} · ${i.combo.descricao}` : i.produto.nome, qtd: i.qtd, preco: i.preco, total: i.total })),
    nfce, nfce_erro }, 201);
}

export async function listVendasHandler(c, env) {
  const de = c.req.query('de') || '';
  const ate = c.req.query('ate') || '';
  let sql = 'SELECT * FROM vendas';
  const where = [];
  const params = [];
  if (de) {
    where.push("date(datetime(criado_em, '-3 hours')) >= ?");
    params.push(de);
  }
  if (ate) {
    where.push("date(datetime(criado_em, '-3 hours')) <= ?");
    params.push(ate);
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
  const ajustes = v.tipo === 'pdv'
    ? await env.DB.prepare('SELECT * FROM venda_ajustes WHERE venda_id=? ORDER BY id').bind(v.id).all()
    : { results: [] };
  return c.json({ ...v, itens: itens.results, pagamentos: pagamentos.results, ajustes: ajustes.results });
}

// O pagamento já foi registrado, mas a venda fica reabrível. Qualquer alteração
// posterior é auditada no ajuste (e reduções exigem a destinação do produto).
export async function reabrirVendaPdvHandler(c, env) {
  const v = await env.DB.prepare("SELECT * FROM vendas WHERE id=? AND tipo='pdv'").bind(c.params.id).first();
  if (!v) return c.json({ error: 'Venda de mercado não encontrada' }, 404);
  if (!['concluida', 'pre_fechamento', 'aguardando_fechamento'].includes(v.status)) {
    return c.json({ error: 'Esta venda não pode ser reaberta' }, 400);
  }
  const fiscal = await env.DB.prepare('SELECT id FROM documentos_fiscais WHERE venda_id=? LIMIT 1').bind(v.id).first();
  if (fiscal) return c.json({ error: 'Venda com NFC-e não pode ser reaberta; cancele o documento fiscal e faça uma nova venda' }, 409);
  // A venda permanece contabilmente concluída enquanto é conferida. Assim, se o
  // operador apenas fechar a tela, caixa e histórico não ficam em estado pendente.
  return getVendaHandler(c, env);
}

async function movimentarItemPdv(env, produto, quantidade, entrada, venda, responsavel) {
  if (produto.tipo === 'composto' && Array.isArray(produto.ficha) && produto.ficha.length) {
    const baixas = await calcularBaixasProduto(env, produto.id, quantidade);
    for (const baixa of baixas) {
      if (!entrada && baixa.disponivel < baixa.quantidade - 0.0001) throw new Error(`Estoque insuficiente de ${baixa.nome}`);
      await env.DB.prepare(`UPDATE produtos SET estoque_atual=estoque_atual ${entrada ? '+' : '-'} ? WHERE id=?`).bind(baixa.quantidade, baixa.produto_id).run();
      const saldo = await env.DB.prepare('SELECT estoque_atual FROM produtos WHERE id=?').bind(baixa.produto_id).first();
      await registrarMovimentacao(env, {
        produto_id: baixa.produto_id, tipo: entrada ? 'entrada' : 'saida', quantidade: baixa.quantidade,
        saldo_apos: num(saldo.estoque_atual), custo_unitario: baixa.custo_unitario,
        origem: entrada ? 'ajuste_venda' : 'venda', ref_id: venda.id, responsavel,
        observacoes: `Ajuste da venda ${venda.numero} · ${quantidade}x ${produto.nome}`,
      });
    }
    return;
  }
  if (!entrada && num(produto.estoque_atual) < quantidade - 0.0001) throw new Error(`Estoque insuficiente para ${produto.nome}`);
  await env.DB.prepare(`UPDATE produtos SET estoque_atual=estoque_atual ${entrada ? '+' : '-'} ? WHERE id=?`).bind(quantidade, produto.id).run();
  const saldo = await env.DB.prepare('SELECT estoque_atual FROM produtos WHERE id=?').bind(produto.id).first();
  await registrarMovimentacao(env, {
    produto_id: produto.id, tipo: entrada ? 'entrada' : 'saida', quantidade,
    saldo_apos: num(saldo.estoque_atual), custo_unitario: num(produto.custo), preco_unitario: num(produto.preco),
    origem: entrada ? 'ajuste_venda' : 'venda', ref_id: venda.id, responsavel,
    observacoes: `Ajuste da venda ${venda.numero}`,
  });
}

export async function ajustarVendaPdvHandler(c, env) {
  const b = await c.req.json();
  const v = await env.DB.prepare("SELECT * FROM vendas WHERE id=? AND tipo='pdv'").bind(c.params.id).first();
  if (!v) return c.json({ error: 'Venda de mercado não encontrada' }, 404);
  if (!['concluida', 'pre_fechamento', 'aguardando_fechamento'].includes(v.status)) return c.json({ error: 'Esta venda não pode ser alterada' }, 400);
  const fiscal = await env.DB.prepare('SELECT id FROM documentos_fiscais WHERE venda_id=? LIMIT 1').bind(v.id).first();
  if (fiscal) return c.json({ error: 'Venda com NFC-e não pode ser alterada; cancele o documento fiscal e faça uma nova venda' }, 409);
  const justificativa = String(b.justificativa || '').trim();
  if (justificativa.length < 5) return c.json({ error: 'Informe uma justificativa com pelo menos 5 caracteres' }, 400);
  if (!Array.isArray(b.itens) || !b.itens.length) return c.json({ error: 'A venda precisa ter ao menos um item' }, 400);

  const antigosRes = await env.DB.prepare('SELECT * FROM venda_itens WHERE venda_id=?').bind(v.id).all();
  const antigos = antigosRes.results;
  if (antigos.some((item) => item.combo_escolhas_json)) return c.json({ error: 'Para alterar uma venda com combo, cancele a venda e registre outra com as novas escolhas' }, 409);
  const novos = new Map();
  let subtotal = 0;
  for (const it of b.itens) {
    const produto = await getProdutoFull(env, it.produto_id);
    if (!produto || !produto.ativo) return c.json({ error: 'Produto inválido no ajuste' }, 400);
    if (produto.tipo === 'combo') return c.json({ error: 'Para alterar uma venda com combo, cancele a venda e registre outra com as novas escolhas' }, 409);
    const qtd = num(it.quantidade);
    if (qtd <= 0) return c.json({ error: 'Quantidade inválida no ajuste' }, 400);
    const preco = num(produto.preco);
    novos.set(num(it.produto_id), { produto, qtd, preco });
    subtotal += qtd * preco;
  }
  const reducoes = new Map((Array.isArray(b.reducoes) ? b.reducoes : []).map((r) => [num(r.produto_id), r]));
  const responsavel = b.responsavel || v.responsavel || null;
  for (const antigo of antigos) {
    const delta = num(antigo.quantidade) - (novos.get(num(antigo.produto_id))?.qtd || 0);
    if (delta > 0 && !['nao_pago', 'duplicado_nao_vendido'].includes(reducoes.get(num(antigo.produto_id))?.motivo)) {
      return c.json({ error: `Informe o motivo da redução de ${antigo.nome}` }, 400);
    }
  }
  const desconto = Math.min(num(b.desconto), subtotal);
  const total = Math.max(0, subtotal - desconto);
  const pagamentos = Array.isArray(b.pagamentos) && b.pagamentos.length ? b.pagamentos : [{ forma: 'dinheiro', valor: total }];
  if (pagamentos.reduce((s, p) => s + num(p.valor), 0) + 0.005 < total) return c.json({ error: 'Os pagamentos não cobrem o novo total' }, 400);

  // Valida todas as novas baixas antes de fazer a primeira movimentação. Isso
  // também cobre dois compostos que disputem o mesmo insumo.
  const necessidades = new Map();
  for (const [produtoId, novo] of novos) {
    const antigo = antigos.find((it) => num(it.produto_id) === produtoId);
    const delta = novo.qtd - num(antigo?.quantidade);
    if (delta <= 0) continue;
    if (novo.produto.tipo === 'composto' && Array.isArray(novo.produto.ficha) && novo.produto.ficha.length) {
      const baixas = await calcularBaixasProduto(env, novo.produto.id, delta);
      for (const baixa of baixas) {
        const atual = necessidades.get(baixa.produto_id) || { nome: baixa.nome, disponivel: baixa.disponivel, qtd: 0 };
        atual.qtd += baixa.quantidade;
        necessidades.set(baixa.produto_id, atual);
      }
    } else {
      const atual = necessidades.get(produtoId) || { nome: novo.produto.nome, disponivel: num(novo.produto.estoque_atual), qtd: 0 };
      atual.qtd += delta;
      necessidades.set(produtoId, atual);
    }
  }
  for (const necessidade of necessidades.values()) {
    if (necessidade.disponivel < necessidade.qtd - 0.0001) {
      return c.json({ error: `Estoque insuficiente de ${necessidade.nome}` }, 400);
    }
  }

  try {
    for (const antigo of antigos) {
      const novo = novos.get(num(antigo.produto_id));
      const delta = num(antigo.quantidade) - (novo?.qtd || 0);
      if (delta <= 0) continue;
      const reducao = reducoes.get(num(antigo.produto_id));
      const produto = await getProdutoFull(env, antigo.produto_id);
      if (reducao.motivo === 'nao_pago') {
        await criarPerda(env, {
          produto_id: antigo.produto_id, quantidade: delta, valor_unitario: num(antigo.preco_unitario),
          motivo: 'Produto não pago', origem: 'pdv_pos_fechamento', item_id: antigo.id,
          responsavel, movimentaEstoque: false,
        });
      } else {
        await movimentarItemPdv(env, produto, delta, true, v, responsavel);
      }
      await env.DB.prepare(
        'INSERT INTO venda_ajustes (venda_id, produto_id, item_id, tipo, quantidade, justificativa, responsavel, criado_em) VALUES (?,?,?,?,?,?,?,?)'
      ).bind(v.id, antigo.produto_id, antigo.id, reducao.motivo, delta, justificativa, responsavel, now()).run();
    }
    for (const [produtoId, novo] of novos) {
      const antigo = antigos.find((it) => num(it.produto_id) === produtoId);
      const delta = novo.qtd - num(antigo?.quantidade);
      if (delta > 0) await movimentarItemPdv(env, novo.produto, delta, false, v, responsavel);
    }
    await env.DB.prepare(
      'INSERT INTO venda_ajustes (venda_id, produto_id, item_id, tipo, quantidade, justificativa, responsavel, criado_em) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(v.id, null, null, 'alteracao_venda', 0, justificativa, responsavel, now()).run();
  } catch (e) {
    return c.json({ error: e?.message || 'Não foi possível movimentar o estoque' }, 400);
  }

  await env.DB.prepare('DELETE FROM venda_itens WHERE venda_id=?').bind(v.id).run();
  const inserts = [...novos.values()].map((it) => env.DB.prepare(
    'INSERT INTO venda_itens (venda_id, produto_id, nome, quantidade, custo_unitario, preco_unitario, total) VALUES (?,?,?,?,?,?,?)'
  ).bind(v.id, it.produto.id, it.produto.nome, it.qtd, num(it.produto.custo), it.preco, it.qtd * it.preco));
  if (inserts.length) await env.DB.batch(inserts);

  await env.DB.prepare('DELETE FROM pagamentos WHERE venda_id=?').bind(v.id).run();
  await env.DB.batch(pagamentos.map((p) => env.DB.prepare('INSERT INTO pagamentos (venda_id, forma, valor) VALUES (?,?,?)').bind(v.id, p.forma || 'dinheiro', num(p.valor))));
  await env.DB.prepare("UPDATE vendas SET subtotal=?, desconto=?, total=?, status=?, responsavel=?, observacoes=? WHERE id=?")
    .bind(subtotal, desconto, total, v.status === 'aguardando_fechamento' ? v.status : 'concluida', responsavel, `${v.observacoes || ''}${v.observacoes ? '\n' : ''}Ajuste pós-fechamento: ${justificativa}`, v.id).run();
  await env.DB.prepare("UPDATE lancamentos SET valor=?, metodo=?, descricao=? WHERE ref_tipo='venda' AND ref_id=?")
    .bind(total, pagamentos[0].forma || 'dinheiro', `Venda ${v.numero} (ajustada)`, v.id).run();
  await env.DB.prepare("UPDATE caixa SET valor=?, metodo=?, observacao=? WHERE tipo='entrada' AND observacao IN (?,?)")
    .bind(total, pagamentos.map((p) => p.forma).join('+'), `Venda ${v.numero} (ajustada)`, `Venda ${v.numero}`, `Venda ${v.numero} (ajustada)`).run();
  return getVendaHandler(c, env);
}

export async function cancelarVendaHandler(c, env) {
  const b = await c.req.json().catch(() => ({}));
  const v = await env.DB.prepare('SELECT * FROM vendas WHERE id=?').bind(c.params.id).first();
  if (!v) return c.json({ error: 'Venda não encontrada' }, 404);
  if (!['concluida', 'aguardando_fechamento'].includes(v.status)) return c.json({ error: 'Venda já cancelada' }, 400);
  const fiscal = await env.DB.prepare('SELECT status FROM documentos_fiscais WHERE venda_id=? LIMIT 1').bind(v.id).first();
  if (fiscal && fiscal.status !== 'cancelada') {
    return c.json({ error: 'Cancele a NFC-e antes de cancelar a venda' }, 409);
  }
  const justificativa = String(b.justificativa || '').trim();
  if (justificativa.length < 5) return c.json({ error: 'Explique o motivo do cancelamento (mínimo de 5 caracteres)' }, 400);
  if (!['devolver_estoque', 'perda'].includes(b.destino)) return c.json({ error: 'Informe o destino dos produtos cancelados' }, 400);
  await env.DB.prepare("UPDATE vendas SET status='cancelada', observacoes=? WHERE id=?")
    .bind(`${v.observacoes || ''}${v.observacoes ? '\n' : ''}Cancelamento: ${justificativa}`, v.id).run();
  const itens = await env.DB.prepare('SELECT * FROM venda_itens WHERE venda_id=?').bind(v.id).all();
  // Reverte todas as baixas da venda (produtos simples e insumos de fichas técnicas),
  // usando as movimentações registradas na venda.
  const movs = await env.DB.prepare("SELECT * FROM estoque_movimentacoes WHERE origem='venda' AND ref_id=?")
    .bind(v.id)
    .all();
  if (b.destino === 'devolver_estoque') {
    for (const m of movs.results) {
      await env.DB.prepare('UPDATE produtos SET estoque_atual = estoque_atual + ? WHERE id=?').bind(m.quantidade, m.produto_id).run();
      const saldo = await env.DB.prepare('SELECT estoque_atual FROM produtos WHERE id=?').bind(m.produto_id).first();
      await registrarMovimentacao(env, {
        produto_id: m.produto_id, tipo: 'entrada', quantidade: m.quantidade, saldo_apos: num(saldo.estoque_atual),
        custo_unitario: m.custo_unitario, origem: 'estorno', ref_id: v.id, responsavel: b.responsavel || null,
        observacoes: `Cancelamento da venda ${v.numero}: ${justificativa}`,
      });
    }
  } else {
    // O estoque já saiu na venda. A perda é apenas classificada, sem nova baixa.
    for (const item of itens.results) {
      if (!item.produto_id) continue;
      await criarPerda(env, {
        produto_id: item.produto_id, quantidade: num(item.quantidade), valor_unitario: num(item.preco_unitario),
        motivo: `Cancelamento de venda: ${justificativa}`, origem: 'cancelamento_venda', item_id: item.id,
        responsavel: b.responsavel || null, movimentaEstoque: false,
      });
    }
  }
  await env.DB.prepare(
    'INSERT INTO venda_ajustes (venda_id, produto_id, item_id, tipo, quantidade, justificativa, responsavel, criado_em) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(v.id, null, null, b.destino === 'perda' ? 'cancelamento_perda' : 'cancelamento_devolucao', 0, justificativa, b.responsavel || null, now()).run();
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
    funcionario: b.responsavel || null,
  });
  return c.json({ ok: true });
}

// ============================ MESAS ============================

export async function listMesasHandler(c, env) {
  const [rows, comandas] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM mesas ORDER BY numero'),
    env.DB.prepare(
    `SELECT c.*, m.numero AS mesa_numero,
     (SELECT COALESCE(SUM(i.quantidade * i.preco_unitario),0) FROM comanda_itens i WHERE i.comanda_id=c.id AND i.status!='cancelado') AS total,
     (SELECT COUNT(*) FROM comanda_itens i WHERE i.comanda_id=c.id AND i.status!='cancelado') AS itens_count
     FROM comandas c JOIN mesas m ON m.id=c.mesa_id WHERE c.status IN ('aberta','pre_fechamento')`
    ),
  ]);
  return c.json({ mesas: rows.results, comandas: comandas.results });
}

export async function createMesaHandler(c, env) {
  const b = await c.req.json();
  const numero = Number(b.numero);
  const capacidade = Number(b.capacidade ?? 4);
  if (!Number.isSafeInteger(numero) || numero <= 0 || !Number.isSafeInteger(capacidade) || capacidade < 1 || capacidade > 1000) {
    return c.json({ error: 'Informe um número de mesa e uma capacidade válidos' }, 400);
  }
  // Reutiliza o número excluído, preservando o ID vinculado ao histórico.
  const r = await env.rawDB.prepare(`INSERT INTO mesas (estabelecimento_id,numero,nome,capacidade,setor,status,ativo,criado_em)
    VALUES (?,?,?,?,?,'livre',1,?) ON CONFLICT(estabelecimento_id,numero) DO UPDATE SET
      nome=excluded.nome,capacidade=excluded.capacidade,setor=excluded.setor,ativo=1
    WHERE mesas.ativo=0 AND mesas.status='livre' AND mesas.tipo='normal'
      AND NOT EXISTS (SELECT 1 FROM comandas c WHERE c.mesa_id=mesas.id AND c.estabelecimento_id=mesas.estabelecimento_id
        AND c.status IN ('aberta','pre_fechamento')) RETURNING *`)
    .bind(estabelecimentoId(env), numero, b.nome || `Mesa ${numero}`, capacidade, b.setor || null, now()).first();
  if (!r) return c.json({ error: 'Já existe uma mesa ativa com este número' }, 409);
  return c.json(r, 201);
}

export async function updateMesaHandler(c, env) {
  const b = await c.req.json();
  if (b.ativo === false || b.ativo === 0) return deleteMesaHandler(c, env);
  await env.DB.prepare('UPDATE mesas SET numero=?, nome=?, capacidade=?, setor=?, ativo=? WHERE id=?')
    .bind(num(b.numero), b.nome, num(b.capacidade) || 4, b.setor || null, b.ativo === false ? 0 : 1, c.params.id)
    .run();
  return c.json({ ok: true });
}

export async function deleteMesaHandler(c, env) {
  const mesa = await env.DB.prepare('SELECT id,ativo,tipo FROM mesas WHERE id=?').bind(c.params.id).first();
  if (!mesa) return c.json({ error: 'Mesa não encontrada' }, 404);
  if (mesa.tipo !== 'normal') return c.json({ error: 'Somente mesas do salão podem ser excluídas aqui' }, 400);
  if (!mesa.ativo) return c.json({ ok: true });
  const result = await env.rawDB.prepare(`UPDATE mesas SET ativo=0 WHERE id=? AND estabelecimento_id=? AND status='livre'
    AND NOT EXISTS (SELECT 1 FROM comandas c WHERE c.mesa_id=mesas.id AND c.estabelecimento_id=mesas.estabelecimento_id
      AND c.status IN ('aberta','pre_fechamento'))`).bind(mesa.id, estabelecimentoId(env)).run();
  if (!result.meta.changes) return c.json({ error: 'Libere a mesa e finalize ou transfira sua comanda antes de excluir' }, 409);
  return c.json({ ok: true });
}

// ============================ COMANDAS ============================

export async function abrirComandaHandler(c, env) {
  const b = await c.req.json();
  const qtd = Number(b.pessoas_count ?? 1);
  if (!Number.isSafeInteger(qtd) || qtd < 1 || qtd > 1000) {
    return c.json({ error: 'Informe de 1 a 1000 pessoas' }, 400);
  }
  const mesa = await env.DB.prepare('SELECT * FROM mesas WHERE id=?').bind(c.params.id).first();
  if (!mesa || !mesa.ativo) return c.json({ error: 'Mesa não encontrada ou excluída' }, 404);
  // As mesas do salão usam a restrição transacional existente; preserve também
  // a proteção das mesas especiais mantidas por instalações anteriores.
  if (mesa.tipo !== 'normal' && await env.DB.prepare("SELECT id FROM comandas WHERE mesa_id=? AND status='aberta' LIMIT 1").bind(mesa.id).first()) {
    return c.json({ error: 'Mesa já está ocupada' }, 409);
  }
  const taxa = b.taxa_garcom_pct ?? (await getConfigValue(env, 'taxa_garcom_pct', '0'));
  const timestamp = now();
  const tenant = estabelecimentoId(env);
  const db = env.rawDB;
  const cores = ['#6366f1', '#16a34a', '#f59e0b', '#ec4899', '#0ea5e9', '#ef4444'];
  const pessoas = JSON.stringify(Array.from({ length: qtd }, (_, index) => ({
    nome: `Pessoa ${index + 1}`, cor: cores[index % cores.length],
  })));
  // Os três comandos fazem parte da mesma transação. Nenhuma tela encontra
  // uma comanda sem suas pessoas, mesmo com aberturas simultâneas.
  const novaComanda = '(SELECT id FROM comandas WHERE mesa_id=? AND estabelecimento_id=? AND status=\'aberta\' AND comanda_origem_id IS NULL ORDER BY id DESC LIMIT 1)';
  let r;
  try {
    [r] = await db.batch([
      db.prepare(`INSERT INTO comandas (estabelecimento_id,mesa_id,cliente_nome,garcom_nome,status,taxa_garcom_pct,pessoas_count,criado_em)
        VALUES (?,?,?,?,'aberta',?,?,?)`)
        .bind(tenant, mesa.id, b.cliente_nome || null, b.garcom_nome || null, num(taxa), qtd, timestamp),
      db.prepare(`INSERT INTO comanda_pessoas (estabelecimento_id,comanda_id,nome,cor,criado_em)
        SELECT ?,${novaComanda},json_extract(value,'$.nome'),json_extract(value,'$.cor'),? FROM json_each(?)`)
        .bind(tenant, mesa.id, tenant, timestamp, pessoas),
      db.prepare("UPDATE mesas SET status='ocupada',aberta_em=? WHERE id=? AND estabelecimento_id=?")
        .bind(timestamp, mesa.id, tenant),
    ]);
  } catch (error) {
    if (String(error?.message).includes('mesa_inativa')) return c.json({ error: 'A mesa foi excluída em outra tela. Atualize a lista de mesas.' }, 409);
    if (String(error?.message).includes('mesa_ja_ocupada')) return c.json({ error: 'A mesa já possui uma conta ativa. Abra a comanda existente.' }, 409);
    throw error;
  }
  const comandaId = r.meta.last_row_id;
  return c.json(await getComandaFull(env, comandaId), 201);
}

async function getComandaFull(env, id, revisao) {
  if (/^\d+$/.test(revisao ?? '')) {
    const atual = await env.DB.prepare('SELECT revisao FROM comandas WHERE id=?').bind(id).first();
    if (!atual) return null;
    if (String(atual.revisao) === revisao) return { sem_alteracoes: true, revisao: atual.revisao };
  }
  // Todos os dados pertencem ao mesmo retrato transacional, incluindo revisão,
  // mesa e status. Um lançamento concorrente aparece inteiro na próxima leitura.
  const [comandas, pessoas, itens, mesas, printing, transfers, vendas] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM comandas WHERE id=?').bind(id),
    env.DB.prepare(`SELECT p.*,a.id AS cartao_atendimento_id,a.cartao AS nfc_cartao
    FROM comanda_pessoas p LEFT JOIN cartao_atendimentos a ON a.pessoa_id=p.id AND a.encerrado_em IS NULL
    WHERE p.comanda_id=? ORDER BY p.id`).bind(id),
    env.DB.prepare(`SELECT i.*,p.nome AS produto_nome,p.unidade FROM comanda_itens i
      LEFT JOIN produtos p ON p.id=i.produto_id WHERE i.comanda_id=? ORDER BY i.id`).bind(id),
    env.DB.prepare('SELECT m.* FROM mesas m JOIN comandas c ON c.mesa_id=m.id WHERE c.id=?').bind(id),
    env.DB.prepare(`SELECT p.item_id,p.impressora_id,
    COALESCE(j.status,t.status,'ausente') AS status,COALESCE(j.erro,t.erro_mensagem) AS erro
    FROM pedido_impressoes p JOIN comanda_itens i ON i.id=p.item_id
    LEFT JOIN gestor_jobs j ON j.pedido_lote_id=p.lote_id LEFT JOIN device_tasks t ON t.id=p.lote_id
    WHERE i.comanda_id=?`).bind(id),
    env.DB.prepare("SELECT id,status FROM comandas WHERE comanda_origem_id=? AND fechamento_tipo='individual' ORDER BY id DESC LIMIT 1").bind(id),
    env.DB.prepare(`SELECT v.id,v.numero,v.total,v.criado_em FROM vendas v JOIN comandas c ON c.id=v.comanda_id
      WHERE v.comanda_id=? AND v.status='concluida' AND c.comanda_origem_id IS NULL ORDER BY v.id`).bind(id),
  ]);
  const c = comandas.results[0];
  if (!c) return null;
  const ativos = itens.results.filter((i) => i.status !== 'cancelado');
  const subtotal = ativos.reduce((s, i) => s + num(i.quantidade) * num(i.preco_unitario), 0);
  const transfer = transfers.results[0];
  const vendasRegistradas = vendas.results;
  const impressoesPorItem = new Map();
  for (const impressao of printing.results) {
    if (!impressoesPorItem.has(impressao.item_id)) impressoesPorItem.set(impressao.item_id, []);
    impressoesPorItem.get(impressao.item_id).push(impressao);
  }
  const ativa = ['aberta', 'pre_fechamento'].includes(c.status);
  const vendasAnteriores = ativa || ['sem_consumo','cancelada','individual'].includes(c.fechamento_tipo) ? vendasRegistradas : vendasRegistradas.slice(0, -1);
  return {
    ...c,
    mesa: mesas.results[0] || null,
    pessoas: pessoas.results,
    itens: itens.results.map((item) => ({ ...item, impressoes: impressoesPorItem.get(item.id) || [] })),
    subtotal,
    transfer_comanda_id: transfer?.id ?? null,
    transfer_comanda_status: transfer?.status ?? null,
    vendas_anteriores: vendasAnteriores,
    pode_fechar_pedidos_novos: ativa && somentePedidosPosteriores(ativos, vendasAnteriores),
  };
}

export async function getComandaHandler(c, env) {
  const data = await getComandaFull(env, c.params.id, c.req.query?.('revisao'));
  if (!data) return c.json({ error: 'Comanda não encontrada' }, 404);
  return c.json(data);
}

export async function addPessoaHandler(c, env) {
  const b = await c.req.json();
  const tenant = estabelecimentoId(env), db = env.rawDB;
  // A contagem é calculada dentro da mesma transação da inserção, evitando
  // sobrescrever o total quando dispositivos acrescentam pessoas juntos.
  const [r] = await db.batch([
    db.prepare(`INSERT INTO comanda_pessoas (estabelecimento_id,comanda_id,nome,cor,criado_em)
      SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM comandas WHERE id=? AND estabelecimento_id=? AND status='aberta')`)
      .bind(tenant, c.params.id, b.nome || null, b.cor || '#6366f1', now(), c.params.id, tenant),
    db.prepare(`UPDATE comandas SET pessoas_count=(SELECT COUNT(*) FROM comanda_pessoas
      WHERE comanda_id=? AND estabelecimento_id=?) WHERE id=? AND estabelecimento_id=? AND status='aberta'`)
      .bind(c.params.id, tenant, c.params.id, tenant),
  ]);
  if (!r.meta.changes) return c.json({ error: 'Comanda não encontrada' }, 404);
  return c.json({ id: r.meta.last_row_id, comanda_id: num(c.params.id), nome: b.nome || null, cor: b.cor || '#6366f1' }, 201);
}

export async function removePessoaHandler(c, env) {
  const pessoa = await env.DB.prepare(`SELECT p.id,c.status,c.fechamento_bloqueado_ate FROM comanda_pessoas p
    JOIN comandas c ON c.id=p.comanda_id WHERE p.id=? AND p.comanda_id=?`)
    .bind(c.params.pid, c.params.id).first();
  if (!pessoa) return c.json({ error: 'Pessoa não encontrada nesta comanda' }, 404);
  const timestamp = now();
  if (pessoa.status !== 'aberta' || pessoa.fechamento_bloqueado_ate > timestamp) {
    return c.json({ error: 'A comanda não está aberta para remover pessoas' }, 409);
  }
  const cartao = await env.DB.prepare('SELECT id FROM cartao_atendimentos WHERE pessoa_id=? AND encerrado_em IS NULL').bind(c.params.pid).first();
  if (cartao) return c.json({ error: 'Esta pessoa tem um cartão em atendimento. Feche sua conta na Recepção antes de remover.' }, 409);
  const tenant = estabelecimentoId(env), db = env.rawDB;
  const aberta = `EXISTS (SELECT 1 FROM comandas WHERE id=? AND estabelecimento_id=? AND status='aberta'
    AND (fechamento_bloqueado_ate IS NULL OR fechamento_bloqueado_ate<=?))`;
  let removida;
  try {
    // Preserva todos os pedidos na conta geral. A remoção e a contagem precisam
    // confirmar juntas para a divisão da conta nunca usar pessoas inexistentes.
    [, removida] = await db.batch([
      db.prepare(`UPDATE comanda_itens SET pessoa_id=NULL WHERE pessoa_id=? AND comanda_id=? AND estabelecimento_id=?
        AND EXISTS (SELECT 1 FROM comanda_pessoas WHERE id=? AND comanda_id=? AND estabelecimento_id=?) AND ${aberta}`)
        .bind(c.params.pid, c.params.id, tenant, c.params.pid, c.params.id, tenant, c.params.id, tenant, timestamp),
      db.prepare(`DELETE FROM comanda_pessoas WHERE id=? AND comanda_id=? AND estabelecimento_id=? AND ${aberta}`)
        .bind(c.params.pid, c.params.id, tenant, c.params.id, tenant, timestamp),
      db.prepare(`UPDATE comandas SET pessoas_count=(SELECT COUNT(*) FROM comanda_pessoas
        WHERE comanda_id=? AND estabelecimento_id=?) WHERE id=? AND estabelecimento_id=? AND status='aberta'
        AND (fechamento_bloqueado_ate IS NULL OR fechamento_bloqueado_ate<=?)`)
        .bind(c.params.id, tenant, c.params.id, tenant, timestamp),
    ]);
  } catch (error) {
    if (String(error?.message).includes('cartao_em_atendimento')) {
      return c.json({ error: 'Esta pessoa tem um cartão em atendimento. Feche sua conta na Recepção antes de remover.' }, 409);
    }
    throw error;
  }
  if (!removida.meta.changes) return c.json({ error: 'A comanda ou a pessoa mudou. Atualize antes de remover novamente.' }, 409);
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
  const result = await saveOrderItems(c, env, { chave: b.chave || crypto.randomUUID(), itens: [b] });
  return c.json(result.itens[0], result.repetido ? 200 : 201);
}

export async function updateItemComandaHandler(c, env) {
  const b = await c.req.json();
  const item = await env.DB.prepare(
    `SELECT i.* FROM comanda_itens i
     JOIN comandas c ON c.id=i.comanda_id
     WHERE i.id=? AND i.comanda_id=? AND c.status='aberta'`
  ).bind(c.params.item_id, c.params.id).first();
  if (!item) return c.json({ error: 'Item não encontrado ou comanda bloqueada' }, 404);
  if (item.status !== 'novo') return c.json({ error: 'Somente itens ainda não enviados podem ser alterados' }, 409);
  if (await env.DB.prepare('SELECT item_id FROM pedido_impressoes WHERE item_id=? LIMIT 1').bind(item.id).first()) {
    return c.json({ error: 'Este item já entrou na fila de impressão. Suas observações não podem ser alteradas.' }, 409);
  }

  let observacao = '';
  let preco = num(item.preco_unitario);
  let ids = [];
  try {
    const cadastrados = item.produto_id ? await acrescimosDoProduto(env, item.produto_id) : [];
    const anteriores = separarObservacao(item.observacao, cadastrados);
    const idsAntes = item.acrescimos_json ? idsAcrescimo(JSON.parse(item.acrescimos_json)) : anteriores.ids;
    ids = Array.isArray(b.acrescimos) ? idsAcrescimo(b.acrescimos) : idsAntes;
    const escolhidos = selecionarAcrescimos(ids, cadastrados);
    const extraAntes = precoComAcrescimos(0, selecionarAcrescimos(idsAntes, cadastrados));
    const base = arredondar(num(item.preco_unitario) - extraAntes);
    preco = precoComAcrescimos(Math.max(0, base), escolhidos);
    const livres = typeof b.observacao === 'string' ? b.observacao : anteriores.livres.join('\n');
    observacao = observacaoComAcrescimos(livres, escolhidos);
  } catch (error) {
    return c.json({ error: error?.message || 'Acréscimo inválido' }, error?.status || 400);
  }
  const updated = await env.DB.prepare(`UPDATE comanda_itens SET observacao=?, preco_unitario=?, acrescimos_json=? WHERE id=? AND comanda_id=? AND versao=?
    AND status='novo' AND NOT EXISTS (SELECT 1 FROM pedido_impressoes WHERE item_id=comanda_itens.id)
    AND EXISTS (SELECT 1 FROM comandas WHERE id=? AND status='aberta' AND (fechamento_bloqueado_ate IS NULL OR fechamento_bloqueado_ate<=?))`)
    .bind(observacao || null, preco, ids.length ? JSON.stringify(ids) : null, item.id, item.comanda_id, item.versao, item.comanda_id, now())
    .run();
  if (!updated.meta.changes) return c.json({ error: 'Pedido alterado em outra tela. Atualize e tente novamente.' }, 409);
  return c.json({ ...item, observacao: observacao || null, preco_unitario: preco, acrescimos_json: ids.length ? JSON.stringify(ids) : null, versao: item.versao + 1 });
}

export async function updateItemStatusHandler(c, env) {
  const b = await c.req.json();
  if (b.status === 'enviado') return c.json(await dispatchOrders(c, env, { comanda_id: Number(c.params.id), itens_ids: [Number(c.params.item_id)] }));
  const item = await env.DB.prepare(`SELECT i.* FROM comanda_itens i JOIN comandas c ON c.id=i.comanda_id
    WHERE i.id=? AND i.comanda_id=? AND c.status='aberta'`).bind(c.params.item_id, c.params.id).first();
  if (!item) return c.json({ error: 'Item não encontrado' }, 404);
  const novoStatus = b.status;
  const validos = ['novo', 'enviado', 'entregue', 'cancelado', 'perda'];
  if (!validos.includes(novoStatus)) return c.json({ error: 'Status inválido' }, 400);

  const updated = await env.DB.prepare(`UPDATE comanda_itens SET status=?, enviado_em=? WHERE id=? AND comanda_id=? AND versao=?
    AND EXISTS (SELECT 1 FROM comandas WHERE id=? AND status='aberta' AND (fechamento_bloqueado_ate IS NULL OR fechamento_bloqueado_ate<=?))`)
    .bind(novoStatus, novoStatus === 'enviado' ? now() : item.enviado_em, item.id, item.comanda_id, item.versao, item.comanda_id, now())
    .run();
  if (!updated.meta.changes) return c.json({ error: 'Pedido alterado em outra tela. Atualize e tente novamente.' }, 409);

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
  // Reserva o fechamento antes de ler os itens: uma transferência não pode
  // mudar a conta depois que seu total começou a ser calculado.
  const until = new Date(Date.now() + 5 * 60_000).toISOString();
  const acquired = await env.DB.prepare(`UPDATE comandas SET fechamento_bloqueado_ate=?
    WHERE id=? AND status IN ('aberta','pre_fechamento')
    AND (fechamento_bloqueado_ate IS NULL OR fechamento_bloqueado_ate<=?)`)
    .bind(until, c.params.id, now()).run();
  if (!acquired.meta.changes) {
    const atual = await env.DB.prepare('SELECT id,status FROM comandas WHERE id=?').bind(c.params.id).first();
    if (!atual) return c.json({ error: 'Comanda não encontrada' }, 404);
    if (atual.status === 'fechada') return c.json({ error: `A comanda nº ${atual.id} já está fechada. Volte às mesas para continuar.`, code: 'COMANDA_FECHADA' }, 409);
    return c.json({ error: `A comanda nº ${atual.id} possui um fechamento em andamento. Você pode voltar às mesas enquanto aguarda e atualizar depois.`, code: 'FECHAMENTO_EM_ANDAMENTO' }, 409);
  }
  try {
    return await fecharComandaReservada(c, { ...env, fechamentoReserva: until });
  } finally {
    await env.DB.prepare('UPDATE comandas SET fechamento_bloqueado_ate=NULL WHERE id=? AND fechamento_bloqueado_ate=?')
      .bind(c.params.id, until).run();
  }
}

async function fecharComandaReservada(c, env) {
  const b = await c.req.json();
  const com = await env.DB.prepare('SELECT * FROM comandas WHERE id=? AND status IN (?,?)')
    .bind(c.params.id, 'aberta', 'pre_fechamento')
    .first();
  if (!com) return c.json({ error: 'Comanda não encontrada' }, 404);
  if (com.comanda_origem_id) return c.json({ error: 'Esta conta usa pagamentos individuais. Baixe cada pessoa na tela Pagamentos Individuais.' }, 409);
  if (b.tipo === 'individual' && await env.DB.prepare('SELECT id FROM cartao_atendimentos WHERE comanda_id=? AND encerrado_em IS NULL LIMIT 1').bind(com.id).first()) {
    return c.json({ error: 'Feche os cartões individualmente na Recepção. Cada cliente pode sair sem encerrar a mesa inteira.' }, 409);
  }
  const anteriores = (await env.DB.prepare("SELECT id,criado_em FROM vendas WHERE comanda_id=? AND status='concluida' ORDER BY id").bind(com.id).all()).results;
  const itens = await env.DB.prepare(
    "SELECT * FROM comanda_itens WHERE comanda_id=? AND status!='cancelado'"
  )
    .bind(com.id)
    .all();

  // Encerrar ocupação vazia é diferente de dar baixa financeira. Vendas antigas
  // permanecem intactas e exigem confirmação explícita, nunca um estorno automático.
  if (!itens.results.length) {
    if (anteriores.length && b.liberar_vazia !== true) return c.json({ error: `A comanda ${com.id} está vazia, mas já possui a venda #${anteriores[0].id}. Use Liberar mesa vazia para encerrar somente a ocupação, sem alterar as vendas anteriores.` }, 409);
    const tipoVazio = b.liberar_vazia === true ? 'sem_consumo' : (b.tipo || com.fechamento_tipo || 'unica');
    const db = env.rawDB;
    const tenant = estabelecimentoId(env);
    const timestamp = now();
    try {
      await db.batch([
        db.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM comandas c WHERE c.id=? AND c.estabelecimento_id=?
          AND c.status IN ('aberta','pre_fechamento') AND c.comanda_origem_id IS NULL AND c.fechamento_bloqueado_ate=?
          AND NOT EXISTS (SELECT 1 FROM comanda_itens i WHERE i.comanda_id=c.id AND i.estabelecimento_id=? AND i.status!='cancelado')
          AND NOT EXISTS (SELECT 1 FROM comandas filha WHERE filha.comanda_origem_id=c.id AND filha.estabelecimento_id=?
            AND filha.status IN ('aberta','pre_fechamento'))
          AND NOT EXISTS (SELECT 1 FROM comandas outra WHERE outra.mesa_id=c.mesa_id AND outra.estabelecimento_id=?
            AND outra.id!=c.id AND outra.status IN ('aberta','pre_fechamento'))
          AND (?=1 OR NOT EXISTS (SELECT 1 FROM vendas v WHERE v.comanda_id=c.id AND v.estabelecimento_id=? AND v.status='concluida')))
          THEN 1 ELSE abs(-9223372036854775808) END`)
          .bind(com.id, tenant, env.fechamentoReserva, tenant, tenant, tenant, b.liberar_vazia === true ? 1 : 0, tenant),
        db.prepare(`UPDATE comandas SET status='fechada',fechamento_tipo=?,fechada_em=?,baixada_em=? WHERE id=? AND estabelecimento_id=?`)
          .bind(tipoVazio, timestamp, b.liberar_vazia === true ? null : timestamp, com.id, tenant),
        db.prepare("UPDATE mesas SET status='livre',aberta_em=NULL WHERE id=? AND estabelecimento_id=?").bind(com.mesa_id, tenant),
      ]);
    } catch (error) {
      if (/integer overflow/i.test(error.message)) return c.json({ error: 'A mesa mudou ou possui pagamentos individuais pendentes. Atualize antes de liberar.' }, 409);
      throw error;
    }
    return c.json({ ok: true, comanda_id: com.id, vendas: [], total: 0, mesa_liberada: true,
      vendas_anteriores: anteriores.map((v) => v.id), mensagem: 'Mesa vazia liberada sem nova venda, pagamento ou movimentação de estoque' });
  }

  if (b.liberar_vazia === true) return c.json({ error: 'A mesa recebeu produtos. Confira os pedidos antes de fechar a conta.' }, 409);
  if (anteriores.length) {
    if (!somentePedidosPosteriores(itens.results, anteriores)) return c.json({ error: `A comanda ${com.id} já possui a venda #${anteriores[0].id} e contém produtos que podem ter sido cobrados antes. Isso exige conferência do histórico, não é um fechamento em andamento. Uma nova baixa só é permitida quando todos os pedidos ativos foram lançados depois da última venda.`, code: 'ITENS_COM_VENDA_ANTERIOR' }, 409);
    env = { ...env, fechamentoValidacoes: [validarHistoricoFechamento(env, com.id, itens.results, anteriores)] };
  }

  const taxaPct = b.taxa_garcom_pct !== undefined ? num(b.taxa_garcom_pct) : num(com.taxa_garcom_pct);
  if (!Number.isFinite(taxaPct) || taxaPct < 0 || taxaPct > 100) {
    return c.json({ error: 'Taxa de serviço deve ser um percentual entre 0 e 100' }, 400);
  }
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
    const preFechamento = env.DB.prepare(
      "UPDATE comandas SET status='pre_fechamento', fechamento_tipo=?, taxa_garcom_pct=?, pre_fechamento_em=? WHERE id=?"
    )
      .bind(tipo, taxaPct, now(), com.id);
    if (env.fechamentoValidacoes?.length) {
      try { await env.DB.batch([...env.fechamentoValidacoes, preFechamento]); }
      catch (error) {
        if (/integer overflow/i.test(error.message)) return c.json({ error: 'Os pedidos ou o histórico de vendas mudaram. Atualize a comanda antes de fechar.' }, 409);
        throw error;
      }
    } else await preFechamento.run();
    const subtotal = itens.results.reduce((s, i) => s + num(i.quantidade) * num(i.preco_unitario), 0);
    return c.json({
      ok: true,
      pre_fechamento: true,
      comanda_id: com.id,
      total: num((subtotal * (1 + taxaPct / 100)).toFixed(2)),
      mensagem: 'Conta pré-fechada. Imprima e baixe quando o pagamento for recebido.',
    });
  }

  const itemsComanda = itens.results.map((i) => ({ ...i, total: num(i.quantidade) * num(i.preco_unitario) }));

  let vendasCriadas = [];
  const totalGeral = itemsComanda.reduce((s, i) => s + i.total, 0);

  const taxa = totalGeral * (taxaPct / 100);
  const venda = await criarVendaRestaurante(env, {
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
  }, [
    env.DB.prepare(`UPDATE comandas SET status='fechada', fechamento_tipo=?, taxa_garcom_pct=?, fechada_em=?, baixada_em=? WHERE id=?`)
      .bind(tipo, taxaPct, now(), now(), com.id),
    env.DB.prepare("UPDATE mesas SET status='livre', aberta_em=NULL WHERE id=?").bind(com.mesa_id),
  ]);
  vendasCriadas.push(venda);

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

export async function baixarPessoaComandaHandler(c, env) {
  const until = new Date(Date.now() + 5 * 60_000).toISOString();
  const acquired = await env.DB.prepare(`UPDATE comandas SET fechamento_bloqueado_ate=? WHERE id=? AND status='pre_fechamento'
    AND (fechamento_bloqueado_ate IS NULL OR fechamento_bloqueado_ate<=?)`).bind(until, c.params.id, now()).run();
  if (!acquired.meta.changes) return c.json({ error: 'Existe um pagamento em andamento. Atualize e tente novamente.' }, 409);
  try { return await baixarPessoaReservada(c, { ...env, fechamentoReserva: until }); }
  finally {
    await env.DB.prepare('UPDATE comandas SET fechamento_bloqueado_ate=NULL WHERE id=? AND fechamento_bloqueado_ate=?')
      .bind(c.params.id, until).run();
  }
}

async function baixarPessoaReservada(c, env) {
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
  const concluir = [
    env.DB.prepare("UPDATE comanda_pessoas SET status='baixado', baixada_em=? WHERE id=?").bind(now(), pessoa.id),
    env.DB.prepare(`UPDATE comandas SET status='fechada',baixada_em=? WHERE id=?
      AND NOT EXISTS (SELECT 1 FROM comanda_pessoas WHERE comanda_id=? AND status='pendente')`)
      .bind(now(), com.id, com.id),
  ];
  if (com.comanda_origem_id) {
    concluir.push(env.DB.prepare(`UPDATE comandas SET status='fechada',fechada_em=? WHERE id=?
      AND EXISTS (SELECT 1 FROM comandas WHERE id=? AND status='fechada')`).bind(now(), com.comanda_origem_id, com.id));
    concluir.push(env.DB.prepare(`UPDATE mesas SET status='livre',aberta_em=NULL
      WHERE id=(SELECT mesa_id FROM comandas WHERE id=? AND status='fechada')`).bind(com.comanda_origem_id));
  }
  const venda = await criarVendaRestaurante(env, {
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
  }, concluir);

  const data = await getComandaFull(env, com.id);
  return c.json({ ok: true, venda, fechou: data.status === 'fechada', comanda: data });
}
