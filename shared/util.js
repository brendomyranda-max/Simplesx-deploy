function randBytesHex(n) {
  const arr = new Uint8Array(n);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

import { converterQuantidade, custoLinha, arredondar } from './units.js';

export const now = () => new Date().toISOString();
export const hoje = () => new Date().toISOString().slice(0, 10);
export const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));
export const randHex = () => randBytesHex(8);
export const gerarToken = () => randBytesHex(16);

export const MOD_GESTOR = 'gestor';
export const MOD_PDV = 'pdv_mercado';
export const MOD_RESTAURANTE = 'restaurante';

export function modulosFromString(s) {
  if (!s) return [];
  return String(s)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

export function modulosToString(modulos) {
  if (Array.isArray(modulos)) {
    const arr = modulos.filter(Boolean).map((x) => String(x).trim());
    if (!arr.length) return MOD_RESTAURANTE;
    return [...new Set(arr)].join(',');
  }
  const s = String(modulos || '').trim();
  return s || MOD_RESTAURANTE;
}

export function temModulo(user, modulo) {
  if (!user || !user.modulos) return false;
  if (Array.isArray(user.modulos) && user.modulos.includes(MOD_GESTOR)) return true;
  if (user.modulos.includes(modulo)) return true;
  return false;
}

export function addDays(iso, days) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function diasAte(iso) {
  const hojeD = new Date(hoje()).getTime();
  const alvo = new Date(String(iso).slice(0, 10)).getTime();
  return Math.round((alvo - hojeD) / 86400000);
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const httpError = (status, message) => new HttpError(status, message);

let memoryKv = new Map();

export async function kvGet(env, key) {
  if (env && env.AUTH_KV && typeof env.AUTH_KV.get === 'function') {
    return env.AUTH_KV.get(key);
  }
  return memoryKv.get(key) || null;
}

export async function kvPut(env, key, val, opts) {
  if (env && env.AUTH_KV && typeof env.AUTH_KV.put === 'function') {
    return env.AUTH_KV.put(key, val, opts);
  }
  memoryKv.set(key, val);
}

export function patternToRegex(pattern) {
  const names = [];
  const re = new RegExp(
    '^' +
      pattern.replace(/:[a-zA-Z0-9_]+/g, (m) => {
        names.push(m.slice(1));
        return '([^/]+)';
      }) +
      '$'
  );
  return { re, names };
}

export async function getConfig(env) {
  const rows = await env.DB.prepare('SELECT chave, valor FROM empresa_config').all();
  const map = {};
  for (const r of rows.results) map[r.chave] = r.valor;
  return map;
}

export async function getConfigValue(env, key, def) {
  const r = await env.DB.prepare('SELECT valor FROM empresa_config WHERE chave=?').bind(key).first();
  return r ? r.valor : def;
}

export async function setConfig(env, key, value) {
  await env.DB.prepare(
    'INSERT INTO empresa_config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor'
  )
    .bind(key, String(value))
    .run();
}

export function fmtBRL(v) {
  return (num(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export async function getFichaCompleta(env, id) {
  const rows = await env.DB.prepare(
    `SELECT f.id, f.insumo_id, f.quantidade, f.unidade,
            p.nome AS insumo_nome, p.unidade AS insumo_unidade, p.custo AS insumo_custo,
            p.estoque_atual AS insumo_estoque
     FROM ficha_tecnica f JOIN produtos p ON p.id=f.insumo_id
     WHERE f.produto_id=? ORDER BY f.id`
  )
    .bind(id)
    .all();
  return rows.results.map((r) => ({ ...r, custo_linha: custoLinha(r.quantidade, r.unidade, r.insumo_unidade, r.insumo_custo) }));
}

export async function getProdutoFull(env, id) {
  const p = await env.DB.prepare('SELECT * FROM produtos WHERE id=?').bind(id).first();
  if (!p) return null;
  const cats = await env.DB.prepare(
    'SELECT c.id, c.nome, c.cor FROM produto_categorias pc JOIN categorias c ON c.id=pc.categoria_id WHERE pc.produto_id=?'
  )
    .bind(id)
    .all();
  const cods = await env.DB.prepare(
    'SELECT id, codigo, principal FROM produto_codigos_barras WHERE produto_id=? ORDER BY principal DESC, id'
  )
    .bind(id)
    .all();
  const coments = await env.DB.prepare('SELECT texto FROM produto_comentarios WHERE produto_id=? ORDER BY ordem, id')
    .bind(id)
    .all();
  const ficha = p.tipo === 'composto' ? await getFichaCompleta(env, id) : [];
  let estoque_possivel = null;
  if (p.tipo === 'composto' && ficha.length) {
    const possiveis = [];
    for (const f of ficha) {
      const conv = converterQuantidade(f.quantidade, f.unidade, f.insumo_unidade);
      possiveis.push(conv === null || conv <= 0 ? 0 : Math.floor(num(f.insumo_estoque) / conv));
    }
    estoque_possivel = Math.min(...possiveis);
  }
  return {
    ...p,
    categorias: cats.results,
    codigos_barras: cods.results,
    comentarios: coments.results.map((r) => r.texto),
    ficha,
    ficha_count: ficha.length,
    estoque_possivel,
  };
}

// Calcula o CMV (custo) de um produto composto a partir da lista de ingredientes.
// ingredientes: [{ insumo_id, quantidade, unidade }]
export async function calcularCmvFicha(env, ingredientes) {
  if (!Array.isArray(ingredientes) || !ingredientes.length) throw httpError(400, 'Ficha técnica vazia: adicione pelo menos um insumo');
  const ids = ingredientes.map((i) => num(i.insumo_id));
  const ph = ids.map(() => '?').join(',');
  const rows = await env.DB.prepare(`SELECT id, unidade, custo FROM produtos WHERE id IN (${ph})`)
    .bind(...ids)
    .all();
  const map = new Map(rows.results.map((r) => [r.id, r]));
  let total = 0;
  for (const ing of ingredientes) {
    const ins = map.get(num(ing.insumo_id));
    if (!ins) throw httpError(400, 'Insumo não encontrado na ficha técnica');
    const qtd = num(ing.quantidade);
    if (qtd <= 0) throw httpError(400, 'Quantidade inválida na ficha técnica');
    const conv = converterQuantidade(qtd, ing.unidade, ins.unidade);
    if (conv === null) throw httpError(400, `Unidade ${ing.unidade} incompatível com o insumo (${ins.unidade})`);
    total += conv * num(ins.custo);
  }
  return arredondar(total);
}

export async function salvarFicha(env, produtoId, ingredientes) {
  const stmts = [env.DB.prepare('DELETE FROM ficha_tecnica WHERE produto_id=?').bind(produtoId)];
  for (const ing of ingredientes) {
    stmts.push(
      env.DB.prepare('INSERT INTO ficha_tecnica (produto_id, insumo_id, quantidade, unidade, criado_em) VALUES (?,?,?,?,?)').bind(
        produtoId,
        num(ing.insumo_id),
        num(ing.quantidade),
        ing.unidade || 'UN',
        now()
      )
    );
  }
  await env.DB.batch(stmts);
}

// Recalcula o CMV de todos os produtos compostos que usam um determinado insumo.
export async function recalcularCmvDeInsumo(env, insumoId) {
  const rows = await env.DB.prepare('SELECT DISTINCT produto_id FROM ficha_tecnica WHERE insumo_id=?')
    .bind(insumoId)
    .all();
  const stmts = [];
  for (const r of rows.results) {
    const ficha = await getFichaCompleta(env, r.produto_id);
    const ing = ficha.map((x) => ({ insumo_id: x.insumo_id, quantidade: x.quantidade, unidade: x.unidade }));
    const cmv = await calcularCmvFicha(env, ing);
    stmts.push(env.DB.prepare('UPDATE produtos SET custo=?, atualizado_em=? WHERE id=?').bind(cmv, now(), r.produto_id));
  }
  if (stmts.length) await env.DB.batch(stmts);
}

export async function buscarProdutoPorCodigo(env, codigo) {
  const limpo = String(codigo).trim();
  const row = await env.DB.prepare('SELECT produto_id FROM produto_codigos_barras WHERE codigo=?')
    .bind(limpo)
    .first();
  if (row) return getProdutoFull(env, row.produto_id);
  const interno = await env.DB.prepare('SELECT id FROM produtos WHERE codigo_interno=?')
    .bind(limpo)
    .first();
  if (interno) return getProdutoFull(env, interno.id);
  return null;
}

export async function registrarMovimentacao(env, o) {
  await env.DB.prepare(
    `INSERT INTO estoque_movimentacoes
     (produto_id, tipo, quantidade, saldo_apos, custo_unitario, preco_unitario, origem, ref_id, responsavel, observacoes, criado_em)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      o.produto_id,
      o.tipo,
      num(o.quantidade),
      num(o.saldo_apos),
      o.custo_unitario ?? null,
      o.preco_unitario ?? null,
      o.origem ?? null,
      o.ref_id ?? null,
      o.responsavel ?? null,
      o.observacoes ?? null,
      now()
    )
    .run();
}

export async function baixarEstoque(env, produto_id, qtd, opts = {}) {
  const p = await env.DB.prepare('SELECT estoque_atual, custo FROM produtos WHERE id=?').bind(produto_id).first();
  if (!p) throw httpError(404, 'Produto não encontrado');
  const novoSaldo = Math.max(0, num(p.estoque_atual) - qtd);
  await env.DB.prepare('UPDATE produtos SET estoque_atual=? WHERE id=?').bind(novoSaldo, produto_id).run();
  await registrarMovimentacao(env, {
    produto_id,
    tipo: 'saida',
    quantidade: qtd,
    saldo_apos: novoSaldo,
    custo_unitario: num(p.custo),
    preco_unitario: opts.preco_unitario ?? null,
    origem: opts.origem ?? null,
    ref_id: opts.ref_id ?? null,
    responsavel: opts.responsavel ?? null,
    observacoes: opts.observacoes ?? null,
  });
}

export async function registrarLancamento(env, o) {
  await env.DB.prepare(
    'INSERT INTO lancamentos (data, tipo, categoria, descricao, valor, metodo, ref_tipo, ref_id, criado_em) VALUES (?,?,?,?,?,?,?,?,?)'
  )
    .bind(o.data, o.tipo, o.categoria ?? null, o.descricao, num(o.valor), o.metodo ?? null, o.ref_tipo ?? null, o.ref_id ?? null, now())
    .run();
}

export async function registrarCaixa(env, o) {
  await env.DB.prepare(
    'INSERT INTO caixa (data, tipo, valor, metodo, observacao, funcionario, criado_em) VALUES (?,?,?,?,?,?,?)'
  )
    .bind(o.data, o.tipo, num(o.valor), o.metodo ?? null, o.observacao ?? null, o.funcionario ?? null, now())
    .run();
}

export async function criarPerda(env, o) {
  const movimenta = o.movimentaEstoque !== false;
  const r = await env.DB.prepare(
    'INSERT INTO perdas (produto_id, quantidade, valor_unitario, motivo, origem, comanda_id, item_id, responsavel, criado_em) VALUES (?,?,?,?,?,?,?,?,?)'
  )
    .bind(
      o.produto_id ?? null,
      num(o.quantidade),
      num(o.valor_unitario),
      o.motivo,
      o.origem ?? 'outro',
      o.comanda_id ?? null,
      o.item_id ?? null,
      o.responsavel ?? null,
      now()
    )
    .run();
  const id = r.meta.last_row_id;
  if (movimenta && o.produto_id) {
    await baixarEstoque(env, o.produto_id, num(o.quantidade), {
      origem: 'perda',
      ref_id: id,
      responsavel: o.responsavel,
      observacoes: `Perda: ${o.motivo}`,
    });
  }
  if (movimenta) {
    const p = o.produto_id
      ? await env.DB.prepare('SELECT custo FROM produtos WHERE id=?').bind(o.produto_id).first()
      : null;
    const custo = p ? num(p.custo) : 0;
    const valor = num(o.valor_unitario) * num(o.quantidade) || custo * num(o.quantidade);
    await registrarLancamento(env, {
      data: now(),
      tipo: 'despesa',
      categoria: 'Perda',
      descricao: `Perda: ${o.motivo}`,
      valor,
      metodo: 'perda',
      ref_tipo: 'perda',
      ref_id: id,
    });
  }
  return id;
}

export async function gerarNumeroVenda(env, tipo) {
  const data = hoje().replace(/-/g, '');
  const seq = await env.DB.prepare("SELECT COUNT(*) AS c FROM vendas WHERE numero LIKE ?").bind(`%${data}%`).first();
  return `${String(tipo).toUpperCase()}-${data}-${String(num(seq ? seq.c : 0) + 1).padStart(3, '0')}`;
}
