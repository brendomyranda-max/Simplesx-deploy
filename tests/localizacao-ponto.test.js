import assert from 'node:assert/strict';
import test from 'node:test';
import SqliteDb from '../server/sqlite-db.js';
import { TenantDb } from '../shared/tenant-db.js';
import { distanciaKm, kmExibido } from '../shared/localizacao.js';
import { createPublicOrderHandler, distanciaLojaHandler, getPublicOrderHandler, localizarHandler, painelPedidosHandler, updateOnlineStoreHandler, upsertOnlineCatalogProductHandler } from '../shared/handlers-online.js';

function context(body = {}, params = {}, query = {}) {
  return {
    params, user: { id: 1 },
    req: { json: async () => body, header: () => '', query: (key) => query[key] ?? '' },
    json: (data, status = 200) => ({ data, status }),
  };
}

const LOJA = { latitude: -23.55, longitude: -46.65 };
const CLIENTE = { latitude: -23.550512345, longitude: -46.633312345 };

async function preparar(t, extras = {}) {
  const raw = new SqliteDb(':memory:');
  t.after(() => raw.close());
  raw.prepare("INSERT INTO estabelecimentos (id,nome,ativo) VALUES (1,'Loja',1)").run();
  raw.prepare(`INSERT INTO produtos (id,estabelecimento_id,nome,codigo_interno,preco,ativo,exibir_restaurante,tipo,sem_vencimento,criado_em)
    VALUES (10,1,'Sanduíche','SAND',20,1,1,'produto',1,'2026-10-20T00:00:00.000Z')`).run();
  const admin = { DB: new TenantDb(raw, 1), rawDB: raw, estabelecimentoId: 1 };
  const loja = await updateOnlineStoreHandler(context({
    slug: 'localizacao', nome: 'Loja de teste', ativo: true, endereco: 'Rua da Loja, 10, São Paulo',
    ...LOJA, raio_entrega_km: 5, valor_por_km: 2, ...extras,
  }), admin);
  assert.equal(loja.status, 200);
  const produto = await upsertOnlineCatalogProductHandler(context({ produto_id: 10, preco: 20 }), admin);
  assert.equal(produto.status, 201);
  const pedir = (chave, outros = {}, geocode = async () => { throw new Error('O ponto escolhido dispensa geocodificação.'); }) => createPublicOrderHandler(context({
    chave, cliente_nome: 'Ana Souza', telefone: '11999990000', tipo_entrega: 'entrega',
    endereco: 'Rua do Cliente, 23, São Paulo', forma_pagamento: 'dinheiro',
    itens: [{ cardapio_produto_id: produto.data.id, quantidade: 1 }], ...outros,
  }, { slug: 'localizacao' }), { DB: raw, geocode });
  return { raw, admin, pedir };
}

test('endereço novo da loja geocodifica e não herda o ponto anterior', async (t) => {
  const { raw, admin } = await preparar(t);
  const consultas = [];
  const resultado = await updateOnlineStoreHandler(context({ endereco: 'Rua Nova, 99, São Paulo' }), {
    ...admin, geocode: async (consulta) => { consultas.push(consulta); return { ...CLIENTE, endereco: 'Rua Nova, São Paulo' }; },
  });
  assert.equal(resultado.status, 200);
  assert.deepEqual(consultas, [{ q: 'Rua Nova, 99, São Paulo' }]);
  const gravada = raw.prepare('SELECT latitude,longitude,endereco FROM lojas_online WHERE estabelecimento_id=1').first();
  assert.equal(gravada.latitude, CLIENTE.latitude);
  assert.equal(gravada.longitude, CLIENTE.longitude);
  assert.equal(gravada.endereco, 'Rua Nova, 99, São Paulo');
  const falha = await updateOnlineStoreHandler(context({ endereco: 'Rua Impossível, 20' }), { ...admin, geocode: async () => null });
  assert.equal(falha.status, 400);
  assert.equal(raw.prepare('SELECT endereco FROM lojas_online WHERE estabelecimento_id=1').first().endereco, gravada.endereco);
  const parcial = await updateOnlineStoreHandler(context({ latitude: -23.6 }), admin);
  assert.equal(parcial.status, 400);
  const apagada = await updateOnlineStoreHandler(context({ endereco: '' }), admin);
  assert.equal(apagada.status, 200);
  assert.equal(apagada.data.latitude, null);
  assert.equal(apagada.data.longitude, null);
});

