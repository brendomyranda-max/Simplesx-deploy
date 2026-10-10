import assert from 'node:assert/strict';
import test from 'node:test';
import SqliteDb from '../server/sqlite-db.js';
import { TenantDb } from '../shared/tenant-db.js';
import { cobrancaEntrega, dentroDoRaio, distanciaKm, kmExibido } from '../shared/localizacao.js';
import {
  addStoreCategoryHandler,
  createPublicOrderHandler,
  distanciaLojaHandler,
  getPublicOrderHandler,
  getPublicStoreHandler,
  listPublicStoresHandler,
  localizarHandler,
  updateOnlineStoreHandler,
  upsertOnlineCatalogProductHandler,
} from '../shared/handlers-online.js';

function context(body = {}, params = {}, query = {}) {
  return {
    params,
    user: { id: 1 },
    req: { json: async () => body, header: () => '', query: (key) => query[key] ?? '' },
    json: (data, status = 200) => ({ data, status }),
  };
}

const PERTO = { latitude: -23.5505, longitude: -46.6333 };
const CLIENTE = { latitude: -23.555, longitude: -46.639 };
const LONGE = { latitude: -23.7, longitude: -46.8 };

test('o raio da loja limita a região e a lista não expõe o ponto', async (t) => {
  assert.equal(kmExibido(3.54), 3.5);
  assert.equal(dentroDoRaio(3.65, 3.5), true);
  assert.equal(dentroDoRaio(3.66, 3.5), false);

  const raw = new SqliteDb(':memory:');
  t.after(() => raw.close());
  raw.prepare("INSERT INTO estabelecimentos (id,nome,ativo) VALUES (1,'Perto',1),(2,'Longe',1),(3,'Sem area',1)").run();
  const ambientes = [1, 2, 3].map((id) => ({ DB: new TenantDb(raw, id), rawDB: raw, estabelecimentoId: id, geocode: async () => { throw new Error('nao deveria geocodificar'); } }));

  const invalido = await updateOnlineStoreHandler(context({ slug: 'perto', nome: 'Perto da Praça', ativo: true, raio_entrega_km: 0 }), ambientes[0]);
  assert.equal(invalido.status, 400);

  const perto = await updateOnlineStoreHandler(context({
    slug: 'perto', nome: 'Perto da Praça', ativo: true, endereco: 'Rua da Praça, 10, São Paulo',
    latitude: PERTO.latitude, longitude: PERTO.longitude, raio_entrega_km: 3.5,
  }), ambientes[0]);
  assert.equal(perto.status, 200);
  assert.equal(perto.data.raio_entrega_km, 3.5);
  assert.equal(perto.data.latitude, PERTO.latitude);

  const geocodificado = await updateOnlineStoreHandler(context({
    endereco: 'Rua Nova, 20, São Paulo', latitude: null, longitude: null,
  }), {
    ...ambientes[0],
    geocode: async () => ({ latitude: -23.56, longitude: -46.64, endereco: 'Rua Nova, 20, São Paulo' }),
  });
  assert.equal(geocodificado.status, 200);
  assert.equal(geocodificado.data.latitude, -23.56);
  assert.equal(geocodificado.data.raio_entrega_km, 3.5);
  await updateOnlineStoreHandler(context({
    endereco: 'Rua da Praça, 10, São Paulo', latitude: PERTO.latitude, longitude: PERTO.longitude, raio_entrega_km: 3.5,
  }), ambientes[0]);

  await updateOnlineStoreHandler(context({
    slug: 'longe', nome: 'Longe Demais', ativo: true, latitude: LONGE.latitude, longitude: LONGE.longitude, raio_entrega_km: 10,
  }), ambientes[1]);
  await updateOnlineStoreHandler(context({ slug: 'sem-area', nome: 'Sem Área', ativo: true }), ambientes[2]);
  await addStoreCategoryHandler(context({ nome: 'Hambúrgueres' }), ambientes[0]);
  await addStoreCategoryHandler(context({ nome: 'Pizzaria' }), ambientes[1]);

  const publico = { DB: raw };
  const rede = await listPublicStoresHandler(context({}, {}, { lat: String(CLIENTE.latitude), lng: String(CLIENTE.longitude) }), publico);
  assert.equal(rede.status, 200);
  assert.deepEqual(rede.data.lojas.map((loja) => loja.slug), ['perto']);
  assert.equal(rede.data.lojas[0].entrega_na_regiao, 1);
  assert.ok(rede.data.lojas[0].distancia_km > 0);
  assert.ok(rede.data.lojas[0].distancia_km <= 3.5);
  assert.equal(Object.hasOwn(rede.data.lojas[0], 'latitude'), false);
  assert.equal(Object.hasOwn(rede.data.lojas[0], 'longitude'), false);
  assert.equal(Object.hasOwn(rede.data.lojas[0], 'estabelecimento_id'), false);
  assert.equal(Object.hasOwn(rede.data.lojas[0], 'cnpj'), false);
  assert.deepEqual(rede.data.categorias.map((categoria) => categoria.busca), ['hamburgueres']);

  const busca = await listPublicStoresHandler(context({}, {}, { lat: String(CLIENTE.latitude), lng: String(CLIENTE.longitude), q: 'nada' }), publico);
  assert.equal(busca.data.lojas.length, 0);
  assert.equal(busca.data.categorias[0].busca, 'hamburgueres');

  const todas = await listPublicStoresHandler(context({}, {}, { lat: String(CLIENTE.latitude), lng: String(CLIENTE.longitude), regiao: '0' }), publico);
  assert.deepEqual(todas.data.lojas.map((loja) => loja.slug), ['perto', 'longe', 'sem-area']);
  assert.equal(todas.data.lojas.find((loja) => loja.slug === 'longe').entrega_na_regiao, 0);
  assert.equal(todas.data.lojas.find((loja) => loja.slug === 'sem-area').entrega_na_regiao, null);
  assert.equal(todas.data.categorias.some((categoria) => categoria.busca === 'pizzaria'), true);

  const loja = await getPublicStoreHandler(context({}, { slug: 'perto' }, { lat: String(CLIENTE.latitude), lng: String(CLIENTE.longitude) }), publico);
  assert.equal(loja.status, 200);
  assert.equal(Object.hasOwn(loja.data.loja, 'latitude'), false);
  assert.equal(loja.data.loja.raio_entrega_km, 3.5);
  assert.equal(loja.data.loja.entrega_na_regiao, 1);

  const distancia = await distanciaLojaHandler(context({}, { slug: 'perto' }, { q: 'Rua Longe, 500, São Paulo' }), {
    DB: raw,
    geocode: async () => ({ latitude: LONGE.latitude, longitude: LONGE.longitude, endereco: 'Rua Longe, 500' }),
  });
  assert.equal(distancia.status, 200);
  assert.equal(distancia.data.entrega_na_regiao, 0);
  assert.equal(Object.hasOwn(distancia.data, 'latitude'), false);

  const falha = await localizarHandler(context({}, {}, { q: 'rua sem numero cidade' }), { DB: raw, geocode: async () => null });
  assert.equal(falha.status, 404);
});

