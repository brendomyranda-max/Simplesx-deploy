import {
  now,
  hoje,
  num,
  getConfig,
  setConfig,
  getProdutoFull,
  getFichaCompleta,
  buscarProdutoPorCodigo,
  registrarMovimentacao,
  registrarLancamento,
  calcularCmvFicha,
  salvarFicha,
  recalcularCmvDeInsumo,
  kvGet,
  kvPut,
  httpError,
  sha256,
  estabelecimentoId,
  cnpjValido,
  soDigitos,
} from './util.js';
import { quantidadeEmUnidadesEstoque, arredondar } from './units.js';

// ============================ AUTH ============================

export async function loginHandler(c, env) {
  const body = await c.req.json();
  const tokenValue = String(body.token || '').trim();
  if (!tokenValue) return c.json({ error: 'Token obrigatório' }, 400);

  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'local';
  const kvKey = `login:${ip}`;
  const attempts = num(await kvGet(env, kvKey));
  if (attempts >= 10) return c.json({ error: 'Muitas tentativas. Aguarde 15 minutos.' }, 429);

  const row = await env.DB.prepare(
    `SELECT t.id, t.nome, t.ativo, t.estabelecimento_id, e.nome AS estabelecimento_nome
     FROM auth_tokens t JOIN estabelecimentos e ON e.id=t.estabelecimento_id
     WHERE t.token_hash=? AND e.ativo=1`
  )
    .bind(await sha256(tokenValue))
    .first();
  if (!row) {
    await kvPut(env, kvKey, String(attempts + 1), { expirationTtl: 900 });
    return c.json({ error: 'Token inválido' }, 401);
  }
  if (!row.ativo) return c.json({ error: 'Token desativado' }, 401);
  await kvPut(env, kvKey, '0', { expirationTtl: 900 });
  return c.json({ ok: true, nome: row.estabelecimento_nome || row.nome });
}

// ============================ CONFIG ============================

export async function getConfigHandler(c, env) {
  const config = await getConfig(env);
  const configPublica = Object.fromEntries(
    Object.entries(config).filter(([chave]) => !/(token|secret|senha|password|certificado|private.?key)/i.test(chave))
  );
  return c.json({
    config: configPublica,
    modo: config.modo_operacao === 'estoque' ? 'estoque' : 'mercado',
    taxa_garcom_pct: num(config.taxa_garcom_pct),
    perda_timeout_min: num(config.perda_timeout_min),
    empresa_nome: config.empresa_nome || 'Meu Negócio',
    empresa_cnpj: config.empresa_cnpj || '',
    dias_vencimento_aviso: num(config.dias_vencimento_aviso),
  });
}

export async function putConfigHandler(c, env) {
  const body = await c.req.json();
  if (body && typeof body === 'object') {
    for (const [k, v] of Object.entries(body)) {
      if (k === 'empresa_cnpj') {
        const cnpj = soDigitos(v);
        if (!cnpjValido(cnpj)) return c.json({ error: 'CNPJ inválido' }, 400);
        await env.rawDB.prepare('UPDATE estabelecimentos SET cnpj=? WHERE id=?')
          .bind(cnpj, estabelecimentoId(env)).run();
        await setConfig(env, k, cnpj);
        continue;
      }
      if (k === 'gestor_token' && v) {
        const gestor = await env.rawDB.prepare('SELECT estabelecimento_id FROM gestores WHERE token=? AND ativo=1').bind(String(v)).first();
        if (!gestor) return c.json({ error: 'Gestor não encontrado ou inativo' }, 400);
        if (num(gestor.estabelecimento_id) && num(gestor.estabelecimento_id) !== estabelecimentoId(env)) {
          return c.json({ error: 'Este gestor já pertence a outro estabelecimento' }, 409);
        }
        await env.rawDB.prepare('UPDATE gestores SET estabelecimento_id=? WHERE token=?')
          .bind(estabelecimentoId(env), String(v)).run();
      }
      if (k === 'gestor_device_id' && v) {
        const device = await env.rawDB.prepare(
          'SELECT id FROM devices WHERE id=? AND estabelecimento_id=? AND revogado_em IS NULL'
        ).bind(String(v), estabelecimentoId(env)).first();
        if (!device) return c.json({ error: 'Gestor Android não encontrado ou revogado' }, 400);
      }
      await setConfig(env, k, v);
    }
  }
  return c.json(await getConfig(env));
}

// ============================ CATEGORIAS ============================

export async function listCategoriasHandler(c, env) {
  const rows = await env.DB.prepare(
    `SELECT c.*, pai.nome AS categoria_pai_nome,
      ia.nome AS impressora_nome,
      COALESCE(c.impressora_agente_id, pai.impressora_agente_id) AS impressora_herdada_id,
      COALESCE(ia.nome, ia_pai.nome) AS impressora_herdada_nome
     FROM categorias c
     LEFT JOIN categorias pai ON pai.id=c.categoria_pai_id
     LEFT JOIN impressora_agentes ia ON ia.id=c.impressora_agente_id
     LEFT JOIN impressora_agentes ia_pai ON ia_pai.id=pai.impressora_agente_id
     ORDER BY COALESCE(pai.nome, c.nome), c.categoria_pai_id IS NOT NULL, c.nome`
  ).all();
  return c.json(rows.results);
}