test('checkout usa o ponto escolhido, recalcula cobrança no servidor e persiste entrega própria', async (t) => {
  const { raw, admin, pedir } = await preparar(t);
  const resultado = await pedir('pedido-com-ponto-0001', {
    destino_latitude: CLIENTE.latitude, destino_longitude: CLIENTE.longitude, taxa_entrega: 0.01,
  });
  assert.equal(resultado.status, 201);
  const gravado = raw.prepare('SELECT * FROM pedidos_online WHERE id=?').bind(resultado.data.id).first();
  const distancia = kmExibido(distanciaKm(LOJA, CLIENTE));
  assert.equal(gravado.entrega_destino_lat, CLIENTE.latitude);
  assert.equal(gravado.entrega_destino_lng, CLIENTE.longitude);
  assert.equal(gravado.entrega_plataforma, 0);
  assert.equal(gravado.distancia_km, distancia);
  assert.equal(gravado.taxa_entrega, distancia * 2);
  assert.equal(gravado.total, 20 + distancia * 2);
  const painel = await painelPedidosHandler(context(), admin);
  assert.equal(painel.data.delivery[0].destino_latitude, CLIENTE.latitude);
  assert.equal(painel.data.delivery[0].destino_longitude, CLIENTE.longitude);
  const publico = await getPublicOrderHandler(context({}, { slug: 'localizacao', chave: 'pedido-com-ponto-0001' }), { DB: raw });
  assert.equal(publico.status, 200);
  for (const campo of ['entrega_destino_lat', 'entrega_destino_lng', 'destino_latitude', 'destino_longitude']) {
    assert.equal(Object.hasOwn(publico.data, campo), false);
    assert.equal(Object.hasOwn(publico.data.pedido || {}, campo), false);
  }
  const repetido = await pedir('pedido-com-ponto-0001', { destino_latitude: 90, destino_longitude: 180 });
  assert.equal(repetido.status, 200);
  assert.equal(repetido.data.repetido, true);
  assert.equal(raw.prepare('SELECT COUNT(*) AS total FROM pedidos_online').first().total, 1);
  assert.equal(raw.prepare('SELECT entrega_destino_lat FROM pedidos_online').first().entrega_destino_lat, CLIENTE.latitude);
});

test('checkout rejeita par inválido e destino fora do raio', async (t) => {
  const { raw, pedir } = await preparar(t);
  const invalidos = [
    { destino_latitude: CLIENTE.latitude },
    { destino_latitude: CLIENTE.latitude, destino_longitude: '' },
    { destino_latitude: ' ', destino_longitude: '-46.63' },
    { destino_latitude: 91, destino_longitude: -46 },
    { destino_latitude: true, destino_longitude: -46 },
  ];
  for (const [i, destino] of invalidos.entries()) {
    const resposta = await pedir(`pedido-invalido-000${i}`, destino);
    assert.equal(resposta.status, 400);
    assert.match(resposta.data.error, /latitude e a longitude/);
  }
  const fora = await pedir('pedido-fora-ponto-0001', { destino_latitude: -23.9, destino_longitude: -46.9 });
  assert.equal(fora.status, 400);
  assert.match(fora.data.error, /entrega até 5 km/);
  assert.equal(raw.prepare('SELECT COUNT(*) AS total FROM pedidos_online').first().total, 0);
});

test('checkout antigo geocodifica endereço e grava ponto; taxa fixa aceita ponto sem geocodificar', async (t) => {
  const { raw, admin, pedir } = await preparar(t);
  let chamadas = 0;
  const legado = await pedir('pedido-legado-ponto01', {}, async () => { chamadas += 1; return CLIENTE; });
  assert.equal(legado.status, 201);
  assert.equal(chamadas, 1);
  assert.equal(raw.prepare('SELECT entrega_destino_lat FROM pedidos_online WHERE id=?').bind(legado.data.id).first().entrega_destino_lat, CLIENTE.latitude);
  const alterada = await updateOnlineStoreHandler(context({ raio_entrega_km: null, valor_por_km: null, taxa_entrega: 6 }), admin);
  assert.equal(alterada.status, 200);
  const fixo = await pedir('pedido-fixo-ponto-001', { destino_latitude: CLIENTE.latitude, destino_longitude: CLIENTE.longitude });
  assert.equal(fixo.status, 201);
  const gravado = raw.prepare('SELECT entrega_destino_lat,entrega_destino_lng,taxa_entrega FROM pedidos_online WHERE id=?').bind(fixo.data.id).first();
  assert.deepEqual(gravado, { entrega_destino_lat: CLIENTE.latitude, entrega_destino_lng: CLIENTE.longitude, taxa_entrega: 6 });
});

test('API de localização oferece opções compatíveis e distância prioriza o GPS escolhido', async (t) => {
  const { raw } = await preparar(t);
  const geocode = async () => [
    { ...CLIENTE, endereco: 'Rua do Cliente, São Paulo' },
    { latitude: -23.56, longitude: -46.64, endereco: 'Outra opção, São Paulo' },
  ];
  const opcoes = await localizarHandler(context({}, {}, { q: 'Rua do Cliente, São Paulo', opcoes: '1' }), { DB: raw, geocode });
  assert.equal(opcoes.status, 200);
  assert.equal(opcoes.data.opcoes.length, 2);
  assert.equal(opcoes.data.latitude, CLIENTE.latitude);
  const legado = await localizarHandler(context({}, {}, { q: 'Rua do Cliente, São Paulo' }), { DB: raw, geocode });
  assert.equal(Object.hasOwn(legado.data, 'opcoes'), false);
  const distancia = await distanciaLojaHandler(context({}, { slug: 'localizacao' }, { q: 'Endereço descritivo', lat: String(CLIENTE.latitude), lng: String(CLIENTE.longitude) }), {
    DB: raw, geocode: async () => { throw new Error('O GPS escolhido dispensa pesquisa por endereço.'); },
  });
  assert.equal(distancia.status, 200);
  assert.equal(distancia.data.distancia_km, kmExibido(distanciaKm(LOJA, CLIENTE)));
  const parcial = await distanciaLojaHandler(context({}, { slug: 'localizacao' }, { q: 'Endereço válido', lat: '-23' }), { DB: raw, geocode });
  assert.equal(parcial.status, 400);
});