test('o pedido de entrega respeita o raio configurado pela loja', async (t) => {
  const raw = new SqliteDb(':memory:');
  t.after(() => raw.close());
  raw.prepare("INSERT INTO estabelecimentos (id,nome,ativo) VALUES (1,'Perto',1)").run();
  raw.prepare(`INSERT INTO produtos (id,estabelecimento_id,nome,codigo_interno,preco,ativo,exibir_restaurante,tipo,sem_vencimento,criado_em)
    VALUES (10,1,'Smash','SMASH',29.9,1,1,'produto',1,'2026-10-09T00:00:00.000Z')`).run();
  const admin = { DB: new TenantDb(raw, 1), rawDB: raw, estabelecimentoId: 1 };
  await updateOnlineStoreHandler(context({
    slug: 'perto', nome: 'Perto da Praça', ativo: true, taxa_entrega: 4,
    latitude: PERTO.latitude, longitude: PERTO.longitude, raio_entrega_km: 3.5,
  }), admin);
  const publicado = await upsertOnlineCatalogProductHandler(context({ produto_id: 10, preco: 29.9 }), admin);
  assert.equal(publicado.status, 201);

  const pedido = (tipo, chave, geocode) => createPublicOrderHandler(context({
    chave,
    cliente_nome: 'Ana Souza',
    telefone: '11999990000',
    tipo_entrega: tipo,
    endereco: 'Rua da Praça, 10, São Paulo',
    forma_pagamento: 'dinheiro',
    itens: [{ cardapio_produto_id: publicado.data.id, quantidade: 1 }],
  }, { slug: 'perto' }), { DB: raw, geocode });

  const fora = await pedido('entrega', 'pedido-fora-raio-01', async () => ({ latitude: LONGE.latitude, longitude: LONGE.longitude, endereco: 'Longe' }));
  assert.equal(fora.status, 400);
  assert.match(fora.data.error, /entrega até 3\.5 km/);
  assert.match(fora.data.error, /fica a /);

  const dentro = await pedido('entrega', 'pedido-dentro-raio1', async () => ({ latitude: CLIENTE.latitude, longitude: CLIENTE.longitude, endereco: 'Rua da Praça, 10' }));
  assert.equal(dentro.status, 201);
  const gravado = raw.prepare('SELECT endereco FROM pedidos_online WHERE id=?').bind(dentro.data.id).first();
  assert.match(gravado.endereco, /Rua da Praça/);

  const retirada = await pedido('retirada', 'pedido-retirada-raio', async () => { throw new Error('retirada nao geocodifica'); });
  assert.equal(retirada.status, 201);

  await updateOnlineStoreHandler(context({ raio_entrega_km: null }), admin);
  const semLimite = await pedido('entrega', 'pedido-sem-limite-01', async () => { throw new Error('sem raio nao geocodifica'); });
  assert.equal(semLimite.status, 201);
});