async function validarCategoriaPai(env, paiId, categoriaId = 0) {
  if (!paiId) return null;
  if (num(paiId) === num(categoriaId)) throw httpError(400, 'Uma categoria não pode ser subcategoria dela mesma');
  const pai = await env.DB.prepare('SELECT id, categoria_pai_id FROM categorias WHERE id=?').bind(paiId).first();
  if (!pai) throw httpError(400, 'Categoria principal não encontrada');
  if (pai.categoria_pai_id) throw httpError(400, 'Uma subcategoria não pode conter outras subcategorias');
  if (categoriaId) {
    const filhos = await env.DB.prepare('SELECT id FROM categorias WHERE categoria_pai_id=? LIMIT 1').bind(categoriaId).first();
    if (filhos) throw httpError(400, 'Esta categoria possui subcategorias e não pode virar subcategoria');
  }
  return num(paiId);
}

export async function createCategoriaHandler(c, env) {
  const b = await c.req.json();
  if (!b.nome) return c.json({ error: 'Nome obrigatório' }, 400);
  const paiId = await validarCategoriaPai(env, b.categoria_pai_id);
  const impressoraId = num(b.impressora_agente_id) || null;
  const r = await env.DB.prepare('INSERT INTO categorias (nome, cor, ativo, categoria_pai_id, impressora_agente_id, criado_em) VALUES (?,?,1,?,?,?)')
    .bind(String(b.nome).trim(), b.cor || '#6366f1', paiId, impressoraId, now())
    .run();
  return c.json({ id: r.meta.last_row_id, nome: b.nome, cor: b.cor || '#6366f1', ativo: 1, categoria_pai_id: paiId, impressora_agente_id: impressoraId }, 201);
}

export async function updateCategoriaHandler(c, env) {
  const b = await c.req.json();
  const atual = await env.DB.prepare('SELECT * FROM categorias WHERE id=?').bind(c.params.id).first();
  if (!atual) return c.json({ error: 'Categoria não encontrada' }, 404);
  const paiId = await validarCategoriaPai(env, b.categoria_pai_id, c.params.id);
  const impressoraId = num(b.impressora_agente_id) || null;
  await env.DB.prepare('UPDATE categorias SET nome=?, cor=?, ativo=?, categoria_pai_id=?, impressora_agente_id=? WHERE id=?')
    .bind(String(b.nome || atual.nome).trim(), b.cor || atual.cor, b.ativo === false || b.ativo === 0 ? 0 : 1, paiId, impressoraId, c.params.id)
    .run();
  return c.json({ ok: true });
}

// ============================ FORNECEDORES ============================

export async function listFornecedoresHandler(c, env) {
  const rows = await env.DB.prepare('SELECT * FROM fornecedores ORDER BY nome').all();
  return c.json(rows.results);
}

export async function createFornecedorHandler(c, env) {
  const b = await c.req.json();
  if (!b.nome) return c.json({ error: 'Nome obrigatório' }, 400);
  const r = await env.DB.prepare(
    'INSERT INTO fornecedores (nome, contato, telefone, email, ativo, criado_em) VALUES (?,?,?,?,1,?)'
  )
    .bind(b.nome, b.contato || null, b.telefone || null, b.email || null, now())
    .run();
  return c.json({ id: r.meta.last_row_id, ...b, ativo: 1 }, 201);
}

export async function updateFornecedorHandler(c, env) {
  const b = await c.req.json();
  await env.DB.prepare('UPDATE fornecedores SET nome=?, contato=?, telefone=?, email=?, ativo=? WHERE id=?')
    .bind(b.nome, b.contato || null, b.telefone || null, b.email || null, b.ativo === false ? 0 : 1, c.params.id)
    .run();
  return c.json({ ok: true });
}

// ============================ PRODUTOS ============================

