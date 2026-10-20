/**
 * Cardápio público e pedidos online.
 *
 * A parte administrativa usa o TenantDb. As rotas públicas consultam a loja
 * por slug no D1 bruto e nunca recebem uma sessão do Gestor. O acompanhamento
 * de um pedido só abre com a chave daquele pedido, na loja daquele estabelecimento.
 */

import { estabelecimentoId, getConfigValue, getFichaCompleta, httpError, kvGet, kvPut, now, num, setConfig } from './util.js';
import { confirmarCobrancaEfi, consultarNotificacaoEfi } from './efipay.js';
import { areaDaLoja, cobrancaEntrega, coordenadaValida, distanciaKm, dentroDoRaio, kmExibido, localizar } from './localizacao.js';
import { vincularInsumosOpcoes } from './acrescimos.js';
import { copiaColaPix, normalizarChavePix, textoPix } from './pix.js';
import { categoriaPrincipalDelivery } from './categorias-delivery.js';
import { escolherSlugLoja, reservarLinkLoja } from './loja-slug.js';
import { gruposDoCombo, montarCombo } from './combo.js';
import { chamarEntregas } from './entregas-bridge.js';
import { cifrarCodigoEntrega, decifrarCodigoEntrega } from './entregas-code.js';
import { configurarHorario, diasDaLoja, funcionamentoLoja } from './online-hours.js';
import { TenantDb } from './tenant-db.js';
import { dispatchOrders } from './order-printing.js';

const MAX_ITEMS = 30;
const MAX_CATEGORIAS_LOJA = 6;
const SITE_SLUG = /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])?$/;
const ORDER_KEY = /^[a-zA-Z0-9_-]{16,100}$/;
async function confirmarCobrancaCheckoutEfi(env, row) {
  if (row.forma_pagamento !== 'efi_checkout' || !row.checkout_charge_id) throw httpError(400, 'Este pedido não tem uma cobrança Efí vinculada.');
  const charge = await confirmarCobrancaEfi(env, row.checkout_charge_id);
  if (String(charge.custom_id || '') !== row.chave || Number(charge.total) !== Math.round(num(row.total) * 100)) {
    throw httpError(402, 'Os dados da cobrança Efí não correspondem a este pedido.');
  }
  if (charge.status !== 'paid') throw httpError(402, 'A Efí ainda não confirmou o pagamento deste pedido.');
  await env.DB.prepare(`UPDATE pedidos_online SET checkout_capture_method='credit_card',checkout_pago_em=?,atualizado_em=?
    WHERE id=? AND forma_pagamento='efi_checkout' AND checkout_pago_em IS NULL`)
    .bind(now(), now(), row.id).run();
  const fresh = await env.DB.prepare('SELECT * FROM pedidos_online WHERE id=?').bind(row.id).first();
  if (fresh?.etapa === 'aguardando_pagamento') await liberarPedidoPagamento(env, fresh);
  if (fresh && num(fresh.entrega_plataforma) === 1 && fresh.etapa === 'recebido') {
    try { await despacharEntregaPix(env, fresh.id); }
    catch (error) {
      await env.DB.prepare("UPDATE pedidos_online SET entrega_despacho_status='erro' WHERE id=?").bind(fresh.id).run();
      console.error('[efipay-checkout] delivery_dispatch_failed', { order_id: num(fresh.id), message: String(error?.message || error).slice(0, 200) });
    }
  }
  if (fresh) await aceitarPedido(env, fresh);
  return true;
}

function integracaoEntregasConfigurada(store, env) {
  return env.ENTREGAS_PIX_DESTINO === 'loja'
    && typeof env.ENTREGAS_API_URL === 'string' && typeof env.ENTREGAS_INTEGRATION_SECRET === 'string'
    && env.ENTREGAS_INTEGRATION_SECRET.length >= 32 && Boolean(store.pix_chave)
    && store.latitude != null && store.longitude != null;
}

function plataformaDisponivel(store, env) {
  return Number(store.entrega_plataforma_ativo) === 1 && integracaoEntregasConfigurada(store, env);
}

function nomeLojaChave(nome) {
  return String(nome || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
}

function textoIngredientes(nomes) {
  if (nomes.length <= 1) return nomes[0] || '';
  if (nomes.length === 2) return `${nomes[0]} e ${nomes[1]}`;
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}

function textoJaTemIngredientes(texto, nomes) {
  const base = texto.toLocaleLowerCase('pt-BR');
  return nomes.every((nome) => base.includes(nome.toLocaleLowerCase('pt-BR')));
}

async function descricaoComIngredientes(env, produtoId, descricao) {
  const ficha = await getFichaCompleta(env, produtoId);
  const nomes = [];
  const vistos = new Set();
  for (const item of ficha) {
    const nome = String(item.insumo_nome || '').trim().replace(/\s+/g, ' ');
    if (!nome) continue;
    const chave = nome.toLocaleLowerCase('pt-BR');
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    nomes.push(nome);
  }
  if (!nomes.length) return descricao;
  const lista = textoIngredientes(nomes);
  const extra = String(descricao || '').trim();
  const escolhido = !extra || textoJaTemIngredientes(extra, nomes) ? (extra || lista) : `${lista}. ${extra}`;
  return escolhido.length > 700 ? escolhido.slice(0, 700) : escolhido;
}

function buscaCategoria(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function cleanText(value, max, label, required = false) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (required && !text) throw httpError(400, `${label} obrigatório`);
  if (text.length > max) throw httpError(400, `${label} muito longo`);
  return text;
}

function optionalNumber(value, label, { min = 0, max = 999999 } = {}) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw httpError(400, `${label} inválido`);
  return Math.round(parsed * 100) / 100;
}

function flag(value, current = 0) {
  return value === undefined ? current : (value === true || value === 1 || value === '1' ? 1 : 0);
}

function corDaCapa(value) {
  if (value === null || value === undefined || value === '') return null;
  const texto = String(value).trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(texto)) throw httpError(400, 'Escolha uma cor no formato #RRGGBB');
  return texto.toLowerCase();
}

function corPublica(value) {
  const texto = String(value || '').trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(texto) ? texto : null;
}

function whatsappDaLoja(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const digits = String(value).replace(/\D/g, '');
  const nacional = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  if (!/^[1-9]\d{9,10}$/.test(nacional)) throw httpError(400, 'Informe um WhatsApp com DDD e 10 ou 11 dígitos');
  return nacional;
}

function safeImageUrl(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw httpError(400, 'Foto inválida');
  const raw = value.trim();
  if (!raw) return null;
  const data = raw.match(/^data:image\/(jpeg|jpg|png|webp);base64,([a-z0-9+/=\s]+)$/i);
  if (data) {
    const tipo = data[1].toLowerCase() === 'jpg' ? 'jpeg' : data[1].toLowerCase();
    const foto = `data:image/${tipo};base64,${data[2].replace(/\s/g, '')}`;
    if (foto.length < 32 || foto.length > 280000) throw httpError(400, 'A foto é grande demais. Escolha outra da galeria.');
    return foto;
  }
  const url = cleanText(raw, 1000, 'URL da foto');
  if (!url) return null;
  if (!url.startsWith('/') && !/^https:\/\//i.test(url)) throw httpError(400, 'Use uma URL segura para a foto');
  return url;
}

function productView(row, options = []) {
  const preco = row.preco == null ? (row.produto_preco == null ? null : num(row.produto_preco)) : num(row.preco);
  const precoPromocional = row.preco_promocional == null ? null : num(row.preco_promocional);
  return {
    id: num(row.id),
    produto_id: num(row.produto_id),
    categoria_id: row.categoria_id == null ? null : num(row.categoria_id),
    cardapio_categoria_id: row.cardapio_categoria_ok == null ? null : num(row.cardapio_categoria_id),
    nome: row.nome_exibicao || row.produto_nome,
    descricao: row.descricao || row.produto_observacoes || '',
    foto_url: row.foto_url || null,
    preco,
    preco_promocional: preco != null && precoPromocional != null && precoPromocional < preco ? precoPromocional : null,
    ordem: num(row.ordem),
    disponivel: num(row.disponivel),
    ativo: num(row.ativo),
    categoria_nome: row.cardapio_categoria_nome || row.categoria_estoque_nome || row.categoria_nome || null,
    opcoes: options,
    combo_grupos: gruposDoCombo({ tipo: row.produto_tipo, combo_grupos_json: row.combo_grupos_json }),
  };
}

async function ensureStore(env) {
  const tenant = estabelecimentoId(env);
  let store = await env.DB.prepare('SELECT * FROM lojas_online WHERE estabelecimento_id=?').bind(tenant).first();
  if (store) {
    if (!store.pix_chave) {
      const pixKey = await getConfigValue(env, 'pix_chave', '');
      const pixCity = await getConfigValue(env, 'pix_cidade', '');
      if (pixKey) {
        await env.DB.prepare('UPDATE lojas_online SET pix_chave=?,pix_cidade=? WHERE estabelecimento_id=?')
          .bind(pixKey, pixCity || null, tenant).run();
        store = await env.DB.prepare('SELECT * FROM lojas_online WHERE estabelecimento_id=?').bind(tenant).first();
      }
    }
    return store;
  }
  const business = await env.rawDB.prepare('SELECT nome FROM estabelecimentos WHERE id=?').bind(tenant).first();
  const timestamp = now();
  const nome = business?.nome || 'Meu restaurante';
  const slug = await escolherSlugLoja(env.rawDB, nome, tenant);
  await env.DB.prepare(
    `INSERT INTO lojas_online (slug,nome,descricao,taxa_entrega,aceita_entrega,aceita_retirada,ativo,criado_em,atualizado_em,pix_chave,pix_cidade)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(slug, nome, null, 0, 1, 1, 0, timestamp, timestamp,
    await getConfigValue(env, 'pix_chave', ''), await getConfigValue(env, 'pix_cidade', '')).run();
  await reservarLinkLoja(env.rawDB, slug, tenant).run();
  store = await env.DB.prepare('SELECT * FROM lojas_online WHERE estabelecimento_id=?').bind(tenant).first();
  return store;
}

async function categoriasDaLoja(env) {
  const rows = await env.DB.prepare('SELECT id, nome, nome_busca FROM lojas_categorias ORDER BY nome COLLATE NOCASE, id').all();
  return rows.results.map((row) => ({ id: num(row.id), nome: row.nome, busca: row.nome_busca }));
}

function pixDaLoja(body, current) {
  if (body.pix_chave === undefined && body.pix_cidade === undefined) {
    return { chave: current.pix_chave || null, cidade: current.pix_cidade || null };
  }
  const chaveInformada = body.pix_chave === undefined ? current.pix_chave : body.pix_chave;
  if (chaveInformada == null || String(chaveInformada).trim() === '') return { chave: null, cidade: null };
  const chave = normalizarChavePix(chaveInformada);
  const cidadeInformada = body.pix_cidade === undefined ? current.pix_cidade : body.pix_cidade;
  const cidade = textoPix(cidadeInformada, 15, '');
  if (cidade.length < 2) throw httpError(400, 'Informe a cidade do recebedor para gerar o Pix.');
  return { chave, cidade };
}

function pagamentoDoPedido(valor) {
  const bruto = String(valor || '').trim().toLocaleLowerCase('pt-BR');
  const pagamento = bruto === 'cartao' ? 'maquininha' : bruto;
  if (pagamento === 'efi_checkout') throw httpError(410, 'O pagamento online está desativado. Escolha Pix direto à loja, dinheiro ou maquininha.');
  if (!['pix', 'dinheiro', 'maquininha'].includes(pagamento)) throw httpError(400, 'Escolha Pix, dinheiro ou maquininha.');
  return pagamento;
}

function modoPublicacaoDaLoja(valor, atual) {
  const modo = valor === undefined ? (atual || 'marketplace') : String(valor || '').trim();
  if (!['marketplace', 'cardapio'].includes(modo)) throw httpError(400, 'Escolha marketplace ou cardápio digital.');
  return modo;
}

async function storeResponse(env) {
  const store = await ensureStore(env);
  const categorias = await categoriasDaLoja(env);
  return {
    ...store,
    ...funcionamentoLoja(store),
    horario_dias: diasDaLoja(store),
    pix_chave: store.pix_chave || null,
    pix_cidade: store.pix_cidade || null,
    pix_disponivel: store.pix_chave ? 1 : 0,
    checkout_efi_disponivel: 0,
    entrega_plataforma_disponivel: plataformaDisponivel(store, env) ? 1 : 0,
    estabelecimento_id: estabelecimentoId(env),
    site_url: `/pedido/${store.slug}`,
    segmentos: categorias.map((categoria) => categoria.nome),
  };
}

async function catalogRows(env, where = '', params = []) {
  return env.DB.prepare(
    `SELECT cp.*, p.nome AS produto_nome, p.preco AS produto_preco, p.observacoes AS produto_observacoes, p.tipo AS produto_tipo, p.combo_grupos_json,
       p.ativo AS produto_ativo, p.exibir_restaurante,
       cc.nome AS cardapio_categoria_nome, cc.id AS cardapio_categoria_ok,
       c.nome AS categoria_estoque_nome
     FROM cardapio_online_produtos cp
     JOIN produtos p ON p.id=cp.produto_id
     LEFT JOIN cardapio_online_categorias cc ON cc.id=cp.cardapio_categoria_id AND cc.ativo=1
     LEFT JOIN categorias c ON c.id=cp.categoria_id
     ${where}
     ORDER BY CASE WHEN cc.id IS NULL THEN 1 ELSE 0 END, cc.ordem, cc.id, cp.ordem, cp.id`
  ).bind(...params).all();
}

async function catalogOptions(env, productIds) {
  if (!productIds.length) return new Map();
  const placeholders = productIds.map(() => '?').join(',');
  const rows = await env.DB.prepare(
    `SELECT * FROM cardapio_online_opcoes WHERE cardapio_produto_id IN (${placeholders}) ORDER BY ordem, id`
  ).bind(...productIds).all();
  const byProduct = new Map();
  for (const option of rows.results) {
    if (!byProduct.has(num(option.cardapio_produto_id))) byProduct.set(num(option.cardapio_produto_id), []);
    byProduct.get(num(option.cardapio_produto_id)).push({
      id: num(option.id), nome: option.nome, tipo: option.tipo, preco_adicional: num(option.preco_adicional),
      insumo_id: option.insumo_id == null ? null : num(option.insumo_id),
      ordem: num(option.ordem), ativo: num(option.ativo),
    });
  }
  return byProduct;
}

function parseOptions(value) {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length > 50) throw httpError(400, 'Opções inválidas');
  return value.map((option, index) => {
    const bruto = option?.insumo_id;
    const insumoId = bruto == null || bruto === '' ? null : Number(bruto);
    if (insumoId != null && (!Number.isInteger(insumoId) || insumoId <= 0)) throw httpError(400, 'Insumo do acréscimo inválido');
    const nome = insumoId
      ? (cleanText(option?.nome, 100, 'Nome da opção') || 'Acréscimo')
      : cleanText(option?.nome, 100, 'Nome da opção', true);
    const tipo = String(option?.tipo || 'removivel');
    if (tipo !== 'removivel' && tipo !== 'adicional') throw httpError(400, 'Tipo de opção inválido');
    const preco = optionalNumber(option?.preco_adicional, 'Preço adicional', { min: 0, max: 10000 }) || 0;
    if (tipo === 'removivel' && preco !== 0) throw httpError(400, 'Ingrediente removível não pode alterar o preço');
    if (insumoId && tipo !== 'adicional') throw httpError(400, 'Somente acréscimo pode vincular um insumo');
    return { nome, tipo, preco_adicional: preco, insumo_id: insumoId, ordem: Number.isInteger(option?.ordem) ? option.ordem : index, ativo: flag(option?.ativo, 1) };
  });
}

async function opcoesInformadas(env, value, produtoId) {
  try {
    const options = parseOptions(value);
    if (options) await vincularInsumosOpcoes(env, options, produtoId);
    return options;
  } catch (error) {
    return { erro: error?.message || 'Acréscimo inválido', status: error?.status || 400 };
  }
}

async function saveOptions(env, catalogId, options) {
  if (options === null) return;
  const statements = [env.DB.prepare('DELETE FROM cardapio_online_opcoes WHERE cardapio_produto_id=?').bind(catalogId)];
  for (const option of options) {
    statements.push(env.DB.prepare(
      `INSERT INTO cardapio_online_opcoes (cardapio_produto_id,nome,tipo,preco_adicional,insumo_id,ordem,ativo,criado_em,atualizado_em)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(catalogId, option.nome, option.tipo, option.preco_adicional, option.insumo_id == null ? null : option.insumo_id, option.ordem, option.ativo, now(), now()));
  }
  await env.DB.batch(statements);
}

