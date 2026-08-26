function randBytesHex(n) {
  const arr = new Uint8Array(n);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

import { custoLinhaEmbalagem, quantidadeEmUnidadesEstoque, arredondar } from './units.js';

export const now = () => new Date().toISOString();
export const hoje = () => {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (tipo) => partes.find((p) => p.type === tipo)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
};
export const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));
export const randHex = () => randBytesHex(8);
export const gerarToken = () => randBytesHex(16);
export async function sha256(value) {
  const data = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashSenha(senha) {
  const salt = randBytesHex(16).toLowerCase();
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(senha)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 },
    material,
    256
  );
  const hash = Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:${salt}:${hash}`;
}

export async function verificarSenha(senha, armazenada) {
  const [tipo, salt, esperado] = String(armazenada || '').split(':');
  if (tipo !== 'pbkdf2' || !salt || !esperado) return false;
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(senha)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 },
    material,
    256
  );
  const atual = Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('');
  if (atual.length !== esperado.length) return false;
  let diferenca = 0;
  for (let i = 0; i < atual.length; i++) diferenca |= atual.charCodeAt(i) ^ esperado.charCodeAt(i);
  return diferenca === 0;
}

export function estabelecimentoId(env) {
  const id = num(env?.estabelecimentoId);
  if (!id) throw httpError(401, 'Estabelecimento não identificado');
  return id;
}

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
  const item = memoryKv.get(key);
  if (!item) return null;
  if (item.expiraEm && item.expiraEm <= Date.now()) {
    memoryKv.delete(key);
    return null;
  }
  return item.valor;
}

export async function kvPut(env, key, val, opts) {
  if (env && env.AUTH_KV && typeof env.AUTH_KV.put === 'function') {
    return env.AUTH_KV.put(key, val, opts);
  }
  memoryKv.set(key, {
    valor: val,
    expiraEm: opts?.expirationTtl ? Date.now() + Number(opts.expirationTtl) * 1000 : null,
  });
}

export const soDigitos = (value) => String(value || '').replace(/\D/g, '');

export function cnpjValido(value) {
  const cnpj = soDigitos(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const digito = (base, pesos) => {
    const soma = pesos.reduce((total, peso, i) => total + Number(base[i]) * peso, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const d1 = digito(cnpj, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digito(cnpj, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return Number(cnpj[12]) === d1 && Number(cnpj[13]) === d2;
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
  const rows = await env.DB.prepare('SELECT chave, valor FROM empresa_config WHERE estabelecimento_id=?')
    .bind(estabelecimentoId(env)).all();
  const map = {};
  for (const r of rows.results) map[r.chave] = r.valor;
  return map;
}

export async function getConfigValue(env, key, def) {
  const r = await env.DB.prepare('SELECT valor FROM empresa_config WHERE estabelecimento_id=? AND chave=?')
    .bind(estabelecimentoId(env), key).first();
  return r ? r.valor : def;
}

export async function setConfig(env, key, value) {
  await env.DB.prepare(
    'INSERT INTO empresa_config (estabelecimento_id, chave, valor) VALUES (?, ?, ?) ON CONFLICT(estabelecimento_id, chave) DO UPDATE SET valor=excluded.valor'
  )
    .bind(estabelecimentoId(env), key, String(value))
    .run();
}

export function fmtBRL(v) {
  return (num(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export async function getFichaCompleta(env, id) {
  const rows = await env.DB.prepare(
    `SELECT f.id, f.insumo_id, f.quantidade, f.unidade,
            p.nome AS insumo_nome, p.unidade AS insumo_unidade, p.custo AS insumo_custo,
            p.estoque_atual AS insumo_estoque, p.conteudo_quantidade, p.conteudo_unidade
     FROM ficha_tecnica f JOIN produtos p ON p.id=f.insumo_id
     WHERE f.produto_id=? ORDER BY f.id`
  )
    .bind(id)
    .all();
  return rows.results.map((r) => ({ ...r, custo_linha: custoLinhaEmbalagem(r.quantidade, r.unidade, r.insumo_unidade, r.insumo_custo, r.conteudo_quantidade, r.conteudo_unidade) }));
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
    const baixas = await calcularBaixasProduto(env, id, 1);
    estoque_possivel = Math.min(...baixas.map((b) => b.quantidade > 0 ? Math.floor(b.disponivel / b.quantidade) : 0));
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
  const rows = await env.DB.prepare(`SELECT id, unidade, custo, conteudo_quantidade, conteudo_unidade FROM produtos WHERE id IN (${ph})`)
    .bind(...ids)
    .all();
  const map = new Map(rows.results.map((r) => [r.id, r]));
  let total = 0;
  for (const ing of ingredientes) {
    const ins = map.get(num(ing.insumo_id));
    if (!ins) throw httpError(400, 'Insumo não encontrado na ficha técnica');
    const qtd = num(ing.quantidade);
    if (qtd <= 0) throw httpError(400, 'Quantidade inválida na ficha técnica');
    const conv = quantidadeEmUnidadesEstoque(qtd, ing.unidade, ins.unidade, ins.conteudo_quantidade, ins.conteudo_unidade);
    if (conv === null) throw httpError(400, `Unidade ${ing.unidade} incompatível com o insumo (${ins.unidade})`);
    total += conv * num(ins.custo);
  }
  return arredondar(total);
}

// Expande uma receita em itens físicos de estoque. Produtos compostos usados
// como ingredientes são abertos recursivamente até chegar aos insumos finais.
export async function calcularBaixasProduto(env, produtoId, quantidade = 1, caminho = []) {
  const id = num(produtoId);
  if (caminho.includes(id)) throw httpError(400, 'Ficha técnica circular: um produto não pode depender dele mesmo');
  const produto = await env.DB.prepare(
    'SELECT id, nome, tipo, unidade, estoque_atual, custo, conteudo_quantidade, conteudo_unidade FROM produtos WHERE id=?'
  ).bind(id).first();
  if (!produto) throw httpError(400, 'Produto não encontrado na ficha técnica');
  if (produto.tipo !== 'composto') {
    return [{ produto_id: id, nome: produto.nome, quantidade: num(quantidade), disponivel: num(produto.estoque_atual), custo_unitario: num(produto.custo) }];
  }
  const ficha = await env.DB.prepare(
    `SELECT f.insumo_id, f.quantidade, f.unidade, p.unidade AS insumo_unidade,
            p.conteudo_quantidade, p.conteudo_unidade
     FROM ficha_tecnica f JOIN produtos p ON p.id=f.insumo_id WHERE f.produto_id=?`
  ).bind(id).all();
  if (!ficha.results.length) throw httpError(400, `Produto composto sem ficha técnica: ${produto.nome}`);
  const acumulado = new Map();
  for (const ing of ficha.results) {
    const conv = quantidadeEmUnidadesEstoque(ing.quantidade, ing.unidade, ing.insumo_unidade, ing.conteudo_quantidade, ing.conteudo_unidade);
    if (conv === null) throw httpError(400, `Unidade incompatível na ficha de ${produto.nome}`);
    const folhas = await calcularBaixasProduto(env, ing.insumo_id, conv * num(quantidade), [...caminho, id]);
    for (const folha of folhas) {
      const atual = acumulado.get(folha.produto_id) || { ...folha, quantidade: 0 };
      atual.quantidade += folha.quantidade;
      acumulado.set(folha.produto_id, atual);
    }
  }
  return [...acumulado.values()];
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
export async function recalcularCmvDeInsumo(env, insumoId, visitados = new Set()) {
  const chave = num(insumoId);
  if (visitados.has(chave)) return;
  visitados.add(chave);
  const rows = await env.DB.prepare('SELECT DISTINCT produto_id FROM ficha_tecnica WHERE insumo_id=?')
    .bind(insumoId)
    .all();
  for (const r of rows.results) {
    const ficha = await getFichaCompleta(env, r.produto_id);
    const ing = ficha.map((x) => ({ insumo_id: x.insumo_id, quantidade: x.quantidade, unidade: x.unidade }));
    const cmv = await calcularCmvFicha(env, ing);
    await env.DB.prepare('UPDATE produtos SET custo=?, atualizado_em=? WHERE id=?').bind(cmv, now(), r.produto_id).run();
    await recalcularCmvDeInsumo(env, r.produto_id, visitados);
  }
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