export async function listProdutosHandler(c, env) {
  const busca = c.req.query('busca') || '';
  const incluirInativos = c.req.query('incluir_inativos') === '1';
  const local = c.req.query('local') || '';
  const tipo = c.req.query('tipo') || '';
  let sql =
    'SELECT p.*, f.nome AS fornecedor_nome FROM produtos p LEFT JOIN fornecedores f ON f.id=p.fornecedor_id';
  const where = [];
  const params = [];
  if (busca) {
    where.push('(p.nome LIKE ? OR p.codigo_interno LIKE ? OR EXISTS (SELECT 1 FROM produto_codigos_barras b WHERE b.produto_id=p.id AND b.codigo LIKE ?))');
    params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`);
  }
  if (!incluirInativos) where.push('p.ativo=1');
  if (local === 'restaurante') where.push('p.exibir_restaurante=1');
  if (local === 'mercado') where.push('p.exibir_mercado=1');
  if (tipo === 'insumo' || tipo === 'produto' || tipo === 'composto') {
    where.push(tipo === 'produto' ? "p.tipo='produto'" : `p.tipo='${tipo}'`);
  } else if (tipo === 'ingrediente') {
    where.push("p.tipo IN ('insumo','composto')");
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY p.nome';
  const rows = await env.DB.prepare(sql).bind(...params).all();
  const lista = rows.results;
  if (!lista.length) return c.json(lista);
  const [cats, cods, coments, fichas] = await Promise.all([
    env.DB.prepare(
      'SELECT pc.produto_id, c.id, c.nome, c.cor FROM produto_categorias pc JOIN categorias c ON c.id=pc.categoria_id'
    ).all(),
    env.DB.prepare(
      'SELECT produto_id, id, codigo, principal FROM produto_codigos_barras ORDER BY principal DESC, id'
    ).all(),
    env.DB.prepare(
      'SELECT produto_id, texto FROM produto_comentarios ORDER BY ordem, id'
    ).all(),
    env.DB.prepare(
      `SELECT f.produto_id, f.insumo_id, f.quantidade, f.unidade, p.unidade AS insumo_unidade, p.estoque_atual AS insumo_estoque,
              p.conteudo_quantidade, p.conteudo_unidade, p.tipo AS insumo_tipo, p.nome AS insumo_nome, p.custo AS insumo_custo
       FROM ficha_tecnica f JOIN produtos p ON p.id=f.insumo_id`
    ).all(),
  ]);
  const catsBy = new Map();
  for (const r of cats.results) {
    if (!catsBy.has(r.produto_id)) catsBy.set(r.produto_id, []);
    catsBy.get(r.produto_id).push({ id: r.id, nome: r.nome, cor: r.cor });
  }
  const codsBy = new Map();
  for (const r of cods.results) {
    if (!codsBy.has(r.produto_id)) codsBy.set(r.produto_id, []);
    codsBy.get(r.produto_id).push({ id: r.id, codigo: r.codigo, principal: r.principal });
  }
  const comentsBy = new Map();
  for (const r of coments.results) {
    if (!comentsBy.has(r.produto_id)) comentsBy.set(r.produto_id, []);
    comentsBy.get(r.produto_id).push(r.texto);
  }
  const fichasBy = new Map();
  for (const r of fichas.results) {
    if (!fichasBy.has(r.produto_id)) fichasBy.set(r.produto_id, []);
    fichasBy.get(r.produto_id).push(r);
  }

  // Todas as fichas já estão em memória. Expandir os compostos aqui evita uma
  // consulta D1 por ingrediente/produto e o limite de conexões simultâneas do Worker.
  const calcularEstoquePossivel = (produtoId) => {
    const ficha = fichasBy.get(produtoId) || [];
    if (!ficha.length) return 0;
    const quantidades = new Map();

    const adicionarFolhas = (id, multiplicador, trilha) => {
      const itens = fichasBy.get(id) || [];
      if (!itens.length || trilha.has(id)) return false;
      const novaTrilha = new Set(trilha);
      novaTrilha.add(id);
      for (const ing of itens) {
        const conv = quantidadeEmUnidadesEstoque(
          ing.quantidade,
          ing.unidade,
          ing.insumo_unidade,
          ing.conteudo_quantidade,
          ing.conteudo_unidade
        );
        if (conv === null || conv <= 0) return false;
        const quantidade = conv * multiplicador;
        if (ing.insumo_tipo === 'composto') {
          if (!adicionarFolhas(ing.insumo_id, quantidade, novaTrilha)) return false;
        } else {
          const atual = quantidades.get(ing.insumo_id) || { quantidade: 0, disponivel: num(ing.insumo_estoque) };
          atual.quantidade += quantidade;
          quantidades.set(ing.insumo_id, atual);
        }
      }
      return true;
    };

    if (!adicionarFolhas(produtoId, 1, new Set())) return 0;
    const possiveis = [...quantidades.values()].map((item) =>
      item.quantidade > 0 ? Math.floor(item.disponivel / item.quantidade) : 0
    );
    return possiveis.length ? Math.min(...possiveis) : 0;
  };

  const listaFinal = lista.map((p) => {
    const ficha = fichasBy.get(p.id) || [];
    let estoque_possivel = null;
    if (p.tipo === 'composto' && ficha.length) {
      estoque_possivel = calcularEstoquePossivel(p.id);
    }
    return {
      ...p,
      categorias: catsBy.get(p.id) || [],
      codigos_barras: codsBy.get(p.id) || [],
      comentarios: comentsBy.get(p.id) || [],
      ficha_count: ficha.length,
      estoque_possivel,
    };
  });
  return c.json(listaFinal);
}

export async function getProdutoHandler(c, env) {
  const p = await getProdutoFull(env, c.params.id);
  if (!p) return c.json({ error: 'Produto não encontrado' }, 404);
  return c.json(p);
}

export async function buscarProdutoHandler(c, env) {
  const body = await c.req.json();
  const codigo = String(body.codigo || '').trim();
  if (!codigo) return c.json({ error: 'Código obrigatório' }, 400);
  const p = await buscarProdutoPorCodigo(env, codigo);
  if (!p) return c.json({ error: 'Produto não encontrado', codigo }, 404);
  const local = body.local;
  if (local === 'restaurante' && !num(p.exibir_restaurante)) {
    return c.json({ error: 'Produto não cadastrado para o Restaurante', codigo }, 404);
  }
  if (local === 'mercado' && !num(p.exibir_mercado)) {
    return c.json({ error: 'Produto não cadastrado para o PDV', codigo }, 404);
  }
  return c.json(p);
}

export async function addCodigoBarrasProdutoHandler(c, env) {
  const b = await c.req.json();
  const codigo = String(b.codigo || '').trim();
  if (!codigo) return c.json({ error: 'Código de barras obrigatório' }, 400);
  if (codigo.length > 512) return c.json({ error: 'Código de barras/QR muito longo' }, 400);
  const produto = await env.DB.prepare('SELECT id, nome FROM produtos WHERE id=?').bind(c.params.id).first();
  if (!produto) return c.json({ error: 'Produto não encontrado' }, 404);
  const existente = await env.DB.prepare('SELECT produto_id FROM produto_codigos_barras WHERE codigo=?').bind(codigo).first();
  if (existente && num(existente.produto_id) !== num(produto.id)) {
    const outro = await env.DB.prepare('SELECT nome FROM produtos WHERE id=?').bind(existente.produto_id).first();
    return c.json({ error: `Este código já pertence ao produto ${outro?.nome || existente.produto_id}` }, 409);
  }
  if (!existente) {
    const primeiro = await env.DB.prepare('SELECT id FROM produto_codigos_barras WHERE produto_id=? LIMIT 1').bind(produto.id).first();
    await env.DB.prepare('INSERT INTO produto_codigos_barras (produto_id, codigo, principal, criado_em) VALUES (?,?,?,?)')
      .bind(produto.id, codigo, primeiro ? 0 : 1, now()).run();
  }
  return c.json(await getProdutoFull(env, produto.id), existente ? 200 : 201);
}

export function normalizeCodigos(codigos) {
  const seen = new Set();
  const out = [];
  if (Array.isArray(codigos)) {
    for (const c of codigos) {
      const cod = String(c.codigo || c).trim();
      if (!cod || seen.has(cod)) continue;
      seen.add(cod);
      out.push({ codigo: cod, principal: c.principal ? 1 : 0 });
    }
  }
  if (out.length && !out.some((o) => o.principal)) out[0].principal = 1;
  return out;
}

export function normalizeComentarios(comentarios) {
  const seen = new Set();
  const out = [];
  if (Array.isArray(comentarios)) {
    for (const c of comentarios) {
      const texto = String(c.texto || c || '').trim();
      if (!texto || seen.has(texto)) continue;
      seen.add(texto);
      out.push(texto);
    }
  }
  return out;
}

function validaPreco(config, preco, tipo) {
  if (tipo === 'insumo') return;
  if (config.modo_operacao !== 'estoque' && (preco === null || preco <= 0)) {
    throw httpError(400, 'No modo mercado o preço de venda é obrigatório');
  }
}

function normalizarTipo(b, ingredientes) {
  if (b.tipo === 'insumo') return 'insumo';
  if (b.tipo === 'composto' || (Array.isArray(ingredientes) && ingredientes.length)) return 'composto';
  return 'produto';
}

async function validarFichaSemCiclo(env, produtoId, ingredientes) {
  async function dependeDe(origemId, alvoId, visitados = new Set()) {
    if (num(origemId) === num(alvoId)) return true;
    if (visitados.has(num(origemId))) return false;
    visitados.add(num(origemId));
    const filhos = await env.DB.prepare('SELECT insumo_id FROM ficha_tecnica WHERE produto_id=?').bind(origemId).all();
    for (const filho of filhos.results) {
      if (await dependeDe(filho.insumo_id, alvoId, visitados)) return true;
    }
    return false;
  }
  for (const ing of ingredientes || []) {
    if (await dependeDe(ing.insumo_id, produtoId)) {
      throw httpError(400, 'Ficha técnica circular: um produto não pode depender dele mesmo');
    }
  }
}

export async function createProdutoHandler(c, env) {
  const b = await c.req.json();
  if (!b.nome) return c.json({ error: 'Nome obrigatório' }, 400);
  const config = await getConfig(env);
  const codigos = normalizeCodigos(b.codigos_barras || []);
  const principal = codigos.find((x) => x.principal) || codigos[0] || null;
  const codigoInterno =
    String(b.codigo_interno || '').trim() || (principal ? principal.codigo : String(Date.now()).slice(-8));
  const preco = b.preco === null || b.preco === undefined || b.preco === '' ? null : num(b.preco);
  const ingredientes = Array.isArray(b.ingredientes) ? b.ingredientes : Array.isArray(b.ficha) ? b.ficha : [];
  const tipo = normalizarTipo(b, ingredientes);
  validaPreco(config, preco, tipo);
  if (tipo !== 'composto' && (!b.data_fabricacao || !b.data_vencimento)) return c.json({ error: 'Informe as datas de fabricação e vencimento' }, 400);
  if (tipo === 'insumo' && num(b.validade_aberto_dias) <= 0) {
    return c.json({ error: 'Informe a validade após abertura do insumo' }, 400);
  }
  if (tipo !== 'composto' && b.data_fabricacao && b.data_vencimento && b.data_vencimento < b.data_fabricacao) {
    return c.json({ error: 'A data de vencimento não pode ser anterior à fabricação' }, 400);
  }

  let custo = num(b.custo);
  if (tipo === 'composto') {
    custo = await calcularCmvFicha(env, ingredientes);
  }

  const r = await env.DB.prepare(
    `INSERT INTO produtos (nome, codigo_interno, unidade, estoque_atual, estoque_minimo, custo, preco, fornecedor_id,
     marca, validade_fabricacao_dias, validade_aberto_dias, data_fabricacao, data_vencimento, temperatura, ativo, observacoes,
     exibir_restaurante, exibir_mercado, tipo, conteudo_quantidade, conteudo_unidade, criado_em)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?)`
  )
    .bind(
      b.nome,
      codigoInterno,
      b.unidade || 'UN',
      num(b.estoque_atual),
      num(b.estoque_minimo),
      custo,
      preco,
      b.fornecedor_id || null,
      b.marca || null,
      b.validade_fabricacao_dias || null,
      b.validade_aberto_dias || null,
      b.data_fabricacao || null,
      b.data_vencimento || null,
      b.temperatura || null,
      b.observacoes || null,
      b.exibir_restaurante === true ? 1 : 0,
      b.exibir_mercado === true ? 1 : 0,
      tipo,
      tipo === 'insumo' && num(b.conteudo_quantidade) > 0 ? num(b.conteudo_quantidade) : null,
      tipo === 'insumo' && b.conteudo_unidade ? b.conteudo_unidade : null,
      now()
    )
    .run();
  const id = r.meta.last_row_id;
  const stmts = codigos.map((co) =>
    env.DB.prepare('INSERT INTO produto_codigos_barras (produto_id, codigo, principal, criado_em) VALUES (?,?,?,?)').bind(
      id,
      co.codigo,
      co.principal,
      now()
    )
  );
  if (Array.isArray(b.categoria_ids)) {
    for (const cat of b.categoria_ids) {
      stmts.push(
        env.DB.prepare('INSERT OR IGNORE INTO produto_categorias (produto_id, categoria_id) VALUES (?,?)').bind(id, cat)
      );
    }
  }
  const comentarios = normalizeComentarios(b.comentarios);
  for (let i = 0; i < comentarios.length; i++) {
    stmts.push(
      env.DB.prepare('INSERT INTO produto_comentarios (produto_id, texto, ordem, criado_em) VALUES (?,?,?,?)').bind(
        id,
        comentarios[i],
        i,
        now()
      )
    );
  }
  if (tipo === 'composto' && ingredientes.length) {
    for (const ing of ingredientes) {
      stmts.push(
        env.DB.prepare('INSERT INTO ficha_tecnica (produto_id, insumo_id, quantidade, unidade, criado_em) VALUES (?,?,?,?,?)').bind(
          id,
          num(ing.insumo_id),
          num(ing.quantidade),
          ing.unidade || 'UN',
          now()
        )
      );
    }
  }
  if (num(b.estoque_atual) > 0 && tipo !== 'composto' && b.data_vencimento) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO lotes (produto_id, quantidade, custo_unitario, data_fabricacao, data_validade, temperatura,
         fornecedor_id, nota_fiscal, responsavel, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).bind(id, num(b.estoque_atual), custo, b.data_fabricacao, b.data_vencimento, b.temperatura || null, b.fornecedor_id || null, null, 'admin', now()),
      env.DB.prepare(
        `INSERT INTO validade_controles (produto_id, tipo, quantidade, data_fabricacao, data_abertura, data_vencimento,
         temperatura, responsavel, observacoes, status, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(id, 'fabricacao', num(b.estoque_atual), b.data_fabricacao, null, b.data_vencimento, b.temperatura || null, 'admin', 'Estoque inicial do cadastro', 'ativo', now())
    );
  }
  if (stmts.length) await env.DB.batch(stmts);
  if (num(b.estoque_atual) > 0 && tipo !== 'composto') {
    await registrarMovimentacao(env, {
      produto_id: id,
      tipo: 'entrada',
      quantidade: num(b.estoque_atual),
      saldo_apos: num(b.estoque_atual),
      custo_unitario: custo,
      origem: 'criacao',
      responsavel: 'admin',
      observacoes: 'Estoque inicial',
    });
  }
  return c.json(await getProdutoFull(env, id), 201);
}