test('a cobrança por km divide, cobra o cliente ou fica grátis', async (t) => {
  const dividido = cobrancaEntrega({ distanciaKm: 7, valorPorKm: 2, modo: 'dividido' });
  assert.equal(dividido.valor_entrega, 14);
  assert.equal(dividido.taxa_cliente, 7);
  assert.equal(dividido.taxa_estabelecimento, 7);
  const clienteCheio = cobrancaEntrega({ distanciaKm: 7, valorPorKm: 2, modo: 'cliente' });
  assert.equal(clienteCheio.taxa_cliente, 14);
  assert.equal(clienteCheio.taxa_estabelecimento, 0);
  const gratis = cobrancaEntrega({ distanciaKm: 7, valorPorKm: 2, modo: 'gratis' });
  assert.equal(gratis.taxa_cliente, 0);
  assert.equal(gratis.valor_entrega, 14);
  assert.equal(gratis.entrega_gratis, 1);
  assert.equal(kmExibido(7.04), 7);
  assert.equal(cobrancaEntrega({ distanciaKm: 7.04, valorPorKm: 2, modo: 'cliente' }).valor_entrega, 14);
  const centavos = cobrancaEntrega({ distanciaKm: 7, valorPorKm: 2.01, modo: 'dividido' });
  assert.equal(centavos.valor_entrega, 14.07);
  assert.equal(centavos.taxa_cliente, 7.03);
  assert.equal(centavos.taxa_estabelecimento, 7.04);
  assert.equal(cobrancaEntrega({ valorPorKm: null, modo: 'cliente', taxaFixa: 5.9 }).taxa_cliente, 5.9);
  assert.equal(cobrancaEntrega({ valorPorKm: null, modo: 'dividido', taxaFixa: 5.9 }).taxa_cliente, 2.95);
  assert.equal(cobrancaEntrega({ valorPorKm: null, modo: 'gratis', taxaFixa: 5.9 }).taxa_cliente, 0);

  const raw = new SqliteDb(':memory:');
  t.after(() => raw.close());
  raw.prepare("INSERT INTO estabelecimentos (id,nome,ativo) VALUES (1,'Km',1)").run();
  raw.prepare(`INSERT INTO produtos (id,estabelecimento_id,nome,codigo_interno,preco,ativo,exibir_restaurante,tipo,sem_vencimento,criado_em)
    VALUES (10,1,'Pão','PAO',50,1,1,'produto',1,'2026-10-09T00:00:00.000Z')`).run();
  const admin = { DB: new TenantDb(raw, 1), rawDB: raw, estabelecimentoId: 1 };
  const loja = { latitude: -23.55, longitude: -46.65 };
  const cliente = { latitude: -23.55 + (7 / 6371) * (180 / Math.PI), longitude: -46.65 };
  assert.equal(kmExibido(distanciaKm(loja, cliente)), 7);

  const invalido = await updateOnlineStoreHandler(context({ slug: 'cobranca-km', nome: 'Cobrança', ativo: true, modo_entrega: 'metade' }), admin);
  assert.equal(invalido.status, 400);

  const salva = await updateOnlineStoreHandler(context({
    slug: 'cobranca-km', nome: 'Cobrança', ativo: true, taxa_entrega: 9,
    endereco: 'Rua da Loja, 10, São Paulo', latitude: loja.latitude, longitude: loja.longitude,
    raio_entrega_km: 20, valor_por_km: 2, modo_entrega: 'dividido',
  }), admin);
  assert.equal(salva.status, 200);
  assert.equal(salva.data.valor_por_km, 2);
  assert.equal(salva.data.modo_entrega, 'dividido');
  assert.equal(salva.data.taxa_entrega, 9);

  const publicado = await upsertOnlineCatalogProductHandler(context({ produto_id: 10, preco: 50 }), admin);
  const pedir = (chave, tipo, geocode, extra = {}) => createPublicOrderHandler(context({
    chave,
    cliente_nome: 'Ana Souza',
    telefone: '11999990000',
    tipo_entrega: tipo,
    endereco: 'Rua do Cliente, 70, São Paulo',
    forma_pagamento: 'dinheiro',
    taxa_entrega: 1,
    ...extra,
    itens: [{ cardapio_produto_id: publicado.data.id, quantidade: 1 }],
  }, { slug: 'cobranca-km' }), { DB: raw, geocode });
  const pontoCliente = async () => ({ ...cliente, endereco: 'Rua do Cliente, 70' });

  const pedido = await pedir('pedido-dividido-07km', 'entrega', pontoCliente);
  assert.equal(pedido.status, 201);
  assert.equal(pedido.data.total, 57);
  const gravado = raw.prepare('SELECT subtotal, taxa_entrega, total, valor_entrega, distancia_km, modo_entrega FROM pedidos_online WHERE id=?').bind(pedido.data.id).first();
  assert.equal(gravado.subtotal, 50);
  assert.equal(gravado.taxa_entrega, 7);
  assert.equal(gravado.total, 57);
  assert.equal(gravado.valor_entrega, 14);
  assert.equal(gravado.distancia_km, 7);
  assert.equal(gravado.modo_entrega, 'dividido');

  const acompanhamento = await getPublicOrderHandler(context({}, { slug: 'cobranca-km', chave: 'pedido-dividido-07km' }), { DB: raw });
  assert.equal(acompanhamento.data.taxa_entrega, 7);
  assert.equal(acompanhamento.data.valor_entrega, 14);
  assert.equal(acompanhamento.data.modo_entrega, 'dividido');
  assert.equal(Object.hasOwn(acompanhamento.data, 'cnpj'), false);
  assert.equal(Object.hasOwn(acompanhamento.data, 'latitude'), false);

  await updateOnlineStoreHandler(context({ modo_entrega: 'cliente', taxa_entrega: 0 }), admin);
  const cheio = await pedir('pedido-cliente-07km01', 'entrega', pontoCliente);
  assert.equal(cheio.data.total, 64);

  await updateOnlineStoreHandler(context({ modo_entrega: 'gratis' }), admin);
  const livre = await pedir('pedido-gratis-07km001', 'entrega', pontoCliente);
  assert.equal(livre.status, 201);
  assert.equal(livre.data.total, 50);
  const livreGravado = raw.prepare('SELECT taxa_entrega, valor_entrega, modo_entrega FROM pedidos_online WHERE id=?').bind(livre.data.id).first();
  assert.equal(livreGravado.taxa_entrega, 0);
  assert.equal(livreGravado.valor_entrega, 14);
  assert.equal(livreGravado.modo_entrega, 'gratis');

  const retirada = await pedir('pedido-retirada-07km', 'retirada', async () => { throw new Error('retirada nao geocodifica'); });
  assert.equal(retirada.status, 201);
  assert.equal(retirada.data.total, 50);

  const rede = await listPublicStoresHandler(context({}, {}, { lat: String(cliente.latitude), lng: String(cliente.longitude) }), { DB: raw });
  const card = rede.data.lojas.find((item) => item.slug === 'cobranca-km');
  assert.equal(card.taxa_cliente, 0);
  assert.equal(card.entrega_gratis, 1);
  assert.equal(card.valor_entrega, 14);
  assert.equal(Object.hasOwn(card, 'latitude'), false);
  assert.equal(Object.hasOwn(card, 'cnpj'), false);
  assert.equal(Object.hasOwn(card, 'estabelecimento_id'), false);

  await updateOnlineStoreHandler(context({ endereco: '', latitude: null, longitude: null, raio_entrega_km: null, valor_por_km: 2, modo_entrega: 'dividido' }), admin);
  const semPonto = await pedir('pedido-sem-ponto-loja', 'entrega', async () => { throw new Error('loja sem ponto nao geocodifica'); });
  assert.equal(semPonto.status, 400);
  assert.match(semPonto.data.error, /endereço da loja/i);
});