async function catalogProduct(env, catalogId) {
  const rows = await catalogRows(env, 'WHERE cp.id=?', [catalogId]);
  const row = rows.results[0];
  if (!row) return null;
  const options = await catalogOptions(env, [num(row.id)]);
  return (await enriquecerCombos(env, [productView(row, options.get(num(row.id)) || [])]))[0];
}

async function enriquecerCombos(env, lista) {
  const ids = [...new Set(lista.flatMap((p) => (p.combo_grupos || []).flatMap((g) => g.opcoes.map((o) => o.produto_id))))];
  if (!ids.length) return lista;
  const rows = await env.DB.prepare('SELECT id,nome,ativo FROM produtos WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all();
  const nomes = new Map(rows.results.filter((p) => num(p.ativo)).map((p) => [num(p.id), p.nome]));
  return lista.map((p) => ({ ...p, combo_grupos: p.combo_grupos.map((g) => ({ ...g, opcoes: g.opcoes.filter((o) => nomes.has(o.produto_id)).map((o) => ({ ...o, nome: nomes.get(o.produto_id) })) })) }));
}

function nulo(value) {
  return value === undefined ? null : value;
}

function modoDaLoja(valor, atual) {
  if (valor === undefined) return atual === 'dividido' || atual === 'gratis' ? atual : 'cliente';
  const modo = String(valor || '').trim();
  if (modo !== 'cliente' && modo !== 'dividido' && modo !== 'gratis') throw httpError(400, 'Modo de entrega inválido');
  return modo;
}

function coordenadaInformada(value, nome) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const numero = Number(value);
  const limite = nome === 'Latitude' ? 90 : 180;
  if (!Number.isFinite(numero) || Math.abs(numero) > limite) throw httpError(400, `${nome} inválida`);
  return numero;
}

async function localDaLoja(env, body, current) {
  try {
    let endereco = body.endereco === undefined ? current.endereco : (cleanText(body.endereco, 180, 'Endereço da loja') || null);
    let latitude = coordenadaInformada(body.latitude, 'Latitude');
    let longitude = coordenadaInformada(body.longitude, 'Longitude');
    if (latitude === undefined) latitude = current.latitude ?? null;
    if (longitude === undefined) longitude = current.longitude ?? null;
    const raio = body.raio_entrega_km === undefined
      ? (current.raio_entrega_km ?? null)
      : optionalNumber(body.raio_entrega_km, 'Limite de entrega', { min: 0.1, max: 100 });
    if (endereco && latitude == null && longitude == null) {
      const ponto = await localizar(env, { q: endereco });
      if (!ponto) return { erro: 'Não foi possível localizar o endereço da loja. Use a localização do aparelho ou informe rua, número e cidade.' };
      latitude = ponto.latitude;
      longitude = ponto.longitude;
      endereco = ponto.endereco || endereco;
    }
    if ((latitude == null) !== (longitude == null)) return { erro: 'Informe a latitude e a longitude juntas' };
    return { endereco: endereco || null, latitude, longitude, raio };
  } catch (error) {
    return { erro: error?.message || 'Localização da loja inválida' };
  }
}

