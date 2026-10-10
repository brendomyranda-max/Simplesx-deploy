import assert from 'node:assert/strict';
import test from 'node:test';
import SqliteDb from '../server/sqlite-db.js';
import { TenantDb } from '../shared/tenant-db.js';
import {
  addStoreCategoryHandler,
  getPublicStoreHandler,
  listPublicStoresHandler,
  removeStoreCategoryHandler,
  updateOnlineStoreHandler,
} from '../shared/handlers-online.js';

function context(body = {}, params = {}, query = {}) {
  return {
    params,
    req: { json: async () => body, header: () => '', query: (key) => query[key] || '' },
    json: (data, status = 200) => ({ data, status }),
  };
}

test('a rede mostra a categoria que cada restaurante cria para si', async (t) => {
  const raw = new SqliteDb(':memory:');
  t.after(() => raw.close());
  raw.prepare("INSERT INTO estabelecimentos (id,nome,ativo) VALUES (1,'Brasa',1),(2,'Forno',1),(3,'Rascunho',1),(4,'Fechado',0)").run();
  const ambientes = [1, 2, 3, 4].map((id) => ({ DB: new TenantDb(raw, id), rawDB: raw, estabelecimentoId: id }));
  await updateOnlineStoreHandler(context({ slug: 'brasa', nome: 'Brasa & Pão', ativo: true }), ambientes[0]);
  await updateOnlineStoreHandler(context({ slug: 'forno', nome: 'Forno da Vila', descricao: 'Pizza de forno', ativo: true }), ambientes[1]);
  await updateOnlineStoreHandler(context({ slug: 'canto', nome: 'Canto Livre', ativo: true }), ambientes[2]);
  await updateOnlineStoreHandler(context({ slug: 'fechado', nome: 'Fechado', ativo: true }), ambientes[3]);
  await updateOnlineStoreHandler(context({ slug: 'rascunho', nome: 'Ainda não', ativo: false }), ambientes[2]);

  const hamburguer = await addStoreCategoryHandler(context({ nome: 'Hambúrgueres' }), ambientes[0]);
  assert.equal(hamburguer.status, 201);
  assert.equal(hamburguer.data[0].busca, 'hamburgueres');
  const repetida = await addStoreCategoryHandler(context({ nome: 'hamburgueres' }), ambientes[0]);
  assert.equal(repetida.status, 200);
  assert.equal(repetida.data.length, 1);

  await addStoreCategoryHandler(context({ nome: 'Pizzaria' }), ambientes[1]);
  await addStoreCategoryHandler(context({ nome: 'hamburgueres' }), ambientes[1]);
  await addStoreCategoryHandler(context({ nome: 'Comida japonesa' }), ambientes[2]);
  await addStoreCategoryHandler(context({ nome: 'Hambúrgueres' }), ambientes[3]);
  const curta = await addStoreCategoryHandler(context({ nome: 'a' }), ambientes[0]);
  assert.equal(curta.status, 400);

  const publico = { DB: raw };
  const rede = await listPublicStoresHandler(context(), publico);
  assert.equal(rede.status, 200);
  assert.deepEqual(rede.data.lojas.map((loja) => loja.slug).sort(), ['brasa', 'forno']);
  assert.equal(rede.data.lojas.some((loja) => loja.cnpj || loja.estabelecimento_id), false);
  assert.equal(rede.data.categorias.find((categoria) => categoria.busca === 'hamburgueres').lojas, 2);
  assert.equal(rede.data.categorias.some((categoria) => categoria.busca === 'comida japonesa'), false);
  assert.equal(rede.data.categorias.some((categoria) => categoria.nome === 'Hambúrgueres'), true);

  const soBurguer = await listPublicStoresHandler(context({}, {}, { categoria: 'Hambúrgueres' }), publico);
  assert.deepEqual(soBurguer.data.lojas.map((loja) => loja.slug).sort(), ['brasa', 'forno']);
  const pizza = await listPublicStoresHandler(context({}, {}, { q: 'pizza' }), publico);
  assert.deepEqual(pizza.data.lojas.map((loja) => loja.slug), ['forno']);

  const invasao = await removeStoreCategoryHandler(context({}, { id: String(hamburguer.data[0].id) }), ambientes[1]);
  assert.equal(invasao.status, 200);
  const depois = await listPublicStoresHandler(context({}, {}, { categoria: 'hamburgueres' }), publico);
  assert.equal(depois.data.lojas.some((loja) => loja.slug === 'brasa'), true);
});

test('a loja publica nome, logo e capa ou cor', async (t) => {
  const raw = new SqliteDb(':memory:');
  t.after(() => raw.close());
  raw.prepare("INSERT INTO estabelecimentos (id,nome,ativo) VALUES (1,'Casa',1)").run();
  const env = { DB: new TenantDb(raw, 1), rawDB: raw, estabelecimentoId: 1 };
  const foto = `data:image/jpeg;base64,${'a'.repeat(40)}`;
  const comCapa = await updateOnlineStoreHandler(context({
    slug: 'casa-boa', nome: 'Casa Boa', ativo: true, logo_url: foto, capa_url: foto, cor_capa: '#112233',
  }), env);
  assert.equal(comCapa.status, 200);
  assert.equal(comCapa.data.nome, 'Casa Boa');
  assert.equal(comCapa.data.logo_url, foto);
  assert.equal(comCapa.data.capa_url, foto);
  assert.equal(comCapa.data.cor_capa, null);

  const cor = await updateOnlineStoreHandler(context({ capa_url: null, cor_capa: '#C2410C' }), env);
  assert.equal(cor.status, 200);
  assert.equal(cor.data.cor_capa, '#c2410c');
  assert.equal(cor.data.capa_url, null);
  assert.equal(cor.data.logo_url, foto);

  const ruim = await updateOnlineStoreHandler(context({ cor_capa: 'vermelho' }), env);
  assert.equal(ruim.status, 400);
  assert.match(ruim.data.error, /#RRGGBB/);
  const intacta = await updateOnlineStoreHandler(context({ nome: 'Casa Boa' }), env);
  assert.equal(intacta.data.cor_capa, '#c2410c');
  assert.equal(intacta.data.logo_url, foto);

  const publico = { DB: raw };
  const rede = await listPublicStoresHandler(context(), publico);
  const loja = rede.data.lojas.find((item) => item.slug === 'casa-boa');
  assert.equal(loja.nome, 'Casa Boa');
  assert.equal(loja.cor_capa, '#c2410c');
  assert.equal(loja.logo_url, foto);
  assert.equal(loja.capa_url, null);
  assert.equal('estabelecimento_id' in loja, false);
  assert.equal('latitude' in loja, false);

  const pagina = await getPublicStoreHandler(context({}, { slug: 'casa-boa' }), publico);
  assert.equal(pagina.status, 200);
  assert.equal(pagina.data.loja.nome, 'Casa Boa');
  assert.equal(pagina.data.loja.cor_capa, '#c2410c');
  assert.equal(pagina.data.loja.logo_url, foto);
  assert.equal(pagina.data.loja.estabelecimento_id, undefined);
});