export async function updateProdutoHandler(c, env) {
  const b = await c.req.json();
  const atual = await env.DB.prepare('SELECT * FROM produtos WHERE id=?').bind(c.params.id).first();
  if (!atual) return c.json({ error: 'Produto não encontrado' }, 404);
  const config = await getConfig(env);
  const preco = b.preco === null || b.preco === undefined || b.preco === '' ? null : num(b.preco);
  const ingredientes = Array.isArray(b.ingredientes) ? b.ingredientes : Array.isArray(b.ficha) ? b.ficha : null;

  let tipo = atual.tipo || 'produto';
  if (b.tipo === 'insumo' || b.tipo === 'produto' || b.tipo === 'composto') tipo = b.tipo;
  else if (ingredientes) tipo = ingredientes.length ? 'composto' : 'produto';
  validaPreco(config, preco, tipo);
  const dataFabricacao = b.data_fabricacao || atual.data_fabricacao;
  const dataVencimento = b.data_vencimento || atual.data_vencimento;
  if (tipo !== 'composto' && (!dataFabricacao || !dataVencimento)) return c.json({ error: 'Informe as datas de fabricação e vencimento' }, 400);
  if (tipo !== 'composto' && dataVencimento < dataFabricacao) return c.json({ error: 'A data de vencimento não pode ser anterior à fabricação' }, 400);
  if (tipo === 'insumo' && num(b.validade_aberto_dias ?? atual.validade_aberto_dias) <= 0) {
    return c.json({ error: 'Informe o vencimento pós-abertura do insumo' }, 400);
  }

  let custo = b.custo === undefined || b.custo === null || b.custo === '' ? num(atual.custo) : num(b.custo);
  let fichaFonte = null;
  if (tipo === 'composto') {
    if (ingredientes) {
      if (!ingredientes.length) return c.json({ error: 'Produto composto precisa de pelo menos um insumo na ficha técnica' }, 400);
      fichaFonte = ingredientes;
    } else {
      fichaFonte = await getFichaCompleta(env, c.params.id);
    }
    if (!fichaFonte.length) return c.json({ error: 'Produto composto precisa de pelo menos um insumo na ficha técnica' }, 400);
    custo = await calcularCmvFicha(env, fichaFonte);
    await validarFichaSemCiclo(env, c.params.id, fichaFonte);
  }

  await env.DB.prepare(
    `UPDATE produtos SET nome=?, codigo_interno=?, unidade=?, estoque_minimo=?, custo=?, preco=?, fornecedor_id=?, marca=?,
     validade_fabricacao_dias=?, validade_aberto_dias=?, data_fabricacao=?, data_vencimento=?, temperatura=?, ativo=?, observacoes=?,
     exibir_restaurante=?, exibir_mercado=?, tipo=?, conteudo_quantidade=?, conteudo_unidade=?, atualizado_em=?
     WHERE id=?`
  )
    .bind(
      b.nome,
      b.codigo_interno || atual.codigo_interno,
      b.unidade || 'UN',
      num(b.estoque_minimo),
      custo,
      preco,
      b.fornecedor_id || null,
      b.marca || null,
      b.validade_fabricacao_dias || null,
      b.validade_aberto_dias || null,
      dataFabricacao,
      dataVencimento,
      b.temperatura || null,
      b.ativo === false ? 0 : 1,
      b.observacoes || null,
      b.exibir_restaurante === true ? 1 : b.exibir_restaurante === false ? 0 : num(atual.exibir_restaurante),
      b.exibir_mercado === true ? 1 : b.exibir_mercado === false ? 0 : num(atual.exibir_mercado),
      tipo,
      tipo === 'insumo' && num(b.conteudo_quantidade ?? atual.conteudo_quantidade) > 0 ? num(b.conteudo_quantidade ?? atual.conteudo_quantidade) : null,
      tipo === 'insumo' ? (b.conteudo_unidade || atual.conteudo_unidade || null) : null,
      now(),
      c.params.id
    )
    .run();

  const stmts = [];
  if (Array.isArray(b.codigos_barras)) {
    stmts.push(env.DB.prepare('DELETE FROM produto_codigos_barras WHERE produto_id=?').bind(c.params.id));
    for (const co of normalizeCodigos(b.codigos_barras)) {
      stmts.push(
        env.DB.prepare('INSERT INTO produto_codigos_barras (produto_id, codigo, principal, criado_em) VALUES (?,?,?,?)').bind(
          c.params.id,
          co.codigo,
          co.principal,
          now()
        )
      );
    }
  }
  if (Array.isArray(b.categoria_ids)) {
    stmts.push(env.DB.prepare('DELETE FROM produto_categorias WHERE produto_id=?').bind(c.params.id));
    for (const cat of b.categoria_ids) {
      stmts.push(
        env.DB.prepare('INSERT OR IGNORE INTO produto_categorias (produto_id, categoria_id) VALUES (?,?)').bind(c.params.id, cat)
      );
    }
  }
  if (Object.prototype.hasOwnProperty.call(b, 'comentarios')) {
    stmts.push(env.DB.prepare('DELETE FROM produto_comentarios WHERE produto_id=?').bind(c.params.id));
    const comentarios = normalizeComentarios(b.comentarios);
    for (let i = 0; i < comentarios.length; i++) {
      stmts.push(
        env.DB.prepare('INSERT INTO produto_comentarios (produto_id, texto, ordem, criado_em) VALUES (?,?,?,?)').bind(
          c.params.id,
          comentarios[i],
          i,
          now()
        )
      );
    }
  }
  if (ingredientes) {
    stmts.push(env.DB.prepare('DELETE FROM ficha_tecnica WHERE produto_id=?').bind(c.params.id));
    if (tipo === 'composto') {
      for (const ing of ingredientes) {
        stmts.push(
          env.DB.prepare('INSERT INTO ficha_tecnica (produto_id, insumo_id, quantidade, unidade, criado_em) VALUES (?,?,?,?,?)').bind(
            c.params.id,
            num(ing.insumo_id),
            num(ing.quantidade),
            ing.unidade || 'UN',
            now()
          )
        );
      }
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  await recalcularCmvDeInsumo(env, c.params.id);
  return c.json(await getProdutoFull(env, c.params.id));
}

export async function deleteProdutoHandler(c, env) {
  const id = c.params.id;
  const p = await env.DB.prepare('SELECT * FROM produtos WHERE id=?').bind(id).first();
  if (!p) return c.json({ error: 'Produto não encontrado' }, 404);

  // Uma venda é um documento financeiro único. Se ela contém o produto,
  // removemos a venda inteira (e seus efeitos) para não deixar totais,
  // pagamentos ou lançamentos sem correspondência com os itens.
  const [vendas, itensComanda, perdasDiretas] = await Promise.all([
    env.DB.prepare(
      'SELECT DISTINCT v.id, v.numero FROM vendas v JOIN venda_itens vi ON vi.venda_id=v.id WHERE vi.produto_id=?'
    ).bind(id).all(),
    env.DB.prepare('SELECT id FROM comanda_itens WHERE produto_id=?').bind(id).all(),
    env.DB.prepare('SELECT id FROM perdas WHERE produto_id=?').bind(id).all(),
  ]);
  const vendaIds = vendas.results.map((v) => v.id);
  const itemComandaIds = itensComanda.results.map((i) => i.id);

  let perdasLigadas = perdasDiretas.results.map((pe) => pe.id);
  if (itemComandaIds.length) {
    const ph = itemComandaIds.map(() => '?').join(',');
    const rows = await env.DB.prepare(`SELECT id FROM perdas WHERE item_id IN (${ph})`).bind(...itemComandaIds).all();
    perdasLigadas = [...new Set([...perdasLigadas, ...rows.results.map((pe) => pe.id)])];
  }

  const stmts = [
    // Registros derivados do produto
    env.DB.prepare('DELETE FROM produto_codigos_barras WHERE produto_id=?').bind(id),
    env.DB.prepare('DELETE FROM produto_categorias WHERE produto_id=?').bind(id),
    env.DB.prepare('DELETE FROM produto_comentarios WHERE produto_id=?').bind(id),
    // Própria ficha técnica (receita) do produto
    env.DB.prepare('DELETE FROM ficha_tecnica WHERE produto_id=?').bind(id),
    // Entradas de mercadorias (lotes) e movimentações de estoque
    env.DB.prepare('DELETE FROM lotes WHERE produto_id=?').bind(id),
    env.DB.prepare('DELETE FROM estoque_movimentacoes WHERE produto_id=?').bind(id),
    // Controles de validade
    env.DB.prepare('DELETE FROM validade_controles WHERE produto_id=?').bind(id),
    // Perdas e itens ainda presentes em comandas abertas/fechadas
    env.DB.prepare('DELETE FROM perdas WHERE produto_id=?').bind(id),
    env.DB.prepare('DELETE FROM comanda_itens WHERE produto_id=?').bind(id),
  ];

  if (perdasLigadas.length) {
    const ph = perdasLigadas.map(() => '?').join(',');
    stmts.push(
      env.DB.prepare(`DELETE FROM lancamentos WHERE ref_tipo='perda' AND ref_id IN (${ph})`).bind(...perdasLigadas),
      env.DB.prepare(`DELETE FROM estoque_movimentacoes WHERE origem='perda' AND ref_id IN (${ph})`).bind(...perdasLigadas),
      env.DB.prepare(`DELETE FROM perdas WHERE id IN (${ph})`).bind(...perdasLigadas)
    );
  }

  if (vendaIds.length) {
    const ph = vendaIds.map(() => '?').join(',');
    stmts.push(
      env.DB.prepare(`DELETE FROM lancamentos WHERE ref_tipo='venda' AND ref_id IN (${ph})`).bind(...vendaIds),
      env.DB.prepare(`DELETE FROM estoque_movimentacoes WHERE origem IN ('venda','estorno') AND ref_id IN (${ph})`).bind(...vendaIds),
      env.DB.prepare(`DELETE FROM pagamentos WHERE venda_id IN (${ph})`).bind(...vendaIds),
      env.DB.prepare(`DELETE FROM venda_itens WHERE venda_id IN (${ph})`).bind(...vendaIds),
      env.DB.prepare(`DELETE FROM vendas WHERE id IN (${ph})`).bind(...vendaIds)
    );
    for (const venda of vendas.results) {
      stmts.push(
        env.DB.prepare("DELETE FROM caixa WHERE observacao IN (?,?,?)").bind(
          `Venda ${venda.numero}`,
          `Cancelamento Venda ${venda.numero}`,
          `Estorno da venda ${venda.numero}`
        )
      );
    }
  }

  // Se este produto é insumo de fichas técnicas, remove das receitas
  // e recalcula o CMV dos produtos compostos afetados.
  const usos = await env.DB.prepare('SELECT DISTINCT produto_id FROM ficha_tecnica WHERE insumo_id=?')
    .bind(id)
    .all();
  const compostosAfetados = usos.results.map((r) => r.produto_id);
  if (compostosAfetados.length) {
    stmts.push(env.DB.prepare('DELETE FROM ficha_tecnica WHERE insumo_id=?').bind(id));
  }

  stmts.push(env.DB.prepare('DELETE FROM produtos WHERE id=?').bind(id));
  await env.DB.batch(stmts);

  for (const pid of compostosAfetados) {
    const ficha = await getFichaCompleta(env, pid);
    if (ficha.length) {
      const ing = ficha.map((x) => ({ insumo_id: x.insumo_id, quantidade: x.quantidade, unidade: x.unidade }));
      const cmv = await calcularCmvFicha(env, ing);
      await env.DB.prepare('UPDATE produtos SET custo=?, atualizado_em=? WHERE id=?').bind(cmv, now(), pid).run();
    } else {
      await env.DB.prepare('UPDATE produtos SET custo=0, atualizado_em=? WHERE id=?').bind(now(), pid).run();
    }
  }

  return c.json({
    ok: true,
    vendas_excluidas: vendaIds.length,
    perdas_excluidas: perdasLigadas.length,
    itens_comanda_excluidos: itemComandaIds.length,
    compostos_afetados: compostosAfetados.length,
  });
}

// ============================ ESTOQUE ============================

export async function listMovimentacoesHandler(c, env) {
  const produto_id = c.req.query('produto_id') || '';
  const tipo = c.req.query('tipo') || '';
  const de = c.req.query('de') || '';
  const ate = c.req.query('ate') || '';
  let sql =
    'SELECT m.*, p.nome AS produto_nome FROM estoque_movimentacoes m LEFT JOIN produtos p ON p.id=m.produto_id';
  const where = [];
  const params = [];
  if (produto_id) {
    where.push('m.produto_id=?');
    params.push(produto_id);
  }
  if (tipo) {
    where.push('m.tipo=?');
    params.push(tipo);
  }
  if (de) {
    where.push('m.criado_em >= ?');
    params.push(`${de}T00:00:00`);
  }
  if (ate) {
    where.push('m.criado_em <= ?');
    params.push(`${ate}T23:59:59`);
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY m.id DESC LIMIT 300';
  const rows = await env.DB.prepare(sql).bind(...params).all();
  return c.json(rows.results);
}

export async function entradaMercadoriaHandler(c, env) {
  const b = await c.req.json();
  const p = await env.DB.prepare('SELECT * FROM produtos WHERE id=?').bind(b.produto_id).first();
  if (!p) return c.json({ error: 'Produto não encontrado' }, 404);
  const qtd = num(b.quantidade);
  if (qtd <= 0) return c.json({ error: 'Quantidade inválida' }, 400);
  if (!b.data_fabricacao || !b.data_validade) {
    return c.json({ error: 'Informe as datas de fabricação e vencimento da mercadoria' }, 400);
  }
  if (b.data_validade < b.data_fabricacao) {
    return c.json({ error: 'A data de vencimento não pode ser anterior à fabricação' }, 400);
  }
  const custo =
    b.custo_unitario !== undefined && b.custo_unitario !== null && b.custo_unitario !== ''
      ? num(b.custo_unitario)
      : num(p.custo);

  const codigoRecebido = String(b.codigo_barras || '').trim();
  if (codigoRecebido) {
    if (codigoRecebido.length > 512) return c.json({ error: 'Código de barras/QR muito longo' }, 400);
    const codigoAtual = await env.DB.prepare('SELECT produto_id FROM produto_codigos_barras WHERE codigo=?')
      .bind(codigoRecebido).first();
    if (codigoAtual && num(codigoAtual.produto_id) !== num(p.id)) {
      const outro = await env.DB.prepare('SELECT nome FROM produtos WHERE id=?').bind(codigoAtual.produto_id).first();
      return c.json({ error: `Este código já pertence ao produto ${outro?.nome || codigoAtual.produto_id}` }, 409);
    }
    if (!codigoAtual) {
      const primeiro = await env.DB.prepare('SELECT id FROM produto_codigos_barras WHERE produto_id=? LIMIT 1').bind(p.id).first();
      await env.DB.prepare('INSERT INTO produto_codigos_barras (produto_id,codigo,principal,criado_em) VALUES (?,?,?,?)')
        .bind(p.id, codigoRecebido, primeiro ? 0 : 1, now()).run();
    }
  }

  const r = await env.DB.prepare(
    `INSERT INTO lotes (produto_id, quantidade, custo_unitario, data_fabricacao, data_validade, temperatura,
     fornecedor_id, nota_fiscal, responsavel, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      b.produto_id,
      qtd,
      custo,
      b.data_fabricacao || null,
      b.data_validade || null,
      b.temperatura || p.temperatura || null,
      b.fornecedor_id || p.fornecedor_id || null,
      b.nota_fiscal || null,
      b.responsavel || null,
      now()
    )
    .run();
  const loteId = r.meta.last_row_id;
  const novoSaldo = num(p.estoque_atual) + qtd;
  // Custo médio ponderado
  const estoqueAnterior = num(p.estoque_atual);
  const custoAnterior = num(p.custo);
  const custoMedio =
    estoqueAnterior + qtd > 0 ? (custoAnterior * estoqueAnterior + custo * qtd) / (estoqueAnterior + qtd) : custo;
  const custoFinal = arredondar(custoMedio, 6);
  await env.DB.prepare('UPDATE produtos SET estoque_atual=?, custo=?, atualizado_em=? WHERE id=?')
    .bind(novoSaldo, custoFinal, now(), b.produto_id)
    .run();
  // Se o produto é insumo de alguma ficha técnica, recalcula o CMV dos produtos compostos
  await recalcularCmvDeInsumo(env, b.produto_id);
  await registrarMovimentacao(env, {
    produto_id: b.produto_id,
    tipo: 'entrada',
    quantidade: qtd,
    saldo_apos: novoSaldo,
    custo_unitario: custoFinal,
    origem: 'entrada',
    ref_id: loteId,
    responsavel: b.responsavel || null,
    observacoes: `Entrada de mercadoria${b.nota_fiscal ? ' NF ' + b.nota_fiscal : ''}`,
  });
  if (b.data_validade) {
    await env.DB.prepare(
      `INSERT INTO validade_controles (produto_id, tipo, quantidade, data_fabricacao, data_abertura, data_vencimento,
       temperatura, responsavel, observacoes, status, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      b.produto_id, 'fabricacao', qtd, b.data_fabricacao || null, null, b.data_validade,
      b.temperatura || p.temperatura || null, b.responsavel || null,
      `Entrada de mercadoria${b.nota_fiscal ? ' · NF ' + b.nota_fiscal : ''}`, 'ativo', now()
    ).run();
  }
  return c.json({ lote_id: loteId, novo_saldo: novoSaldo, custo_medio: custoFinal, codigo_barras: codigoRecebido || null });
}

export async function ajustarEstoqueHandler(c, env) {
  const b = await c.req.json();
  const p = await env.DB.prepare('SELECT * FROM produtos WHERE id=?').bind(b.produto_id).first();
  if (!p) return c.json({ error: 'Produto não encontrado' }, 404);
  const novaQtd = num(b.quantidade_nova);
  if (novaQtd < 0) return c.json({ error: 'Quantidade inválida' }, 400);
  const atual = num(p.estoque_atual);
  const diff = novaQtd - atual;
  await env.DB.prepare('UPDATE produtos SET estoque_atual=?, atualizado_em=? WHERE id=?')
    .bind(novaQtd, now(), b.produto_id)
    .run();
  await registrarMovimentacao(env, {
    produto_id: b.produto_id,
    tipo: diff >= 0 ? 'entrada' : 'saida',
    quantidade: Math.abs(diff),
    saldo_apos: novaQtd,
    custo_unitario: num(p.custo),
    origem: 'ajuste',
    responsavel: b.responsavel || null,
    observacoes: b.motivo || 'Ajuste manual de estoque',
  });
  return c.json({ ok: true, novo_saldo: novaQtd });
}

export async function estadoHandler(c, env) {
  const dataHoje = hoje();
  const prod = await env.DB.prepare("SELECT COUNT(*) c FROM produtos WHERE ativo=1").first();
  const baixo = await env.DB.prepare('SELECT COUNT(*) c FROM produtos WHERE ativo=1 AND estoque_atual <= estoque_minimo').first();
  const vendasHoje = await env.DB.prepare(
    "SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM vendas WHERE status='concluida' AND date(datetime(criado_em, '-3 hours'))=?"
  )
    .bind(dataHoje)
    .first();
  const mesas = await env.DB.prepare("SELECT COUNT(*) c FROM mesas WHERE status='ocupada'").first();
  const comandas = await env.DB.prepare("SELECT COUNT(*) c FROM comandas WHERE status='aberta'").first();
  const cfg = await getConfig(env);
  const diasAviso = num(cfg.dias_vencimento_aviso) || 7;
  const vencendo = await env.DB.prepare(
    "SELECT COUNT(*) c FROM validade_controles WHERE status='ativo' AND data_vencimento <= date('now', '+' || ? || ' days')"
  )
    .bind(diasAviso)
    .first();
  const perdas = await env.DB.prepare("SELECT COUNT(*) c FROM perdas WHERE date(datetime(criado_em, '-3 hours'))=?").bind(dataHoje).first();
  return c.json({
    produtos: num(prod.c),
    estoque_baixo: num(baixo.c),
    vendas_hoje: num(vendasHoje.c),
    faturamento_hoje: num(vendasHoje.s),
    mesas_ocupadas: num(mesas.c),
    comandas_abertas: num(comandas.c),
    validade_vencendo: num(vencendo.c),
    perdas_hoje: num(perdas.c),
  });
}