function idOuNulo(value) {
  if (value === undefined || value === null || value === '') return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function catalogPayload(body, previous = {}, precoEstoque = null) {
  const price = body.preco === undefined ? nulo(previous.preco) : optionalNumber(body.preco, 'Preço online', { min: 0, max: 100000 });
  const promocional = body.preco_promocional === undefined ? nulo(previous.preco_promocional) : optionalNumber(body.preco_promocional, 'Preço promocional', { min: 0, max: 100000 });
  const precoNormal = price == null ? precoEstoque : price;
  if (promocional != null && (precoNormal == null || promocional >= precoNormal)) {
    throw httpError(400, 'O preço promocional deve ser menor que o preço normal do delivery');
  }
  return {
    categoria_id: body.categoria_id === undefined ? idOuNulo(previous.categoria_id) : idOuNulo(body.categoria_id),
    cardapio_categoria_id: body.cardapio_categoria_id === undefined ? idOuNulo(previous.cardapio_categoria_id) : idOuNulo(body.cardapio_categoria_id),
    nome_exibicao: body.nome_exibicao === undefined ? nulo(previous.nome_exibicao) : (cleanText(body.nome_exibicao, 160, 'Nome exibido') || null),
    descricao: body.descricao === undefined ? nulo(previous.descricao) : (cleanText(body.descricao, 700, 'Descrição') || null),
    foto_url: body.foto_url === undefined ? nulo(previous.foto_url) : safeImageUrl(body.foto_url),
    preco: nulo(price),
    preco_promocional: nulo(promocional),
    ordem: body.ordem === undefined ? num(previous.ordem) : (Number.isInteger(Number(body.ordem)) && Number(body.ordem) >= 0 && Number(body.ordem) <= 100000 ? Number(body.ordem) : (() => { throw httpError(400, 'Ordem inválida'); })()),
    disponivel: flag(body.disponivel, previous.disponivel ?? 1),
    ativo: flag(body.ativo, previous.ativo ?? 1),
  };
}

// ============================ ADMINISTRAÇÃO ============================

export async function getOnlineStoreHandler(c, env) {
  return c.json(await storeResponse(env));
}

export async function updateOnlineStoreHandler(c, env) {
  const current = await ensureStore(env);
  const body = await c.req.json();
  const nome = body.nome === undefined ? current.nome : cleanText(body.nome, 120, 'Nome da loja', true);
  const slug = body.slug === undefined
    ? (body.nome === undefined ? current.slug : await escolherSlugLoja(env.rawDB, nome, estabelecimentoId(env)))
    : cleanText(body.slug, 60, 'Endereço da loja', true).toLocaleLowerCase();
  if (!SITE_SLUG.test(slug)) return c.json({ error: 'Use 3 a 60 caracteres: letras minúsculas, números e hífen.' }, 400);
  if (body.nome !== undefined) {
    const outras = await env.rawDB.prepare('SELECT nome FROM lojas_online WHERE estabelecimento_id!=?').bind(estabelecimentoId(env)).all();
    const chave = nomeLojaChave(nome);
    if (outras.results.some((row) => nomeLojaChave(row.nome) === chave)) {
      return c.json({ error: 'Já existe uma loja com este nome.' }, 409);
    }
  }
  const descricao = body.descricao === undefined ? current.descricao : (cleanText(body.descricao, 700, 'Descrição') || null);
  const taxa = body.taxa_entrega === undefined ? num(current.taxa_entrega) : (optionalNumber(body.taxa_entrega, 'Taxa de entrega', { min: 0, max: 1000 }) || 0);
  let valorPorKm;
  let modo;
  let modoPublicacao;
  try {
    valorPorKm = body.valor_por_km === undefined ? (current.valor_por_km ?? null) : optionalNumber(body.valor_por_km, 'Valor por km', { min: 0, max: 1000 });
    modo = modoDaLoja(body.modo_entrega, current.modo_entrega);
    modoPublicacao = modoPublicacaoDaLoja(body.modo_publicacao, current.modo_publicacao);
  } catch (error) {
    return c.json({ error: error?.message || 'Cobrança de entrega inválida' }, error?.status || 400);
  }
  const min = body.tempo_min_entrega === undefined ? current.tempo_min_entrega : optionalNumber(body.tempo_min_entrega, 'Tempo mínimo', { min: 0, max: 1440 });
  const max = body.tempo_max_entrega === undefined ? current.tempo_max_entrega : optionalNumber(body.tempo_max_entrega, 'Tempo máximo', { min: 0, max: 1440 });
  if (min !== null && max !== null && min > max) return c.json({ error: 'O tempo mínimo não pode ser maior que o máximo' }, 400);
  const duplicate = await env.rawDB.prepare(
    `SELECT estabelecimento_id FROM lojas_online WHERE slug=? AND estabelecimento_id!=?
     UNION ALL SELECT estabelecimento_id FROM lojas_online_links WHERE slug=? AND estabelecimento_id!=? LIMIT 1`
  ).bind(slug, estabelecimentoId(env), slug, estabelecimentoId(env)).first();
  if (duplicate) return c.json({ error: 'Este endereço já está em uso por outra loja' }, 409);
  const local = await localDaLoja(env, body, current);
  if (local.erro) return c.json({ error: local.erro }, 400);
  let logo;
  let capa;
  let cor;
  try {
    logo = body.logo_url === undefined ? nulo(current.logo_url) : safeImageUrl(body.logo_url);
    capa = body.capa_url === undefined ? nulo(current.capa_url) : safeImageUrl(body.capa_url);
    cor = body.cor_capa === undefined ? corPublica(current.cor_capa) : corDaCapa(body.cor_capa);
  } catch (error) {
    return c.json({ error: error?.message || 'Aparência da loja inválida' }, error?.status || 400);
  }
  if (capa && cor) {
    if (body.capa_url) cor = null;
    else capa = null;
  }
  let pix;
  try {
    pix = pixDaLoja(body, current);
  } catch (error) {
    return c.json({ error: error?.message || 'Chave Pix inválida' }, error?.status || 400);
  }
  let whatsappSuporte;
  try {
    whatsappSuporte = body.whatsapp_suporte === undefined ? current.whatsapp_suporte : whatsappDaLoja(body.whatsapp_suporte);
  } catch (error) {
    return c.json({ error: error?.message || 'WhatsApp inválido' }, error?.status || 400);
  }
  let horario;
  try { horario = configurarHorario(body, current); }
  catch (error) { return c.json({ error: error.message }, error.status || 400); }
  const ativarMotoboy = flag(body.entrega_plataforma_ativo, current.entrega_plataforma_ativo) === 1;
  if (ativarMotoboy && !num(current.entrega_plataforma_ativo)) {
    if (!integracaoEntregasConfigurada({ pix_chave: pix.chave, latitude: local.latitude, longitude: local.longitude }, env)) {
      return c.json({ error: 'Configure Pix, localização da loja e integração HTTPS dos motoboys antes de ativar.' }, 409);
    }
    await chamarEntregas(env, `/api/integration/stores/${estabelecimentoId(env)}/quote`, {
      method: 'POST', body: { distanceKm: 1, subsidy: 'base' },
    });
  }
  const atualizar = env.DB.prepare(
    `UPDATE lojas_online SET slug=?,nome=?,descricao=?,logo_url=?,capa_url=?,cor_capa=?,taxa_entrega=?,tempo_min_entrega=?,tempo_max_entrega=?,
     aceita_entrega=?,aceita_retirada=?,aceita_pedidos_online=?,ativo=?,endereco=?,latitude=?,longitude=?,raio_entrega_km=?,valor_por_km=?,modo_entrega=?,modo_publicacao=?,pix_chave=?,pix_cidade=?,whatsapp_suporte=?,entrega_plataforma_ativo=?,aceitacao_automatica=?,horario_automatico=?,horario_abertura=?,horario_fechamento=?,horario_dias=?,horario_fuso=?,atualizado_em=? WHERE estabelecimento_id=?`
  ).bind(
    slug, nome, nulo(descricao), logo, capa, cor,
    taxa, min, max, flag(body.aceita_entrega, current.aceita_entrega), flag(body.aceita_retirada, current.aceita_retirada),
    flag(body.aceita_pedidos_online, current.aceita_pedidos_online),
    flag(body.ativo, current.ativo), nulo(local.endereco), nulo(local.latitude), nulo(local.longitude), nulo(local.raio),
    nulo(valorPorKm), modo, modoPublicacao, nulo(pix.chave), nulo(pix.cidade), nulo(whatsappSuporte), flag(body.entrega_plataforma_ativo, current.entrega_plataforma_ativo),
    flag(body.aceitacao_automatica, current.aceitacao_automatica), flag(body.horario_automatico, current.horario_automatico),
    horario.abertura, horario.fechamento, horario.dias, horario.fuso, now(), estabelecimentoId(env)
  );
  await env.DB.batch([
    reservarLinkLoja(env.rawDB, current.slug, estabelecimentoId(env)),
    reservarLinkLoja(env.rawDB, slug, estabelecimentoId(env)),
    atualizar,
  ]);
  if (body.pix_chave !== undefined || body.pix_cidade !== undefined) {
    await setConfig(env, 'pix_chave', pix.chave || '');
    await setConfig(env, 'pix_cidade', pix.cidade || '');
  }
  return c.json(await storeResponse(env));
}

export async function listStoreCategoriesHandler(c, env) {
  await ensureStore(env);
  return c.json(await categoriasDaLoja(env));
}

export async function addStoreCategoryHandler(c, env) {
  await ensureStore(env);
  const body = await c.req.json().catch(() => ({}));
  const nome = cleanText(body?.nome, 40, 'Categoria', true);
  const busca = buscaCategoria(nome);
  if (busca.length < 2) return c.json({ error: 'Use um nome de categoria com pelo menos 2 letras' }, 400);
  const atuais = await categoriasDaLoja(env);
  if (atuais.some((categoria) => categoria.busca === busca)) return c.json(atuais);
  if (atuais.length >= MAX_CATEGORIAS_LOJA) return c.json({ error: 'Esta loja já tem 6 categorias' }, 400);
  await env.DB.prepare('INSERT INTO lojas_categorias (nome, nome_busca, criado_em) VALUES (?,?,?)').bind(nome, busca, now()).run();
  return c.json(await categoriasDaLoja(env), 201);
}

export async function removeStoreCategoryHandler(c, env) {
  const id = Number(c.params.id);
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Categoria não encontrada' }, 404);
  await env.DB.prepare('DELETE FROM lojas_categorias WHERE id=?').bind(id).run();
  return c.json(await categoriasDaLoja(env));
}

function nomeCardapioChave(nome) {
  return String(nome || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
}

async function categoriasDoCardapio(env) {
  const rows = await env.DB.prepare(
    'SELECT id, nome, ordem FROM cardapio_online_categorias WHERE ativo=1 ORDER BY ordem, id'
  ).all();
  return rows.results.map((row) => ({ id: num(row.id), nome: row.nome, ordem: num(row.ordem) }));
}

function idLista(valor) {
  const id = Number(valor);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

export async function listMenuCategoriesHandler(c, env) {
  await ensureStore(env);
  return c.json(await categoriasDoCardapio(env));
}

export async function addMenuCategoryHandler(c, env) {
  await ensureStore(env);
  const body = await c.req.json().catch(() => ({}));
  const nome = cleanText(body?.nome, 40, 'Categoria', true);
  const chave = nomeCardapioChave(nome);
  if (chave.length < 2) return c.json({ error: 'Use um nome de categoria com pelo menos 2 letras' }, 400);
  const atuais = await categoriasDoCardapio(env);
  if (atuais.some((categoria) => nomeCardapioChave(categoria.nome) === chave)) {
    return c.json({ error: 'Já existe esta categoria no cardápio.' }, 409);
  }
  if (atuais.length >= 30) return c.json({ error: 'O cardápio já tem 30 categorias' }, 400);
  const ordem = atuais.reduce((maximo, categoria) => Math.max(maximo, categoria.ordem), -1) + 1;
  await env.DB.prepare(
    'INSERT INTO cardapio_online_categorias (nome, ordem, ativo, criado_em, atualizado_em) VALUES (?,?,1,?,?)'
  ).bind(nome, ordem, now(), now()).run();
  return c.json(await categoriasDoCardapio(env), 201);
}

export async function updateMenuCategoryHandler(c, env) {
  const id = idLista(c.params.id);
  const atual = id ? await env.DB.prepare('SELECT * FROM cardapio_online_categorias WHERE id=? AND ativo=1').bind(id).first() : null;
  if (!atual) return c.json({ error: 'Categoria não encontrada' }, 404);
  const body = await c.req.json().catch(() => ({}));
  let nome = atual.nome;
  if (body.nome !== undefined) {
    nome = cleanText(body.nome, 40, 'Categoria', true);
    const chave = nomeCardapioChave(nome);
    if (chave.length < 2) return c.json({ error: 'Use um nome de categoria com pelo menos 2 letras' }, 400);
    const outras = await categoriasDoCardapio(env);
    if (outras.some((categoria) => categoria.id !== id && nomeCardapioChave(categoria.nome) === chave)) {
      return c.json({ error: 'Já existe esta categoria no cardápio.' }, 409);
    }
  }
  let ordem = num(atual.ordem);
  if (body.ordem !== undefined) {
    const valor = Number(body.ordem);
    if (!Number.isInteger(valor) || valor < 0 || valor > 100000) return c.json({ error: 'Ordem inválida' }, 400);
    ordem = valor;
  }
  await env.DB.prepare('UPDATE cardapio_online_categorias SET nome=?, ordem=?, atualizado_em=? WHERE id=?')
    .bind(nome, ordem, now(), id).run();
  return c.json(await categoriasDoCardapio(env));
}

export async function removeMenuCategoryHandler(c, env) {
  const id = idLista(c.params.id);
  const atual = id ? await env.DB.prepare('SELECT id FROM cardapio_online_categorias WHERE id=? AND ativo=1').bind(id).first() : null;
  if (!atual) return c.json({ error: 'Categoria não encontrada' }, 404);
  const timestamp = now();
  await env.DB.batch([
    env.DB.prepare('UPDATE cardapio_online_produtos SET cardapio_categoria_id=NULL, atualizado_em=? WHERE cardapio_categoria_id=?').bind(timestamp, id),
    env.DB.prepare('UPDATE cardapio_online_categorias SET ativo=0, atualizado_em=? WHERE id=?').bind(timestamp, id),
  ]);
  return c.json(await categoriasDoCardapio(env));
}

export async function organizeMenuHandler(c, env) {
  const body = await c.req.json().catch(() => ({}));
  const categorias = Array.isArray(body?.categorias) ? body.categorias : null;
  const produtos = Array.isArray(body?.produtos) ? body.produtos : null;
  if (!categorias || !produtos || categorias.length > 30 || produtos.length > 500) {
    return c.json({ error: 'Organização inválida' }, 400);
  }
  const atuais = await categoriasDoCardapio(env);
  const idsCategoria = new Set(atuais.map((categoria) => categoria.id));
  const rows = await env.DB.prepare('SELECT id FROM cardapio_online_produtos WHERE ativo=1').all();
  const idsProduto = new Set(rows.results.map((row) => num(row.id)));
  const stmts = [];
  const timestamp = now();
  const categoriasVistas = new Set();
  for (const [indice, item] of categorias.entries()) {
    const id = idLista(item?.id);
    if (!idsCategoria.has(id) || categoriasVistas.has(id)) return c.json({ error: 'Categoria não encontrada' }, 400);
    categoriasVistas.add(id);
    const ordem = item?.ordem === undefined ? indice : Number(item.ordem);
    if (!Number.isInteger(ordem) || ordem < 0 || ordem > 100000) return c.json({ error: 'Ordem inválida' }, 400);
    stmts.push(env.DB.prepare('UPDATE cardapio_online_categorias SET ordem=?, atualizado_em=? WHERE id=?').bind(ordem, timestamp, id));
  }
  const produtosVistos = new Set();
  for (const [indice, item] of produtos.entries()) {
    const id = idLista(item?.id);
    if (!idsProduto.has(id) || produtosVistos.has(id)) return c.json({ error: 'Produto do cardápio não encontrado' }, 400);
    produtosVistos.add(id);
    const categoria = item?.cardapio_categoria_id == null || item?.cardapio_categoria_id === ''
      ? null
      : idLista(item.cardapio_categoria_id);
    if (item?.cardapio_categoria_id != null && item?.cardapio_categoria_id !== '' && !categoria) {
      return c.json({ error: 'Categoria do cardápio não encontrada' }, 400);
    }
    if (categoria && !idsCategoria.has(categoria)) return c.json({ error: 'Categoria do cardápio não encontrada' }, 400);
    const ordem = item?.ordem === undefined ? indice : Number(item.ordem);
    if (!Number.isInteger(ordem) || ordem < 0 || ordem > 100000) return c.json({ error: 'Ordem inválida' }, 400);
    stmts.push(env.DB.prepare(
      'UPDATE cardapio_online_produtos SET cardapio_categoria_id=?, ordem=?, atualizado_em=? WHERE id=?'
    ).bind(categoria, ordem, timestamp, id));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return c.json({ ok: true, categorias: await categoriasDoCardapio(env) });
}

async function exigirCategoriaCardapio(env, id) {
  if (!id) return null;
  const category = await env.DB.prepare('SELECT id FROM cardapio_online_categorias WHERE id=? AND ativo=1').bind(id).first();
  if (!category) return { error: 'Categoria do cardápio não encontrada' };
  return null;
}

async function vendidosDaLoja(env, tenantId) {
  const db = env.rawDB || env.DB;
  const rows = await db.prepare(
    `SELECT i.cardapio_produto_id AS id, SUM(i.quantidade) AS vendidos
     FROM pedidos_online_itens i
     JOIN pedidos_online po ON po.id=i.pedido_online_id AND po.estabelecimento_id=i.estabelecimento_id
     WHERE i.estabelecimento_id=? AND po.status!='cancelado'
     GROUP BY i.cardapio_produto_id`
  ).bind(tenantId).all();
  const mapa = new Map();
  for (const row of rows.results) mapa.set(num(row.id), num(row.vendidos));
  return mapa;
}

function comVendidos(produto, mapa) {
  return { ...produto, vendidos: mapa.get(produto.id) || 0 };
}

export async function listOnlineCatalogHandler(c, env) {
  const rows = await catalogRows(env);
  const options = await catalogOptions(env, rows.results.map((row) => num(row.id)));
  const vendas = await vendidosDaLoja(env, estabelecimentoId(env));
  return c.json(await enriquecerCombos(env, rows.results.map((row) => comVendidos(productView(row, options.get(num(row.id)) || []), vendas))));
}

export async function upsertOnlineCatalogProductHandler(c, env) {
  const body = await c.req.json();
  const productId = Number(body.produto_id);
  if (!Number.isInteger(productId) || productId <= 0) return c.json({ error: 'Produto inválido' }, 400);
  const product = await env.DB.prepare('SELECT * FROM produtos WHERE id=? AND ativo=1').bind(productId).first();
  if (!product) return c.json({ error: 'Produto não encontrado ou inativo' }, 404);
  if (!['produto', 'composto', 'combo'].includes(product.tipo)) {
    return c.json({ error: 'O delivery só publica produto simples, composto ou combo cadastrado' }, 400);
  }
  const existing = await env.DB.prepare('SELECT * FROM cardapio_online_produtos WHERE produto_id=?').bind(productId).first();
  const data = catalogPayload(body, existing || { categoria_id: product.categoria_id, preco: product.preco, disponivel: 1, ativo: 1, ordem: 0 }, product.preco);
  if (existing && num(existing.ativo) === 0 && body.ativo === undefined) data.ativo = 1;
  if (!existing && product.tipo === 'composto') data.descricao = await descricaoComIngredientes(env, product.id, data.descricao);
  if (data.categoria_id) {
    const category = await env.DB.prepare('SELECT id FROM categorias WHERE id=?').bind(data.categoria_id).first();
    if (!category) return c.json({ error: 'Categoria não encontrada' }, 400);
  }
  const categoriaCardapio = await exigirCategoriaCardapio(env, data.cardapio_categoria_id);
  if (categoriaCardapio) return c.json(categoriaCardapio, 400);
  const options = await opcoesInformadas(env, body.opcoes, productId);
  if (options?.erro) return c.json({ error: options.erro }, options.status || 400);
  const timestamp = now();
  if (existing) {
    await env.DB.prepare(
      `UPDATE cardapio_online_produtos SET categoria_id=?,cardapio_categoria_id=?,nome_exibicao=?,descricao=?,foto_url=?,preco=?,preco_promocional=?,ordem=?,disponivel=?,ativo=?,atualizado_em=? WHERE id=?`
    ).bind(data.categoria_id, data.cardapio_categoria_id, data.nome_exibicao, data.descricao, data.foto_url, data.preco, data.preco_promocional, data.ordem, data.disponivel, data.ativo, timestamp, existing.id).run();
    await saveOptions(env, existing.id, options);
    return c.json(await catalogProduct(env, existing.id));
  }
  const created = await env.DB.prepare(
    `INSERT INTO cardapio_online_produtos (produto_id,categoria_id,cardapio_categoria_id,nome_exibicao,descricao,foto_url,preco,preco_promocional,ordem,disponivel,ativo,criado_em,atualizado_em)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(productId, data.categoria_id, data.cardapio_categoria_id, data.nome_exibicao, data.descricao, data.foto_url, data.preco, data.preco_promocional, data.ordem, data.disponivel, data.ativo, timestamp, timestamp).run();
  await saveOptions(env, created.meta.last_row_id, options);
  return c.json(await catalogProduct(env, created.meta.last_row_id), 201);
}

export async function updateOnlineCatalogProductHandler(c, env) {
  const existing = await env.DB.prepare('SELECT * FROM cardapio_online_produtos WHERE id=?').bind(c.params.id).first();
  if (!existing) return c.json({ error: 'Produto do cardápio não encontrado' }, 404);
  const body = await c.req.json();
  const product = await env.DB.prepare('SELECT preco FROM produtos WHERE id=?').bind(existing.produto_id).first();
  const data = catalogPayload(body, existing, product?.preco);
  if (data.categoria_id) {
    const category = await env.DB.prepare('SELECT id FROM categorias WHERE id=?').bind(data.categoria_id).first();
    if (!category) return c.json({ error: 'Categoria não encontrada' }, 400);
  }
  const categoriaCardapio = await exigirCategoriaCardapio(env, data.cardapio_categoria_id);
  if (categoriaCardapio) return c.json(categoriaCardapio, 400);
  const options = await opcoesInformadas(env, body.opcoes, existing.produto_id);
  if (options?.erro) return c.json({ error: options.erro }, options.status || 400);
  await env.DB.prepare(
    `UPDATE cardapio_online_produtos SET categoria_id=?,cardapio_categoria_id=?,nome_exibicao=?,descricao=?,foto_url=?,preco=?,preco_promocional=?,ordem=?,disponivel=?,ativo=?,atualizado_em=? WHERE id=?`
  ).bind(data.categoria_id, data.cardapio_categoria_id, data.nome_exibicao, data.descricao, data.foto_url, data.preco, data.preco_promocional, data.ordem, data.disponivel, data.ativo, now(), existing.id).run();
  await saveOptions(env, existing.id, options);
  return c.json(await catalogProduct(env, existing.id));
}

export async function removeOnlineCatalogProductHandler(c, env) {
  const result = await env.DB.prepare('UPDATE cardapio_online_produtos SET ativo=0,atualizado_em=? WHERE id=?').bind(now(), c.params.id).run();
  if (!result.meta.changes) return c.json({ error: 'Produto do cardápio não encontrado' }, 404);
  return c.json({ ok: true });
}

export async function createOnlineOnlyProductHandler(c) {
  return c.json({ error: 'O delivery só aceita produtos que já estão cadastrados no estoque' }, 400);
}

function esperaMinutos(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.floor(ms / 60000);
}

function etapaPainel(row) {
  if (row.status === 'cancelado' || row.etapa === 'cancelado') return 'cancelado';
  if (row.etapa === 'aguardando_pix') return 'aguardando_pix';
  if (row.etapa === 'aguardando_pagamento') return 'aguardando_pagamento';
  if (row.etapa === 'entregue' || row.status === 'finalizado') return 'entregue';
  if (row.etapa === 'saiu_entrega' || row.etapa === 'pronto_retirada' || row.etapa === 'preparando') return row.etapa;
  if (row.status === 'confirmado') return 'preparando';
  return 'recebido';
}

function etapaCliente(row) {
  if (row.status === 'cancelado' || row.etapa === 'cancelado') return 'cancelado';
  if (row.etapa === 'entregue' || row.status === 'finalizado' || row.comanda_status === 'fechada') return 'entregue';
  return etapaPainel(row);
}

function itemPedido(row) {
  return {
    id: num(row.id),
    nome: row.nome,
    quantidade: num(row.quantidade),
    observacao: row.observacao || '',
    status: row.status,
    preco_unitario: num(row.preco_unitario),
    total: num(row.total),
    criado_em: row.criado_em,
  };
}

export async function painelPedidosHandler(c, env) {
  const deliverySelect =
    `SELECT po.id, po.comanda_id, po.mesa_id, po.cliente_nome, po.telefone, po.tipo_entrega,
       po.endereco, po.forma_pagamento, po.troco_para, po.observacao, po.status, po.etapa,
       po.subtotal, po.taxa_entrega, po.valor_entrega, po.distancia_km, po.modo_entrega, po.total, po.criado_em, c.status AS comanda_status,
       (SELECT COUNT(*) FROM comanda_itens ci WHERE ci.comanda_id=po.comanda_id AND ci.status='novo') AS impressao_pendente
     FROM pedidos_online po
     LEFT JOIN comandas c ON c.id=po.comanda_id`;
  const deliveryRows = await env.DB.prepare(
    `${deliverySelect}
     WHERE po.status IN ('recebido','confirmado')
       AND COALESCE(po.etapa,'recebido') NOT IN ('entregue','cancelado')
       AND (c.id IS NULL OR c.status IN ('aberta','pre_fechamento'))
     ORDER BY po.criado_em ASC, po.id ASC
     LIMIT 100`
  ).all();
  const deliveredRows = await env.DB.prepare(
    `${deliverySelect}
     WHERE po.status IN ('recebido','confirmado','finalizado')
       AND (po.etapa='entregue' OR po.status='finalizado' OR c.status='fechada')
     ORDER BY COALESCE(po.atualizado_em,po.criado_em) DESC, po.id DESC
     LIMIT 100`
  ).all();
  const deliveryIds = [...deliveryRows.results, ...deliveredRows.results].map((row) => num(row.id));
  const deliveryItems = deliveryIds.length
    ? (await env.DB.prepare(
      `SELECT id, pedido_online_id, nome, quantidade, observacao, preco_unitario, total
       FROM pedidos_online_itens WHERE pedido_online_id IN (${deliveryIds.map(() => '?').join(',')}) ORDER BY ordem, id`
    ).bind(...deliveryIds).all()).results
    : [];
  const itensDelivery = new Map();
  for (const item of deliveryItems) {
    const id = num(item.pedido_online_id);
    if (!itensDelivery.has(id)) itensDelivery.set(id, []);
    itensDelivery.get(id).push(itemPedido(item));
  }

  const restauranteRows = await env.DB.prepare(
    `SELECT c.id, c.mesa_id, c.cliente_nome, c.garcom_nome, c.status, c.criado_em,
       m.numero AS mesa_numero, m.nome AS mesa_nome, m.tipo AS mesa_tipo, m.nfc_uid
     FROM comandas c
     JOIN mesas m ON m.id=c.mesa_id
     WHERE c.status IN ('aberta','pre_fechamento')
       AND COALESCE(m.tipo,'normal') NOT IN ('online','pagamentos')
     ORDER BY c.criado_em ASC, c.id ASC
     LIMIT 100`
  ).all();
  const comandaIds = restauranteRows.results.map((row) => num(row.id));
  const restauranteItems = comandaIds.length
    ? (await env.DB.prepare(
      `SELECT id, comanda_id, nome, quantidade, observacao, status, preco_unitario, criado_em,
         quantidade * preco_unitario AS total
       FROM comanda_itens WHERE comanda_id IN (${comandaIds.map(() => '?').join(',')}) AND status!='cancelado'
       ORDER BY id`
    ).bind(...comandaIds).all()).results
    : [];
  const itensRestaurante = new Map();
  for (const item of restauranteItems) {
    const id = num(item.comanda_id);
    if (!itensRestaurante.has(id)) itensRestaurante.set(id, []);
    itensRestaurante.get(id).push(itemPedido(item));
  }

  const fila = await env.DB.prepare(
    `SELECT i.id, i.comanda_id, i.nome, i.quantidade, i.observacao, i.status, i.criado_em,
       c.cliente_nome, c.garcom_nome,
       m.numero AS mesa_numero, m.nome AS mesa_nome, m.tipo AS mesa_tipo, m.nfc_uid,
       po.id AS pedido_online_id, po.tipo_entrega, po.endereco, po.telefone, po.cliente_nome AS pedido_cliente
     FROM comanda_itens i
     JOIN comandas c ON c.id=i.comanda_id
     JOIN mesas m ON m.id=c.mesa_id
     LEFT JOIN pedidos_online po ON po.comanda_id=c.id
     WHERE c.status='aberta' AND i.status IN ('novo','enviado')
       AND COALESCE(m.tipo,'normal')!='pagamentos'
     ORDER BY i.criado_em ASC, i.id ASC
     LIMIT 200`
  ).all();

  const mapDelivery = (row) => ({
      id: num(row.id),
      comanda_id: row.comanda_id == null ? null : num(row.comanda_id),
      mesa_id: row.mesa_id == null ? null : num(row.mesa_id),
      cliente_nome: row.cliente_nome,
      telefone: row.telefone,
      tipo_entrega: row.tipo_entrega,
      endereco: row.endereco || null,
      forma_pagamento: row.forma_pagamento,
      troco_para: row.troco_para == null || row.troco_para === '' ? null : num(row.troco_para),
      observacao: row.observacao || '',
      status: row.status,
      etapa: etapaCliente(row),
      comanda_status: row.comanda_status || null,
      impressao_pendente: num(row.impressao_pendente),
      subtotal: num(row.subtotal),
      taxa_entrega: num(row.taxa_entrega),
      valor_entrega: row.valor_entrega == null || row.valor_entrega === '' ? null : num(row.valor_entrega),
      distancia_km: row.distancia_km == null || row.distancia_km === '' ? null : num(row.distancia_km),
      modo_entrega: row.modo_entrega || null,
      entrega_gratis: row.modo_entrega === 'gratis' ? 1 : 0,
      total: num(row.total),
      criado_em: row.criado_em,
      espera_min: esperaMinutos(row.criado_em),
      itens: itensDelivery.get(num(row.id)) || [],
    });
  return c.json({
    delivery: deliveryRows.results.map(mapDelivery),
    delivery_entregues: deliveredRows.results.map(mapDelivery),
    restaurante: restauranteRows.results.map((row) => {
      const itens = itensRestaurante.get(num(row.id)) || [];
      return {
        id: num(row.id),
        mesa_id: num(row.mesa_id),
        cliente_nome: row.cliente_nome || '',
        garcom_nome: row.garcom_nome || '',
        status: row.status,
        criado_em: row.criado_em,
        espera_min: esperaMinutos(row.criado_em),
        mesa_numero: num(row.mesa_numero),
        mesa_nome: row.mesa_nome || '',
        mesa_tipo: row.mesa_tipo || 'normal',
        nfc_uid: row.nfc_uid || null,
        total: Math.round(itens.reduce((sum, item) => sum + num(item.total), 0) * 100) / 100,
        pendentes: itens.filter((item) => item.status === 'novo' || item.status === 'enviado').length,
        itens,
      };
    }),
    prioridade: fila.results.map((row, index) => ({
      posicao: index + 1,
      id: num(row.id),
      comanda_id: num(row.comanda_id),
      pedido_online_id: row.pedido_online_id == null ? null : num(row.pedido_online_id),
      canal: row.mesa_tipo === 'online' ? 'delivery' : 'restaurante',
      nome: row.nome,
      quantidade: num(row.quantidade),
      observacao: row.observacao || '',
      status: row.status,
      criado_em: row.criado_em,
      espera_min: esperaMinutos(row.criado_em),
      cliente_nome: row.pedido_cliente || row.cliente_nome || '',
      garcom_nome: row.garcom_nome || '',
      telefone: row.telefone || '',
      tipo_entrega: row.tipo_entrega || null,
      endereco: row.endereco || null,
      mesa_numero: num(row.mesa_numero),
      mesa_nome: row.mesa_nome || '',
      mesa_tipo: row.mesa_tipo || 'normal',
      nfc_uid: row.nfc_uid || null,
    })),
  });
}

function lugarCozinha(row) {
  if (row.mesa_tipo === 'online') return row.tipo_entrega === 'retirada' ? 'Retirada' : 'Entrega';
  if (row.mesa_tipo === 'cartao') return `Cartão ${row.nfc_uid || row.mesa_numero}`;
  return `Mesa ${row.mesa_numero}`;
}

export async function painelCozinhaHandler(c, env) {
  // O painel acompanha o cadastro dos produtos, independentemente da impressão.
  const categorias = (await env.DB.prepare('SELECT id,nome,categoria_pai_id FROM categorias ORDER BY nome COLLATE NOCASE,id').all()).results;
  const porId = new Map(categorias.map(cat=>[num(cat.id),cat]));
  const caminho = (cat) => {
    const lista = [], vistos = new Set();
    while (cat && !vistos.has(cat.id)) {
      vistos.add(cat.id); lista.unshift(cat); cat = porId.get(num(cat.categoria_pai_id));
    }
    return lista;
  };
  const caminhos = new Map(categorias.map(cat=>[num(cat.id),caminho(cat)]));
  const filtro = c.req.query('categoria_id');
  const categoriaId = filtro ? Number(filtro) : null;
  if (filtro && (!Number.isSafeInteger(categoriaId) || !porId.has(categoriaId))) return c.json({ error:'Categoria não encontrada' },404);
  const descendentes = categoriaId ? categorias.filter(cat=>caminhos.get(num(cat.id)).some(pai=>num(pai.id)===categoriaId)).map(cat=>num(cat.id)) : [];
  const vinculos = (await env.DB.prepare('SELECT pc.produto_id,pc.categoria_id FROM produto_categorias pc JOIN categorias cat ON cat.id=pc.categoria_id').all()).results;
  const porProduto = new Map();
  for (const vinculo of vinculos) {
    const id = num(vinculo.produto_id);
    if (!porProduto.has(id)) porProduto.set(id,new Set());
    porProduto.get(id).add(num(vinculo.categoria_id));
  }
  const rows = await env.DB.prepare(
    `SELECT i.id, i.comanda_id, i.produto_id, i.nome, i.quantidade, i.observacao, i.status,
       i.criado_em, i.enviado_em,
       COALESCE(p.nome,c.cliente_nome) AS cliente_nome, i.pessoa_id, c.garcom_nome,
       m.numero AS mesa_numero, m.tipo AS mesa_tipo, m.nfc_uid,
       po.tipo_entrega, po.cliente_nome AS pedido_cliente
     FROM comanda_itens i
     JOIN comandas c ON c.id=i.comanda_id
     JOIN mesas m ON m.id=c.mesa_id
     LEFT JOIN comanda_pessoas p ON p.id=i.pessoa_id AND p.comanda_id=c.id
     LEFT JOIN pedidos_online po ON po.comanda_id=c.id
     WHERE c.status IN ('aberta','pre_fechamento')
       AND i.status IN ('novo','enviado')
       AND COALESCE(m.tipo,'normal')!='pagamentos'
       ${categoriaId ? 'AND EXISTS (SELECT 1 FROM produto_categorias pc WHERE pc.produto_id=i.produto_id AND pc.categoria_id IN (SELECT value FROM json_each(?)))' : ''}
     ORDER BY COALESCE(i.enviado_em, i.criado_em) ASC, i.id ASC
     LIMIT 300`
  ).bind(...(categoriaId ? [JSON.stringify(descendentes)] : [])).all();

  const grupos = new Map();
  for (const row of rows.results) {
    const raizes = [...new Set([...(porProduto.get(num(row.produto_id)) || [])].map(id=>num(caminhos.get(id)?.[0]?.id)).filter(Boolean))];
    const destinos = categoriaId ? [{id:`categoria:${categoriaId}`,nome:caminhos.get(categoriaId).map(cat=>cat.nome).join(' › ')}]
      : raizes.length ? raizes.map(id=>({id:`categoria:${id}`,nome:porId.get(id).nome})) : [{id:'sem-categoria',nome:'Sem categoria'}];
    for (const destino of destinos) {
      const quando = row.enviado_em || row.criado_em || '';
      const chave = `${destino.id}|${row.comanda_id}|${row.pessoa_id || ''}|${row.status}|${quando}`;
      if (!grupos.has(chave)) {
        grupos.set(chave, {
          destino,
          id: chave,
          comanda_id: num(row.comanda_id),
          lugar: lugarCozinha(row),
          canal: row.mesa_tipo === 'online' ? 'delivery' : 'restaurante',
          cliente_nome: row.pedido_cliente || row.cliente_nome || '',
          garcom_nome: row.garcom_nome || '',
          status: row.status,
          criado_em: quando,
          espera_min: esperaMinutos(quando),
          itens: [],
          vistos: new Set(),
        });
      }
      const grupo = grupos.get(chave);
      const itemId = num(row.id);
      if (grupo.vistos.has(itemId)) continue;
      grupo.vistos.add(itemId);
      grupo.itens.push({
        id: itemId,
        nome: row.nome,
        quantidade: num(row.quantidade),
        observacao: row.observacao || '',
        status: row.status,
      });
    }
  }

  const bases = categoriaId ? [{id:`categoria:${categoriaId}`,nome:caminhos.get(categoriaId).map(cat=>cat.nome).join(' › ')}]
    : categorias.filter(cat=>num(caminhos.get(num(cat.id))[0]?.id)===num(cat.id)).map(cat=>({id:`categoria:${cat.id}`,nome:cat.nome}));
  const porEstacao = new Map(bases.map(base=>[base.id,{...base,lancamentos:[]}]));
  for (const grupo of grupos.values()) {
    if (!porEstacao.has(grupo.destino.id)) {
      porEstacao.set(grupo.destino.id, { id: grupo.destino.id, nome: grupo.destino.nome, lancamentos: [] });
    }
    const { destino, vistos, ...lancamento } = grupo;
    porEstacao.get(destino.id).lancamentos.push(lancamento);
  }
  for (const estacao of porEstacao.values()) {
    estacao.lancamentos.sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)) || a.comanda_id - b.comanda_id);
  }
  return c.json({ estacoes:[...porEstacao.values()], categorias:categorias.map(cat=>({...cat,caminho:caminhos.get(num(cat.id)).map(pai=>pai.nome).join(' › ')})) });
}

// A loja vem de uma consulta por slug ou da sessão autenticada. Nunca do corpo
// público. Reservas da impressão evitam duplicatas em retries e confirmações.
async function aceitarPedido(env, row, automatico = true, user) {
  const tenant = Number(row.estabelecimento_id);
  const rawDB = env.rawDB || env.DB;
  const scoped = { ...env, rawDB, DB: new TenantDb(rawDB, tenant), estabelecimentoId: tenant };
  await scoped.DB.prepare(`UPDATE pedidos_online SET status='confirmado',etapa='preparando',atualizado_em=?
    WHERE id=? AND status='recebido' AND etapa='recebido' AND comanda_id IS NOT NULL
    ${automatico ? 'AND EXISTS (SELECT 1 FROM lojas_online WHERE aceitacao_automatica=1)' : ''}`)
    .bind(now(), row.id).run();
  const fresh = await scoped.DB.prepare('SELECT * FROM pedidos_online WHERE id=?').bind(row.id).first();
  let impressao = null;
  if (fresh?.status === 'confirmado' && fresh.etapa === 'preparando' && fresh.comanda_id) {
    try { impressao = await dispatchOrders({ user }, scoped, { comanda_id: fresh.comanda_id }); }
    catch (error) {
      // O pedido permanece aceito e os itens sem reserva podem ser reenviados
      // pelo painel. Uma falha da fila não transforma a compra em erro.
      console.error('[delivery] print_failed', { order_id: row.id, message: String(error?.message || error).slice(0, 200) });
      impressao = { falhas: [{ impressora: 'Delivery', erro: 'Não foi possível enfileirar. Use Imprimir pedido no painel.' }] };
    }
  }
  return { row: fresh, impressao };
}

async function liberarPedidoPagamento(env, row) {
  const timestamp = now();
  const virtualNumber = 900000000;
  const id = num(row.id);
  const etapaPendente = row.etapa;
  if (!['aguardando_pix', 'aguardando_pagamento'].includes(etapaPendente)) return;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO mesas (estabelecimento_id,numero,nome,capacidade,setor,status,ativo,aberta_em,criado_em,tipo)
       SELECT ?,?+id,'Pedido online #' || id,1,'Delivery online','ocupada',1,?,?,'online'
       FROM pedidos_online WHERE id=? AND mesa_id IS NULL AND etapa=?`
    ).bind(row.estabelecimento_id, virtualNumber, timestamp, timestamp, id, etapaPendente),
    env.DB.prepare(
      `INSERT INTO comandas (estabelecimento_id,mesa_id,cliente_nome,garcom_nome,status,taxa_garcom_pct,pessoas_count,criado_em)
       SELECT o.estabelecimento_id,m.id,o.cliente_nome,'Pedido online','aberta',0,1,?
       FROM pedidos_online o JOIN mesas m ON m.estabelecimento_id=o.estabelecimento_id AND m.numero=?+o.id
       WHERE o.id=? AND o.comanda_id IS NULL AND o.etapa=?`
    ).bind(timestamp, virtualNumber, id, etapaPendente),
    env.DB.prepare(
      `UPDATE pedidos_online SET mesa_id=(SELECT m.id FROM mesas m WHERE m.estabelecimento_id=pedidos_online.estabelecimento_id AND m.numero=?+pedidos_online.id),
       comanda_id=(SELECT c.id FROM comandas c JOIN mesas m ON m.id=c.mesa_id WHERE c.estabelecimento_id=pedidos_online.estabelecimento_id AND m.numero=?+pedidos_online.id),
       etapa='recebido', atualizado_em=? WHERE id=? AND comanda_id IS NULL AND etapa=?`
    ).bind(virtualNumber, virtualNumber, timestamp, id, etapaPendente),
    env.DB.prepare(
      `INSERT INTO comanda_itens (estabelecimento_id,comanda_id,pessoa_id,produto_id,nome,quantidade,preco_unitario,observacao,acrescimos_json,combo_escolhas_json,status,responsavel,criado_em)
       SELECT i.estabelecimento_id,o.comanda_id,NULL,i.produto_id,i.nome,i.quantidade,i.preco_unitario,NULLIF(i.observacao,''),i.acrescimos_json,i.combo_escolhas_json,'novo','Pedido online',?
       FROM pedidos_online o JOIN pedidos_online_itens i ON i.pedido_online_id=o.id AND i.estabelecimento_id=o.estabelecimento_id
       WHERE o.id=? AND o.comanda_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM comanda_itens ci WHERE ci.comanda_id=o.comanda_id)`
    ).bind(timestamp, id),
  ]);
}

export async function atualizarPedidoOnlineHandler(c, env) {
  const body = await c.req.json().catch(() => ({}));
  const acao = String(body?.status || '');
  if (!['confirmado', 'cancelado', 'saiu_entrega', 'pronto_retirada', 'entregue', 'pix_recebido'].includes(acao)) {
    return c.json({ error: 'Status inválido' }, 400);
  }
  const row = await env.DB.prepare('SELECT * FROM pedidos_online WHERE id=?').bind(c.params.id).first();
  if (!row) return c.json({ error: 'Pedido não encontrado' }, 404);
  const etapa = etapaPainel(row);
  if (row.status === 'cancelado' || row.status === 'finalizado' || etapa === 'cancelado' || etapa === 'entregue') {
    return c.json({ error: 'Este pedido já foi encerrado' }, 409);
  }
  const timestamp = now();
  if (acao === 'pix_recebido') {
    if (row.forma_pagamento !== 'pix' || etapa !== 'aguardando_pix') {
      return c.json({ error: 'Este pedido não está aguardando Pix' }, 409);
    }
    await liberarPedidoPagamento(env, row);
    const released = await env.DB.prepare('SELECT id, status, etapa, comanda_id FROM pedidos_online WHERE id=?').bind(row.id).first();
    if (!released?.comanda_id || released.etapa !== 'recebido') {
      throw httpError(409, 'Não foi possível liberar o pedido. Tente novamente.');
    }
    let despacho = null;
    if (num(row.entrega_plataforma) === 1) {
      try { despacho = await despacharEntregaPix(env, row.id); }
      catch (error) {
        await env.DB.prepare("UPDATE pedidos_online SET entrega_despacho_status='erro' WHERE id=?").bind(row.id).run();
        despacho = { error: error?.message || 'O serviço de motoboys está indisponível. Tente chamar novamente.' };
      }
    }
    const accepted = await aceitarPedido(env, row, true, c.user);
    return c.json({ ok: true, id: num(row.id), status: accepted.row.status, etapa: accepted.row.etapa,
      comanda_id: num(released.comanda_id), despacho, impressao: accepted.impressao });
  }
  if (['aguardando_pix', 'aguardando_pagamento'].includes(etapa) && acao !== 'cancelado') {
    return c.json({ error: 'Confirme o Pix antes de liberar o pedido' }, 409);
  }
  if (acao === 'confirmado') {
    if (etapa !== 'recebido') return c.json({ error: 'Este pedido já foi confirmado' }, 409);
    const accepted = await aceitarPedido(env, row, false, c.user);
    return c.json({ ok: true, id: num(row.id), status: accepted.row.status, etapa: accepted.row.etapa, impressao: accepted.impressao });
  }
  if (acao === 'cancelado') {
    if (num(row.entrega_plataforma) === 1 && row.entrega_externa_id) {
      const path = `/api/integration/stores/${row.estabelecimento_id}/orders/${row.entrega_externa_id}`;
      let corrida = await chamarEntregas(env, path);
      if (['delivered', 'in_transit', 'incident'].includes(corrida.status)) {
        if (corrida.status === 'in_transit') {
          await chamarEntregas(env, `${path}/cancel`, { method: 'POST', body: { note: 'Cancelamento solicitado no DoixP Delivery após a retirada.' } });
        }
        return c.json({ error: 'O motoboy já retirou o pedido ou há uma ocorrência. Aguarde a análise do suporte.' }, 409);
      }
      if (!['cancelled', 'returned'].includes(corrida.status)) {
        corrida = await chamarEntregas(env, `${path}/cancel`, { method: 'POST', body: { note: 'Cancelamento solicitado no DoixP Delivery.' } });
        if (corrida.status !== 'cancelled') return c.json({ error: 'A corrida precisa ser analisada pelo suporte antes de cancelar o pedido.' }, 409);
      }
    }
    await env.DB.prepare("UPDATE pedidos_online SET status='cancelado', etapa='cancelado', atualizado_em=? WHERE id=?").bind(timestamp, row.id).run();
    if (row.comanda_id) {
      await env.DB.prepare("UPDATE comanda_itens SET status='cancelado' WHERE comanda_id=? AND status IN ('novo','enviado')").bind(row.comanda_id).run();
      await env.DB.prepare("UPDATE comandas SET status='fechada', fechada_em=? WHERE id=? AND status='aberta'").bind(timestamp, row.comanda_id).run();
      if (row.mesa_id) await env.DB.prepare("UPDATE mesas SET status='livre' WHERE id=?").bind(row.mesa_id).run();
    }
    return c.json({ ok: true, id: num(row.id), status: 'cancelado', etapa: 'cancelado' });
  }
  if (acao === 'saiu_entrega' && row.tipo_entrega !== 'entrega') return c.json({ error: 'Este pedido é de retirada' }, 400);
  if (num(row.entrega_plataforma) === 1 && ['saiu_entrega', 'entregue'].includes(acao)) {
    if (!row.entrega_externa_id) return c.json({ error: 'A corrida ainda não foi anunciada aos motoboys.' }, 409);
    const corrida = await chamarEntregas(env, `/api/integration/stores/${row.estabelecimento_id}/orders/${row.entrega_externa_id}`);
    if (acao === 'saiu_entrega' && !['in_transit', 'delivered'].includes(corrida.status)) return c.json({ error: 'Confirme a retirada com o código de seis dígitos antes de marcar a saída.' }, 409);
    if (acao === 'entregue' && corrida.status !== 'delivered') return c.json({ error: 'A entrega precisa ser confirmada pelo motoboy com os últimos quatro dígitos do CPF.' }, 409);
  }
  if (acao === 'pronto_retirada' && row.tipo_entrega !== 'retirada') return c.json({ error: 'Este pedido é de entrega' }, 400);
  if (etapa === 'recebido') return c.json({ error: 'Confirme o pedido antes de avançar' }, 409);
  if (acao === 'saiu_entrega') {
    if (etapa !== 'preparando') return c.json({ error: 'O pedido ainda não está pronto para sair' }, 409);
    await env.DB.prepare("UPDATE pedidos_online SET etapa='saiu_entrega', atualizado_em=? WHERE id=?").bind(timestamp, row.id).run();
    return c.json({ ok: true, id: num(row.id), status: 'confirmado', etapa: 'saiu_entrega' });
  }
  if (acao === 'pronto_retirada') {
    if (etapa !== 'preparando') return c.json({ error: 'O pedido ainda não está pronto para retirada' }, 409);
    await env.DB.prepare("UPDATE pedidos_online SET etapa='pronto_retirada', atualizado_em=? WHERE id=?").bind(timestamp, row.id).run();
    return c.json({ ok: true, id: num(row.id), status: 'confirmado', etapa: 'pronto_retirada' });
  }
  if (etapa !== 'saiu_entrega' && etapa !== 'pronto_retirada') {
    return c.json({ error: 'Marque a saída ou a retirada antes de concluir' }, 409);
  }
  await env.DB.prepare("UPDATE pedidos_online SET etapa='entregue', atualizado_em=? WHERE id=?").bind(timestamp, row.id).run();
  return c.json({ ok: true, id: num(row.id), status: row.status, etapa: 'entregue' });
}

async function despacharEntregaPix(env, id) {
  const row = await env.DB.prepare('SELECT * FROM pedidos_online WHERE id=?').bind(id).first();
  if (!row || num(row.entrega_plataforma) !== 1) throw httpError(404, 'Pedido com motoboy não encontrado.');
  if (row.status === 'cancelado' || row.etapa === 'aguardando_pix' || !row.comanda_id) throw httpError(409, 'Confirme o recebimento do Pix antes de chamar o motoboy.');
  if (row.entrega_externa_id) return { id: row.entrega_externa_id, status: row.entrega_despacho_status };
  const store = await env.DB.prepare('SELECT l.*,e.nome AS empresa_nome FROM lojas_online l JOIN estabelecimentos e ON e.id=l.estabelecimento_id WHERE l.estabelecimento_id=?').bind(row.estabelecimento_id).first();
  if (!store || !integracaoEntregasConfigurada(store, env)) throw httpError(503, 'Integração dos motoboys indisponível nesta loja.');
  const code = await decifrarCodigoEntrega(row.entrega_codigo_cifrado, `${row.estabelecimento_id}:${row.chave}`, env.ENTREGAS_INTEGRATION_SECRET);
  const delivery = await chamarEntregas(env, '/api/integration/orders', { method: 'POST', body: {
    establishmentId: num(row.estabelecimento_id), reference: `PEDIDO-ONLINE-${row.id}`,
    paymentReference: `pix-manual:${row.estabelecimento_id}:${row.id}`, paymentMode: 'pix_confirmed_manually',
    customerName: row.cliente_nome, customerPhone: row.telefone, customerCpfLast4: code,
    destinationAddress: row.endereco, destinationLat: Number(row.entrega_destino_lat), destinationLng: Number(row.entrega_destino_lng),
    distanceKm: Number(row.entrega_distancia_precisa), subsidy: row.entrega_subsidio, ready: false,
    quotedTotalCents: Number(row.entrega_frete_centavos), quotedCustomerCents: Math.round(Number(row.taxa_entrega) * 100),
    quotedMerchantCents: Number(row.entrega_frete_centavos) - Math.round(Number(row.taxa_entrega) * 100),
  } });
  await env.DB.prepare("UPDATE pedidos_online SET entrega_despacho_status='anunciada',entrega_externa_id=?,atualizado_em=? WHERE id=? AND entrega_plataforma=1")
    .bind(delivery.id, now(), row.id).run();
  return { id: delivery.id, status: delivery.status };
}

export async function chamarEntregadorOnlineHandler(c, env) {
  const id = Number(c.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return c.json({ error: 'Pedido inválido' }, 400);
  return c.json(await despacharEntregaPix(env, id));
}

export async function listOnlineOrdersHandler(c, env) {
  const status = String(c.req.query('status') || '').trim();
  const rows = await env.DB.prepare(
    `SELECT po.*, m.nome AS mesa_nome, m.numero AS mesa_numero, c.status AS comanda_status,
      (SELECT COUNT(*) FROM pedidos_online_itens pi WHERE pi.pedido_online_id=po.id) AS itens_count
     FROM pedidos_online po LEFT JOIN mesas m ON m.id=po.mesa_id LEFT JOIN comandas c ON c.id=po.comanda_id
     ${status ? 'WHERE po.status=?' : ''} ORDER BY po.id DESC LIMIT 200`
  ).bind(...(status ? [status] : [])).all();
  return c.json(rows.results);
}

// ============================ SITE PÚBLICO ============================

async function lojaPorSlug(env, slug, exigirAtiva) {
  const normalized = String(slug || '').trim().toLocaleLowerCase();
  if (!SITE_SLUG.test(normalized)) throw httpError(404, 'Loja não encontrada');
  const store = await env.DB.prepare(
    `SELECT l.*, e.nome AS empresa_nome FROM lojas_online l JOIN estabelecimentos e ON e.id=l.estabelecimento_id
     WHERE (l.slug=? OR EXISTS (SELECT 1 FROM lojas_online_links links WHERE links.estabelecimento_id=l.estabelecimento_id AND links.slug=?))
       AND e.ativo=1${exigirAtiva ? ' AND l.ativo=1' : ''}`
  ).bind(normalized, normalized).first();
  if (!store) throw httpError(404, exigirAtiva ? 'Loja não encontrada ou indisponível' : 'Loja não encontrada');
  return store;
}

async function publicStore(env, slug) {
  return lojaPorSlug(env, slug, true);
}

function agruparCategorias(rows) {
  const grupos = new Map();
  for (const row of rows) {
    const atual = grupos.get(row.nome_busca);
    if (!atual) {
      grupos.set(row.nome_busca, { nome: row.nome, busca: row.nome_busca, lojas: 1 });
      continue;
    }
    atual.lojas += 1;
    const novo = String(row.nome);
    const temAcento = (nome) => /[^\u0000-\u007f]/.test(nome);
    if ((temAcento(novo) && !temAcento(atual.nome)) || novo.length > atual.nome.length) atual.nome = novo;
  }
  return [...grupos.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

function pontoDaConsulta(c) {
  const lat = c.req.query('lat');
  const lng = c.req.query('lng');
  if (lat == null || lat === '' || lng == null || lng === '') return null;
  const ponto = { latitude: Number(lat), longitude: Number(lng) };
  return coordenadaValida(ponto.latitude, ponto.longitude) ? ponto : null;
}

export async function localizarHandler(c, env) {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'anon';
  const chave = `geo-limite:${ip}`;
  const usos = num(await kvGet(env, chave));
  if (usos >= 30) return c.json({ error: 'Muitas consultas de endereço. Aguarde alguns minutos.' }, 429);
  await kvPut(env, chave, String(usos + 1), { expirationTtl: 600 });
  const q = String(c.req.query('q') || '').trim();
  const ponto = await localizar(env, { q, lat: c.req.query('lat'), lng: c.req.query('lng') });
  if (!ponto) return c.json({ error: 'Não foi possível localizar este lugar. Inclua rua, número e cidade.' }, 404);
  return c.json(ponto);
}

export async function distanciaLojaHandler(c, env) {
  const store = await publicStore(env, c.params.slug);
  const q = String(c.req.query('q') || '').trim();
  const ponto = q ? await localizar(env, { q }) : pontoDaConsulta(c);
  if (!ponto) return c.json({ error: 'Não foi possível localizar este endereço. Inclua rua, número e cidade.' }, 400);
  const area = areaDaLoja(store, ponto);
  if (c.req.query('plataforma') === '1') {
    if (!plataformaDisponivel(store, env)) return c.json({ error: 'Motoboy da plataforma indisponível nesta loja.' }, 409);
    if (area.entrega_na_regiao === 0 || area.distancia_km == null) return c.json({ error: 'Endereço fora da área da loja ou sem distância calculada.' }, 400);
    const distance = distanciaKm({ latitude: Number(store.latitude), longitude: Number(store.longitude) }, ponto);
    const quote = await chamarEntregas(env, `/api/integration/stores/${store.estabelecimento_id}/quote`, { method: 'POST', body: { distanceKm: distance, subsidy: 'base' } });
    return c.json({ ...area, endereco: ponto.endereco || q, latitude: ponto.latitude, longitude: ponto.longitude, plataforma: quote });
  }
  return c.json({ ...area, endereco: ponto.endereco || q });
}

export async function listPublicStoresHandler(c, env) {
  const categoria = buscaCategoria(c.req.query('categoria'));
  const termo = buscaCategoria(c.req.query('q'));
  const ponto = pontoDaConsulta(c);
  const soRegiao = Boolean(ponto) && c.req.query('regiao') !== '0';
  const lojas = await env.DB.prepare(
    `SELECT l.estabelecimento_id, l.slug, l.nome, l.descricao, l.logo_url, l.capa_url, l.cor_capa,
       l.taxa_entrega, l.tempo_min_entrega, l.tempo_max_entrega, l.aceita_entrega, l.aceita_retirada,
       l.latitude, l.longitude, l.raio_entrega_km, l.valor_por_km, l.modo_entrega, l.whatsapp_suporte,
       l.ativo,l.horario_automatico,l.horario_abertura,l.horario_fechamento,l.horario_dias,l.horario_fuso
     FROM lojas_online l JOIN estabelecimentos e ON e.id=l.estabelecimento_id
     WHERE l.ativo=1 AND e.ativo=1 AND l.aceita_pedidos_online=1 AND COALESCE(l.modo_publicacao, 'marketplace')='marketplace'
     ORDER BY l.nome COLLATE NOCASE, l.estabelecimento_id
     LIMIT 200`
  ).all();
  lojas.results = lojas.results.filter((row) => funcionamentoLoja(row).aberta_agora === 1);
  const ids = lojas.results.map((row) => num(row.estabelecimento_id));
  const categorias = ids.length
    ? (await env.DB.prepare(
      `SELECT estabelecimento_id, nome, nome_busca FROM lojas_categorias
       WHERE estabelecimento_id IN (${ids.map(() => '?').join(',')})
       ORDER BY nome COLLATE NOCASE, id`
    ).bind(...ids).all()).results
    : [];
  const promocoes = ids.length
    ? (await env.DB.prepare(
      `SELECT DISTINCT cp.estabelecimento_id FROM cardapio_online_produtos cp
       JOIN produtos p ON p.id=cp.produto_id AND p.estabelecimento_id=cp.estabelecimento_id
       WHERE cp.estabelecimento_id IN (${ids.map(() => '?').join(',')})
         AND cp.ativo=1 AND cp.disponivel=1 AND p.ativo=1 AND p.tipo IN ('produto','composto')
         AND cp.preco_promocional IS NOT NULL AND cp.preco_promocional < COALESCE(cp.preco,p.preco)`
    ).bind(...ids).all()).results
    : [];
  const lojasEmPromocao = new Set(promocoes.map((row) => num(row.estabelecimento_id)));
  const porLoja = new Map();
  for (const row of categorias) {
    const id = num(row.estabelecimento_id);
    if (!porLoja.has(id)) porLoja.set(id, []);
    porLoja.get(id).push(row);
  }
  let lista = lojas.results.map((row) => {
    const daLoja = [...(porLoja.get(num(row.estabelecimento_id)) || [])];
    if (lojasEmPromocao.has(num(row.estabelecimento_id)) && !daLoja.some((item) => categoriaPrincipalDelivery(item.nome_busca) === 'promocao')) {
      daLoja.push({ nome: 'Promoção', nome_busca: 'promocao' });
    }
    return {
      slug: row.slug,
      nome: row.nome || '',
      descricao: row.descricao || '',
      logo_url: row.logo_url || null,
      capa_url: row.capa_url || null,
      cor_capa: corPublica(row.cor_capa),
      whatsapp_suporte: row.whatsapp_suporte || null,
      taxa_entrega: num(row.taxa_entrega),
      tempo_min_entrega: row.tempo_min_entrega == null ? null : num(row.tempo_min_entrega),
      tempo_max_entrega: row.tempo_max_entrega == null ? null : num(row.tempo_max_entrega),
      aceita_entrega: num(row.aceita_entrega),
      aceita_retirada: num(row.aceita_retirada),
      ...areaDaLoja(row, ponto),
      segmentos: daLoja.map((item) => item.nome),
      buscas: daLoja.map((item) => item.nome_busca),
    };
  });
  if (soRegiao) lista = lista.filter((loja) => loja.entrega_na_regiao === 1);
  const naRegiao = lista;
  if (categoria) lista = lista.filter((loja) => loja.buscas.some((busca) => categoriaPrincipalDelivery(busca) === categoriaPrincipalDelivery(categoria)));
  if (termo) {
    lista = lista.filter((loja) => buscaCategoria(`${loja.nome} ${loja.descricao} ${loja.segmentos.join(' ')}`).includes(termo));
  }
  if (ponto) {
    lista.sort((a, b) => (a.distancia_km ?? 9999) - (b.distancia_km ?? 9999) || a.nome.localeCompare(b.nome, 'pt-BR'));
  }
  const categoriasVisiveis = naRegiao.flatMap((loja) => loja.buscas.map((busca, index) => ({ nome: loja.segmentos[index], nome_busca: busca })));
  return c.json({
    categorias: agruparCategorias(categoriasVisiveis),
    lojas: lista.map(({ buscas, ...loja }) => loja),
  });
}

export async function getPublicOrderHandler(c, env) {
  const store = await lojaPorSlug(env, c.params.slug, false);
  const key = String(c.params.chave || '').trim();
  if (!ORDER_KEY.test(key)) return c.json({ error: 'Pedido não encontrado' }, 404);
  const row = await env.DB.prepare(
    `SELECT po.id, po.status, po.etapa, po.tipo_entrega, po.forma_pagamento, po.troco_para, po.pix_copia_cola, po.total, po.checkout_url, po.checkout_capture_method, po.taxa_entrega, po.valor_entrega, po.distancia_km, po.modo_entrega, po.entrega_plataforma, po.entrega_externa_id, po.entrega_despacho_status, po.criado_em, po.atualizado_em, c.status AS comanda_status
     FROM pedidos_online po LEFT JOIN comandas c ON c.id=po.comanda_id AND c.estabelecimento_id=po.estabelecimento_id
     WHERE po.estabelecimento_id=? AND po.chave=?`
  ).bind(store.estabelecimento_id, key).first();
  if (!row) return c.json({ error: 'Pedido não encontrado' }, 404);
  let deliveryStatus = null;
  if (num(row.entrega_plataforma) === 1 && row.entrega_externa_id && row.status !== 'cancelado') {
    const cacheKey = `entrega-status:${store.estabelecimento_id}:${row.entrega_externa_id}`;
    deliveryStatus = await kvGet(env, cacheKey);
    if (!deliveryStatus) {
      try {
        const delivery = await chamarEntregas(env, `/api/integration/stores/${store.estabelecimento_id}/orders/${row.entrega_externa_id}`);
        deliveryStatus = delivery.status;
        await kvPut(env, cacheKey, deliveryStatus, { expirationTtl: 60 });
      } catch { /* O pedido continua visível mesmo se o serviço de motoboys falhar. */ }
    }
  }
  const etapaAtual = deliveryStatus === 'delivered' ? 'entregue'
    : deliveryStatus === 'in_transit' ? 'saiu_entrega' : etapaCliente(row);
  if (etapaAtual !== row.etapa && ['entregue', 'saiu_entrega'].includes(etapaAtual)) {
    await env.DB.prepare('UPDATE pedidos_online SET etapa=?,atualizado_em=? WHERE id=? AND estabelecimento_id=? AND status!=\'cancelado\' AND etapa!=\'entregue\'')
      .bind(etapaAtual, now(), row.id, store.estabelecimento_id).run();
  }
  const itens = await env.DB.prepare(
    'SELECT nome, quantidade, observacao FROM pedidos_online_itens WHERE estabelecimento_id=? AND pedido_online_id=? ORDER BY ordem, id'
  ).bind(store.estabelecimento_id, row.id).all();
  return c.json({
    id: num(row.id),
    etapa: etapaAtual,
    entrega_plataforma: num(row.entrega_plataforma),
    entrega_status: deliveryStatus || row.entrega_despacho_status || null,
    tipo_entrega: row.tipo_entrega,
    forma_pagamento: row.forma_pagamento,
    troco_para: row.troco_para == null || row.troco_para === '' ? null : num(row.troco_para),
    pix_copia_cola: row.forma_pagamento === 'pix' ? (row.pix_copia_cola || null) : null,
    checkout_url: null,
    checkout_capture_method: row.checkout_capture_method || null,
    total: num(row.total),
    taxa_entrega: num(row.taxa_entrega),
    valor_entrega: row.valor_entrega == null || row.valor_entrega === '' ? null : num(row.valor_entrega),
    distancia_km: row.distancia_km == null || row.distancia_km === '' ? null : num(row.distancia_km),
    modo_entrega: row.modo_entrega || null,
    entrega_gratis: row.modo_entrega === 'gratis' ? 1 : 0,
    criado_em: row.criado_em,
    atualizado_em: row.atualizado_em || row.criado_em,
    loja: store.nome || store.empresa_nome,
    whatsapp_suporte: store.whatsapp_suporte || null,
    itens: itens.results.map((item) => ({ nome: item.nome, quantidade: num(item.quantidade) })),
  });
}

export async function confirmarCheckoutPublicoHandler(c, env) {
  const store = await lojaPorSlug(env, c.params.slug, false);
  const key = String(c.params.chave || '').trim();
  if (!ORDER_KEY.test(key)) return c.json({ error: 'Pedido não encontrado' }, 404);
  const row = await env.DB.prepare('SELECT * FROM pedidos_online WHERE estabelecimento_id=? AND chave=?')
    .bind(store.estabelecimento_id, key).first();
  if (!row) return c.json({ error: 'Pedido não encontrado' }, 404);
  try {
    await confirmarCobrancaCheckoutEfi(env, row);
    return c.json({ ok: true });
  } catch (error) {
    return c.json({ error: error?.message || 'Não foi possível confirmar o pagamento.' }, error?.status || 400);
  }
}

export async function webhookCheckoutEfiHandler(c, env) {
  const raw = await c.req.text();
  let token = '';
  try { token = String(JSON.parse(raw)?.notification || ''); } catch { token = String(new URLSearchParams(raw).get('notification') || ''); }
  try {
    const notifications = await consultarNotificacaoEfi(env, token);
    const paid = notifications.find((item) => item?.status?.current === 'paid' && ORDER_KEY.test(String(item?.custom_id || '')));
    if (!paid) return c.json({ ok: true });
    const row = await env.DB.prepare('SELECT * FROM pedidos_online WHERE chave=? AND forma_pagamento=\'efi_checkout\'').bind(String(paid.custom_id)).first();
    if (!row) return c.json({ error: 'Pedido Efí ainda não registrado.' }, 503);
    if (String(paid.identifiers?.charge_id || '') !== String(row.checkout_charge_id || '')) return c.json({ error: 'Cobrança não corresponde ao pedido.' }, 400);
    await confirmarCobrancaCheckoutEfi(env, row);
    return c.json({ ok: true });
  } catch (error) {
    return c.json({ error: error?.message || 'Notificação Efí ainda não processada.' }, error?.status || 503);
  }
}

export async function getPublicStoreHandler(c, env) {
  const store = await publicStore(env, c.params.slug);
  const rows = await env.DB.prepare(
    `SELECT cp.*, p.nome AS produto_nome, p.preco AS produto_preco, p.observacoes AS produto_observacoes, p.tipo AS produto_tipo, p.combo_grupos_json,
       cc.nome AS cardapio_categoria_nome, cc.id AS cardapio_categoria_ok,
       cat.nome AS categoria_estoque_nome
     FROM cardapio_online_produtos cp JOIN produtos p ON p.id=cp.produto_id
     LEFT JOIN cardapio_online_categorias cc ON cc.id=cp.cardapio_categoria_id AND cc.estabelecimento_id=cp.estabelecimento_id AND cc.ativo=1
     LEFT JOIN categorias cat ON cat.id=cp.categoria_id AND cat.estabelecimento_id=cp.estabelecimento_id
     WHERE cp.estabelecimento_id=? AND cp.ativo=1 AND p.ativo=1
       AND p.tipo IN ('produto','composto','combo')
     ORDER BY CASE WHEN cc.id IS NULL THEN 1 ELSE 0 END, cc.ordem, cc.id, cp.ordem, cp.id`
  ).bind(store.estabelecimento_id).all();
  const ids = rows.results.map((row) => num(row.id));
  const options = new Map();
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const result = await env.DB.prepare(
      `SELECT * FROM cardapio_online_opcoes WHERE estabelecimento_id=? AND cardapio_produto_id IN (${placeholders}) AND ativo=1
       AND (insumo_id IS NULL OR EXISTS (SELECT 1 FROM produtos p WHERE p.id=cardapio_online_opcoes.insumo_id
         AND p.estabelecimento_id=cardapio_online_opcoes.estabelecimento_id AND p.ativo=1
         AND p.tipo IN ('produto','insumo','composto'))) ORDER BY ordem,id`
    ).bind(store.estabelecimento_id, ...ids).all();
    for (const option of result.results) {
      const id = num(option.cardapio_produto_id);
      if (!options.has(id)) options.set(id, []);
      options.get(id).push({ id: num(option.id), nome: option.nome, tipo: option.tipo, preco_adicional: num(option.preco_adicional) });
    }
  }
  const vendas = await vendidosDaLoja(env, store.estabelecimento_id);
  const products = await enriquecerCombos(env, rows.results.map((row) => comVendidos(productView(row, options.get(num(row.id)) || []), vendas)));
  const categories = [];
  const categoriasVistas = new Set();
  for (const product of products) {
    const chave = product.cardapio_categoria_id
      ? `cardapio:${product.cardapio_categoria_id}`
      : (product.categoria_id ? `estoque:${product.categoria_id}` : '');
    if (!chave || categoriasVistas.has(chave)) continue;
    categoriasVistas.add(chave);
    categories.push({ id: product.cardapio_categoria_id || product.categoria_id, nome: product.categoria_nome || 'Outros' });
  }
  const segmentos = await env.DB.prepare(
    'SELECT nome FROM lojas_categorias WHERE estabelecimento_id=? ORDER BY nome COLLATE NOCASE, id'
  ).bind(store.estabelecimento_id).all();
  return c.json({
    loja: {
      slug: store.slug, nome: store.nome || store.empresa_nome, descricao: store.descricao || '', logo_url: store.logo_url || null, capa_url: store.capa_url || null, cor_capa: corPublica(store.cor_capa),
      taxa_entrega: num(store.taxa_entrega), tempo_min_entrega: store.tempo_min_entrega, tempo_max_entrega: store.tempo_max_entrega,
      aceita_entrega: num(store.aceita_entrega), aceita_retirada: num(store.aceita_retirada),
      aceita_pedidos_online: num(store.aceita_pedidos_online), ativo: num(store.ativo), modo_publicacao: store.modo_publicacao,
      ...funcionamentoLoja(store),
      horario_automatico: store.horario_automatico, horario_abertura: store.horario_abertura,
      horario_fechamento: store.horario_fechamento, horario_dias: diasDaLoja(store), horario_fuso: store.horario_fuso,
      pix_disponivel: store.pix_chave ? 1 : 0,
      checkout_efi_disponivel: 0,
      entrega_plataforma_disponivel: plataformaDisponivel(store, env) ? 1 : 0,
      whatsapp_suporte: store.whatsapp_suporte || null,
      ...areaDaLoja(store, pontoDaConsulta(c)),
      segmentos: segmentos.results.map((row) => row.nome),
    },
    categorias: categories, produtos: products,
  });
}

function orderNote(note, selected) {
  const removable = selected.filter((option) => option.tipo === 'removivel').map((option) => option.nome);
  const additions = selected.filter((option) => option.tipo === 'adicional').map((option) => option.nome);
  const parts = [];
  if (removable.length) parts.push(`Sem: ${removable.join(', ')}`);
  if (additions.length) parts.push(`Adicionar: ${additions.join(', ')}`);
  if (note) parts.push(note);
  return parts.join(' · ');
}

export async function createPublicOrderHandler(c, env) {
  const store = await publicStore(env, c.params.slug);
  if (store.aceita_pedidos_online === 0) {
    return c.json({ error: 'Este estabelecimento disponibiliza apenas o cardápio online e não recebe pedidos pelo site.' }, 403);
  }
  const body = await c.req.json();
  let payment;
  try {
    payment = pagamentoDoPedido(body?.forma_pagamento);
  } catch (error) {
    return c.json({ error: error?.message || 'Escolha Pix, dinheiro ou maquininha.' }, error?.status || 400);
  }
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'anon';
  const rateKey = `online-order:${store.estabelecimento_id}:${ip}`;
  const attempts = num(await kvGet(env, rateKey));
  if (attempts >= 8) return c.json({ error: 'Muitos pedidos em sequência. Aguarde alguns minutos.' }, 429);

  const key = String(body?.chave || '').trim();
  if (!ORDER_KEY.test(key)) return c.json({ error: 'Identificador do pedido inválido' }, 400);
  let existing = await env.DB.prepare('SELECT * FROM pedidos_online WHERE estabelecimento_id=? AND chave=?').bind(store.estabelecimento_id, key).first();
  if (existing) {
    existing = (await aceitarPedido(env, existing)).row;
    return c.json({
      id: existing.id, comanda_id: existing.comanda_id, status: existing.status, total: num(existing.total),
      forma_pagamento: existing.forma_pagamento,
      pix_copia_cola: existing.forma_pagamento === 'pix' ? (existing.pix_copia_cola || null) : null,
      checkout_url: null,
      repetido: true,
    });
  }

  const funcionamento = funcionamentoLoja(store);
  if (!funcionamento.aberta_agora) return c.json({ error: funcionamento.motivo_fechado }, 409);

  const customer = cleanText(body?.cliente_nome, 120, 'Nome', true);
  const phone = String(body?.telefone || '').replace(/\D/g, '');
  if (phone.length < 10 || phone.length > 13) return c.json({ error: 'Informe um WhatsApp válido' }, 400);
  const delivery = body?.tipo_entrega === 'retirada' ? 'retirada' : body?.tipo_entrega === 'entrega' ? 'entrega' : '';
  const platformDelivery = body?.entrega_plataforma === true;
  if (!delivery || (delivery === 'entrega' && !num(store.aceita_entrega)) || (delivery === 'retirada' && !num(store.aceita_retirada))) return c.json({ error: 'Esta forma de recebimento não está disponível' }, 400);
  if (platformDelivery && (delivery !== 'entrega' || !plataformaDisponivel(store, env))) return c.json({ error: 'Motoboy da plataforma indisponível nesta loja.' }, 409);
  const address = cleanText(body?.endereco, 350, 'Endereço', delivery === 'entrega');
  if (delivery === 'entrega' && store.valor_por_km != null && (store.latitude == null || store.longitude == null)) {
    return c.json({ error: 'Configure o endereço da loja para calcular a entrega por km.' }, 400);
  }
  let distanciaBruta = null;
  let destinationPoint = null;
  const calculaDistancia = delivery === 'entrega' && store.latitude != null && store.longitude != null && (platformDelivery || store.raio_entrega_km != null || store.valor_por_km != null);
  if (calculaDistancia) {
    const ponto = await localizar(env, { q: address });
    if (!ponto) return c.json({ error: 'Não foi possível localizar este endereço. Inclua rua, número e cidade.' }, 400);
    destinationPoint = ponto;
    distanciaBruta = distanciaKm({ latitude: Number(store.latitude), longitude: Number(store.longitude) }, ponto);
    if (store.raio_entrega_km != null && !dentroDoRaio(distanciaBruta, Number(store.raio_entrega_km))) {
      return c.json({ error: `Esta loja entrega até ${kmExibido(store.raio_entrega_km)} km. Este endereço fica a ${kmExibido(distanciaBruta)} km.` }, 400);
    }
  }
  const cobranca = delivery === 'entrega'
    ? cobrancaEntrega({ distanciaKm: distanciaBruta, valorPorKm: store.valor_por_km, modo: store.modo_entrega, taxaFixa: store.taxa_entrega })
    : { taxa_cliente: 0, valor_entrega: 0, taxa_estabelecimento: 0, distancia_km: null, modo_entrega: null, entrega_gratis: 0 };
  if (delivery === 'entrega' && store.valor_por_km != null && cobranca.taxa_cliente == null) {
    return c.json({ error: 'Não foi possível calcular a entrega. Confira o endereço da loja e informe rua, número e cidade.' }, 400);
  }
  if (platformDelivery && payment !== 'pix') return c.json({ error: 'A entrega pela plataforma aceita Pix direto à loja, com confirmação manual do recebimento.' }, 400);
  let platformQuote = null;
  let encryptedCode = null;
  if (platformDelivery) {
    const code = String(body?.cpf_ultimos4 || '');
    if (!/^\d{4}$/.test(code)) return c.json({ error: 'Informe os últimos quatro números do CPF para confirmar a entrega.' }, 400);
    platformQuote = await chamarEntregas(env, `/api/integration/stores/${store.estabelecimento_id}/quote`, { method: 'POST', body: { distanceKm: distanciaBruta, subsidy: 'base' } });
    if (body?.frete_cliente_esperado_centavos !== platformQuote.customerCents) return c.json({ error: 'O valor da entrega mudou. Confira o total e tente novamente.' }, 409);
    encryptedCode = await cifrarCodigoEntrega(code, `${store.estabelecimento_id}:${key}`, env.ENTREGAS_INTEGRATION_SECRET);
  }
  const change = payment === 'dinheiro' && body?.troco_para != null && String(body.troco_para).trim() !== ''
    ? optionalNumber(body.troco_para, 'Valor em dinheiro', { min: 0, max: 100000 })
    : null;
  const orderObservation = cleanText(body?.observacao, 500, 'Observação');
  if (!Array.isArray(body?.itens) || !body.itens.length || body.itens.length > MAX_ITEMS) return c.json({ error: `Envie de 1 a ${MAX_ITEMS} itens` }, 400);

  const parsedItems = body.itens.map((item) => ({
    cardapio_produto_id: Number(item?.cardapio_produto_id), quantidade: Number(item?.quantidade || 1),
    opcoes_ids: Array.isArray(item?.opcoes_ids) ? item.opcoes_ids.map(Number) : [], observacao: cleanText(item?.observacao, 400, 'Observação do item'),
    preco_unitario_esperado: item?.preco_unitario_esperado == null ? null : Number(item.preco_unitario_esperado),
    combo_escolhas: item?.combo_escolhas,
  }));
  for (const item of parsedItems) {
    if (!Number.isInteger(item.cardapio_produto_id) || item.cardapio_produto_id <= 0 || !Number.isInteger(item.quantidade) || item.quantidade < 1 || item.quantidade > 30 || item.opcoes_ids.length > 25 || item.opcoes_ids.some((id) => !Number.isInteger(id) || id <= 0) || (item.preco_unitario_esperado != null && (!Number.isFinite(item.preco_unitario_esperado) || item.preco_unitario_esperado < 0))) return c.json({ error: 'Itens do pedido inválidos' }, 400);
  }
  const catalogIds = [...new Set(parsedItems.map((item) => item.cardapio_produto_id))];
  const placeholders = catalogIds.map(() => '?').join(',');
  const catalog = await env.DB.prepare(
    `SELECT cp.*,p.nome AS produto_nome,p.preco AS produto_preco,p.tipo AS produto_tipo,p.combo_grupos_json FROM cardapio_online_produtos cp JOIN produtos p ON p.id=cp.produto_id
     WHERE cp.estabelecimento_id=? AND cp.id IN (${placeholders}) AND cp.ativo=1 AND cp.disponivel=1 AND p.ativo=1
       AND p.tipo IN ('produto','composto','combo')`
  ).bind(store.estabelecimento_id, ...catalogIds).all();
  if (catalog.results.length !== catalogIds.length) return c.json({ error: 'Um dos itens não está mais disponível' }, 409);
  const catalogById = new Map(catalog.results.map((row) => [num(row.id), row]));
  const optionIds = [...new Set(parsedItems.flatMap((item) => item.opcoes_ids))];
  const optionsById = new Map();
  if (optionIds.length) {
    const optPlaceholders = optionIds.map(() => '?').join(',');
    const options = await env.DB.prepare(
      `SELECT * FROM cardapio_online_opcoes WHERE estabelecimento_id=? AND id IN (${optPlaceholders}) AND ativo=1
       AND (insumo_id IS NULL OR EXISTS (SELECT 1 FROM produtos p WHERE p.id=cardapio_online_opcoes.insumo_id
         AND p.estabelecimento_id=cardapio_online_opcoes.estabelecimento_id AND p.ativo=1
         AND p.tipo IN ('produto','insumo','composto')))`
    ).bind(store.estabelecimento_id, ...optionIds).all();
    if (options.results.length !== optionIds.length) return c.json({ error: 'Uma opção escolhida não está mais disponível' }, 409);
    for (const option of options.results) optionsById.set(num(option.id), option);
  }
  const items = await Promise.all(parsedItems.map(async (item) => {
    const catalogProduct = catalogById.get(item.cardapio_produto_id);
    if (catalogProduct.preco == null && catalogProduct.produto_preco == null) throw httpError(409, 'Produto sem preço de venda. Atualize o cardápio.');
    const options = item.opcoes_ids.map((id) => optionsById.get(id));
    if (options.some((option) => !option || num(option.cardapio_produto_id) !== num(catalogProduct.id))) throw httpError(400, 'Uma opção não pertence a este produto');
    const precoNormal = catalogProduct.preco == null ? num(catalogProduct.produto_preco) : num(catalogProduct.preco);
    const promocional = catalogProduct.preco_promocional == null ? null : num(catalogProduct.preco_promocional);
    const precoDelivery = promocional != null && promocional < precoNormal ? promocional : precoNormal;
    const combo = catalogProduct.produto_tipo === 'combo' ? await montarCombo(env, { tipo: 'combo', combo_grupos_json: catalogProduct.combo_grupos_json }, item.combo_escolhas) : null;
    if (!combo && item.combo_escolhas != null) throw httpError(400, 'Este produto não é um combo');
    const unitPrice = Math.round((precoDelivery + (combo?.adicional || 0) + options.filter((option) => option.tipo === 'adicional').reduce((sum, option) => sum + num(option.preco_adicional), 0)) * 100) / 100;
    if (item.preco_unitario_esperado != null && Math.round(item.preco_unitario_esperado * 100) !== Math.round(unitPrice * 100)) {
      throw httpError(409, 'O preço de um produto mudou. Atualize o cardápio e tente novamente.');
    }
    return {
      cardapio_produto_id: num(catalogProduct.id), produto_id: num(catalogProduct.produto_id), nome: catalogProduct.nome_exibicao || catalogProduct.produto_nome,
      quantidade: item.quantidade, preco_unitario: unitPrice, observacao: [combo?.descricao, orderNote(item.observacao, options)].filter(Boolean).join(' · '),
      acrescimos_json: JSON.stringify(options.filter((option) => option.tipo === 'adicional' && option.insumo_id).map((option) => Number(option.insumo_id))),
      combo_escolhas_json: combo ? JSON.stringify(combo.escolhas) : null,
      opcoes_json: JSON.stringify(options.map((option) => ({ id: num(option.id), nome: option.nome, tipo: option.tipo, preco_adicional: num(option.preco_adicional) }))),
      total: Math.round(unitPrice * item.quantidade * 100) / 100,
    };
  }));
  const subtotal = Math.round(items.reduce((sum, item) => sum + item.total, 0) * 100) / 100;
  const deliveryFee = platformDelivery ? platformQuote.customerCents / 100 : delivery === 'entrega' ? num(cobranca.taxa_cliente) : 0;
  const total = Math.round((subtotal + deliveryFee) * 100) / 100;
  if (payment === 'dinheiro' && change != null && change < total) {
    return c.json({ error: `O valor em dinheiro deve ser igual ou maior que ${total.toFixed(2).replace('.', ',')}.` }, 400);
  }
  if (payment === 'pix') {
    if (!String(store.pix_chave || '').trim()) return c.json({ error: 'Esta loja não recebe Pix.' }, 400);
    try {
      copiaColaPix({ chave: store.pix_chave, nome: store.nome || store.empresa_nome, cidade: store.pix_cidade, valor: total, txid: 'P0' });
    } catch (error) {
      return c.json({ error: error?.message || 'Esta loja não recebe Pix.' }, error?.status || 400);
    }
  }
  // Reconfere depois de localização, frete e montagem dos itens. A loja pode
  // ter fechado enquanto o cliente concluía o checkout.
  const latestStore = await env.DB.prepare('SELECT * FROM lojas_online WHERE estabelecimento_id=?').bind(store.estabelecimento_id).first();
  const latestHours = funcionamentoLoja(latestStore);
  if (!latestHours.aberta_agora || !latestStore.aceita_pedidos_online) return c.json({ error: latestHours.motivo_fechado || 'Esta loja não recebe pedidos neste momento.' }, 409);
  const timestamp = now();
  const data = JSON.stringify(items);
  const virtualNumber = 900000000;
  const segurarPix = payment === 'pix';
  const etapaPendente = 'aguardando_pix';
  const statements = [
    env.DB.prepare(
      `INSERT OR IGNORE INTO pedidos_online (estabelecimento_id,chave,cliente_nome,telefone,tipo_entrega,endereco,forma_pagamento,troco_para,observacao,status,etapa,subtotal,taxa_entrega,total,valor_entrega,distancia_km,modo_entrega,checkout_url,checkout_charge_id,criado_em,atualizado_em)
       SELECT ?,?,?,?,?,?,?,?,?,'recebido',?,?,?,?,?,?,?,?,?,?,?
       WHERE EXISTS (SELECT 1 FROM lojas_online WHERE estabelecimento_id=? AND ativo=1 AND aceita_pedidos_online=1)
         AND ?=(SELECT COUNT(*) FROM cardapio_online_produtos cp JOIN produtos p ON p.id=cp.produto_id AND p.estabelecimento_id=cp.estabelecimento_id
           WHERE cp.estabelecimento_id=? AND cp.id IN (SELECT value FROM json_each(?)) AND cp.ativo=1 AND cp.disponivel=1 AND p.ativo=1)`
    ).bind(store.estabelecimento_id, key, customer, phone, delivery, address || null, payment, change, orderObservation || null, segurarPix ? etapaPendente : 'recebido', subtotal, deliveryFee, total, nulo(cobranca.valor_entrega), nulo(delivery === 'entrega' ? (distanciaBruta == null ? null : kmExibido(distanciaBruta)) : null), nulo(cobranca.modo_entrega), null, null, timestamp, timestamp,
      store.estabelecimento_id, catalogIds.length, store.estabelecimento_id, JSON.stringify(catalogIds)),
  ];
  if (platformDelivery) {
    statements.push(env.DB.prepare(
      `UPDATE pedidos_online SET entrega_plataforma=1,entrega_codigo_cifrado=?,entrega_destino_lat=?,entrega_destino_lng=?,
       entrega_distancia_precisa=?,entrega_subsidio='base',entrega_frete_centavos=?,entrega_despacho_status='aguardando_pix',
       valor_entrega=?,distancia_km=?,modo_entrega=?
       WHERE estabelecimento_id=? AND chave=? AND entrega_plataforma=0`
    ).bind(encryptedCode, destinationPoint.latitude, destinationPoint.longitude, distanciaBruta, platformQuote.totalCents,
      platformQuote.totalCents / 100, kmExibido(distanciaBruta), platformQuote.customerCents === 0 ? 'gratis' : 'dividido', store.estabelecimento_id, key));
  }
  if (!segurarPix) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO mesas (estabelecimento_id,numero,nome,capacidade,setor,status,ativo,aberta_em,criado_em,tipo)
         SELECT ?,?+id,'Pedido online #' || id,1,'Delivery online','ocupada',1,?,?,'online'
         FROM pedidos_online WHERE estabelecimento_id=? AND chave=? AND mesa_id IS NULL`
      ).bind(store.estabelecimento_id, virtualNumber, timestamp, timestamp, store.estabelecimento_id, key),
      env.DB.prepare(
        `INSERT INTO comandas (estabelecimento_id,mesa_id,cliente_nome,garcom_nome,status,taxa_garcom_pct,pessoas_count,criado_em)
         SELECT o.estabelecimento_id,m.id,o.cliente_nome,'Pedido online','aberta',0,1,?
         FROM pedidos_online o JOIN mesas m ON m.estabelecimento_id=o.estabelecimento_id AND m.numero=?+o.id
         WHERE o.estabelecimento_id=? AND o.chave=? AND o.comanda_id IS NULL`
      ).bind(timestamp, virtualNumber, store.estabelecimento_id, key),
      env.DB.prepare(
        `UPDATE pedidos_online SET mesa_id=(SELECT m.id FROM mesas m WHERE m.estabelecimento_id=pedidos_online.estabelecimento_id AND m.numero=?+pedidos_online.id),
         comanda_id=(SELECT c.id FROM comandas c JOIN mesas m ON m.id=c.mesa_id WHERE c.estabelecimento_id=pedidos_online.estabelecimento_id AND m.numero=?+pedidos_online.id),
         atualizado_em=? WHERE estabelecimento_id=? AND chave=? AND comanda_id IS NULL`
      ).bind(virtualNumber, virtualNumber, timestamp, store.estabelecimento_id, key),
    );
  }
  statements.push(env.DB.prepare(
    `INSERT INTO pedidos_online_itens (estabelecimento_id,pedido_online_id,ordem,produto_id,cardapio_produto_id,nome,quantidade,preco_unitario,observacao,opcoes_json,acrescimos_json,combo_escolhas_json,total,criado_em)
     SELECT o.estabelecimento_id,o.id,CAST(j.key AS INTEGER),json_extract(j.value,'$.produto_id'),json_extract(j.value,'$.cardapio_produto_id'),json_extract(j.value,'$.nome'),
     json_extract(j.value,'$.quantidade'),json_extract(j.value,'$.preco_unitario'),NULLIF(json_extract(j.value,'$.observacao'),''),json_extract(j.value,'$.opcoes_json'),json_extract(j.value,'$.acrescimos_json'),json_extract(j.value,'$.combo_escolhas_json'),json_extract(j.value,'$.total'),?
     FROM pedidos_online o,json_each(?) j WHERE o.estabelecimento_id=? AND o.chave=? AND ${segurarPix ? 'o.etapa=?' : 'o.comanda_id IS NOT NULL'}
     AND NOT EXISTS (SELECT 1 FROM pedidos_online_itens pi WHERE pi.pedido_online_id=o.id)`
  ).bind(...(segurarPix ? [timestamp, data, store.estabelecimento_id, key, etapaPendente] : [timestamp, data, store.estabelecimento_id, key])));
  if (!segurarPix) {
    statements.push(env.DB.prepare(
      `INSERT INTO comanda_itens (estabelecimento_id,comanda_id,pessoa_id,produto_id,nome,quantidade,preco_unitario,observacao,acrescimos_json,combo_escolhas_json,status,responsavel,criado_em)
       SELECT o.estabelecimento_id,o.comanda_id,NULL,json_extract(j.value,'$.produto_id'),json_extract(j.value,'$.nome'),json_extract(j.value,'$.quantidade'),
       json_extract(j.value,'$.preco_unitario'),NULLIF(json_extract(j.value,'$.observacao'),''),json_extract(j.value,'$.acrescimos_json'),json_extract(j.value,'$.combo_escolhas_json'),'novo','Pedido online',?
       FROM pedidos_online o,json_each(?) j WHERE o.estabelecimento_id=? AND o.chave=? AND o.comanda_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM comanda_itens ci WHERE ci.comanda_id=o.comanda_id)`
    ).bind(timestamp, data, store.estabelecimento_id, key));
  }
  await env.DB.batch(statements);
  let created = await env.DB.prepare('SELECT * FROM pedidos_online WHERE estabelecimento_id=? AND chave=?').bind(store.estabelecimento_id, key).first();
  if (!created) throw httpError(409, 'Loja ou produto indisponível. Atualize o cardápio e tente novamente.');
  if (!segurarPix && !created.comanda_id) throw httpError(409, 'Não foi possível registrar o pedido. Tente novamente.');
  let pixCopiaCola = null;
  if (payment === 'pix') {
    pixCopiaCola = copiaColaPix({
      chave: store.pix_chave,
      nome: store.nome || store.empresa_nome,
      cidade: store.pix_cidade,
      valor: num(created.total),
      txid: `P${created.id}`,
    });
    await env.DB.prepare('UPDATE pedidos_online SET pix_copia_cola=? WHERE id=? AND estabelecimento_id=?')
      .bind(pixCopiaCola, created.id, store.estabelecimento_id).run();
  }
  created = (await aceitarPedido(env, created)).row;
  await kvPut(env, rateKey, String(attempts + 1), { expirationTtl: 900 });
  return c.json({
    id: created.id, comanda_id: created.comanda_id, status: created.status, total: num(created.total),
    forma_pagamento: payment, pix_copia_cola: pixCopiaCola, checkout_url: null, repetido: false,
  }, 201);
}
