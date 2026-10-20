import assert from 'node:assert/strict';
import test from 'node:test';
import { localizar, localizarOpcoes } from '../shared/localizacao.js';

const base = (nome) => ({ PHOTON_URL: `https://geocodificador.test/${nome}` });
const json = (dados, status = 200) => new Response(JSON.stringify(dados), { status, headers: { 'content-type': 'application/json' } });
const feature = (properties = {}, coordinates = [-46.6333, -23.5505]) => ({
  type: 'Feature', geometry: { type: 'Point', coordinates },
  properties: { countrycode: 'BR', country: 'Brasil', city: 'São Paulo', state: 'São Paulo', street: 'Rua Teste', housenumber: '10', ...properties },
});

test('Photon retorna opções brasileiras, deduplica e respeita o endpoint configurado', async (t) => {
  const chamadas = [];
  t.mock.method(globalThis, 'fetch', async (url, config) => {
    chamadas.push(new URL(url));
    assert.equal(config.headers['User-Agent'].includes('DoixP'), true);
    assert.equal(config.signal instanceof AbortSignal, true);
    return json({ features: [
      feature(), feature(),
      feature({ countrycode: 'US', country: 'United States' }),
      feature({ countrycode: 'BR' }, [20, 30]),
      ...Array.from({ length: 6 }, (_, i) => feature({ housenumber: String(20 + i) }, [-46.6333 - i / 100, -23.5505])),
    ] });
  });
  const opcoes = await localizarOpcoes(base('opcoes'), { q: 'Rua Teste, São Paulo' });
  assert.equal(opcoes.length, 5);
  assert.equal(opcoes[0].fonte, 'photon');
  assert.equal(opcoes[0].precisao, 'numero');
  assert.match(opcoes[0].endereco, /São Paulo/);
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].pathname, '/opcoes/api/');
  assert.equal(chamadas[0].searchParams.get('countrycode'), 'BR');
  assert.equal(chamadas[0].searchParams.get('bbox'), '-74,-34,-28,6');
  assert.equal(chamadas[0].searchParams.get('limit'), '5');
  assert.equal(chamadas[0].searchParams.has('lang'), false);
  const primeiro = await localizar(base('opcoes'), { q: 'Rua Teste, São Paulo' });
  assert.deepEqual(primeiro, opcoes[0]);
  assert.equal(chamadas.length, 1);
});

test('reverse mantém todas as casas decimais do GPS e não aproxima pontos vizinhos no cache', async (t) => {
  let chamadas = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    chamadas += 1;
    assert.equal(new URL(url).pathname, '/reverse-exato/reverse');
    return json({ features: [feature({}, [-46.633, -23.550])] });
  });
  const ponto = { lat: -23.550512345, lng: -46.633312345 };
  const resultado = await localizar(base('reverse-exato'), ponto);
  assert.equal(resultado.latitude, ponto.lat);
  assert.equal(resultado.longitude, ponto.lng);
  assert.equal(resultado.precisao, 'gps');
  const vizinho = await localizar(base('reverse-exato'), { lat: ponto.lat + 0.000001, lng: ponto.lng });
  assert.equal(vizinho.latitude, ponto.lat + 0.000001);
  assert.equal(chamadas, 2);
});

test('consultas iguais simultâneas compartilham a requisição e o cache não pode ser alterado pelo consumidor', async (t) => {
  let chamadas = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    chamadas += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return json({ features: [feature()] });
  });
  const env = base('dedupe');
  const resultados = await Promise.all(Array.from({ length: 6 }, () => localizarOpcoes(env, { q: 'Rua da Memória, São Paulo' })));
  assert.equal(chamadas, 1);
  resultados[0][0].latitude = 80;
  assert.equal(resultados[1][0].latitude, -23.5505);
  assert.equal((await localizar(env, { q: 'rua da memoria, são paulo' })).latitude, -23.5505);
  assert.equal(chamadas, 1);
});

test('CEP é expandido com rua, cidade e UF e rejeita centro de outra cidade', async (t) => {
  const chamadas = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    const pedido = new URL(url);
    chamadas.push(pedido);
    if (pedido.hostname === 'viacep.com.br') {
      assert.equal(pedido.pathname, '/ws/01001000/json/');
      return json({ cep: '01001-000', logradouro: 'Praça da Sé', bairro: 'Sé', localidade: 'São Paulo', uf: 'SP' });
    }
    assert.match(pedido.searchParams.get('q'), /Praça da Sé/);
    assert.match(pedido.searchParams.get('q'), /São Paulo, SP/);
    return json({ features: [
      feature({ city: 'Campinas', name: 'Centro de Campinas' }),
      feature({ city: 'São Paulo', state: 'Rio de Janeiro' }),
      feature({ city: 'São Paulo', postcode: '13010-000' }),
      feature({ city: 'São Paulo', type: 'city', osm_value: 'city', street: undefined, housenumber: undefined }),
      feature({ street: 'Praça da Sé', postcode: '01001-000' }),
    ] });
  });
  const opcoes = await localizarOpcoes(base('cep'), { q: '01001-000' });
  assert.equal(chamadas.length, 2);
  assert.equal(opcoes.length, 1);
  assert.match(opcoes[0].endereco, /Praça da Sé/);
});

test('CEP sem cidade confirmada e consultas inválidas falham sem selecionar um ponto aproximado', async (t) => {
  const chamadas = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    chamadas.push(String(url));
    return json({ erro: true });
  });
  for (const consulta of [{ q: 'abc' }, { q: '12345' }, { lat: 95, lng: -46 }, { lat: -23 }, { lat: 0, lng: 0 }, { q: 'x'.repeat(351) }]) {
    assert.deepEqual(await localizarOpcoes(base('invalidas'), consulta), []);
  }
  assert.equal(chamadas.length, 0);
  assert.deepEqual(await localizarOpcoes(base('cep-invalido'), { q: '99999-999' }), []);
  assert.equal(chamadas.length, 1);
  assert.match(chamadas[0], /viacep/);
});

test('falhas de rede/cache e resposta fora do país não usam Nominatim público como fallback', async (t) => {
  const chamadas = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    chamadas.push(String(url));
    throw new DOMException('Timeout', 'TimeoutError');
  });
  const env = { ...base('falha'), AUTH_KV: { get: async () => { throw new Error('KV offline'); }, put: async () => {} } };
  assert.equal(await localizar(env, { q: 'Rua Indisponível, São Paulo' }), null);
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas.some((url) => url.includes('nominatim')), false);
});

test('reverse descarta descrição distante e preserva GPS também no provedor injetado', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => json({ features: [feature({}, [-43.2, -22.9])] }));
  assert.equal(await localizar(base('reverse-distante'), { lat: -23.5505123, lng: -46.6333123 }), null);
  const ponto = await localizar({ geocode: async () => ({ latitude: -23.55, longitude: -46.63, endereco: 'Endereço próximo' }) }, { lat: -23.5505123, lng: -46.6333123 });
  assert.equal(ponto.latitude, -23.5505123);
  assert.equal(ponto.longitude, -46.6333123);
});
