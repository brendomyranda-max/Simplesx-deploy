import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const asModule = (source) => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString('base64');
const formatModule = asModule(readFileSync('src/lib/format.ts', 'utf8'));
const localizacao = await import(asModule(readFileSync('src/lib/localizacao-cliente.ts', 'utf8')
  .replace("'@/lib/format'", JSON.stringify(formatModule))));
const CHAVE = 'simplesx_ponto_cliente';
const BASE = { latitude: -23.5505, longitude: -46.6333 };

function navegador(t) {
  const observadores = new Map();
  const encerrados = [];
  const storage = new Map();
  let proximo = 0;
  const pagina = Object.assign(new EventTarget(), { hidden: false });
  const gps = {
    watchPosition(onPonto, onErro, options) {
      const id = proximo++;
      observadores.set(id, { onPonto, onErro, options });
      return id;
    },
    clearWatch(id) { encerrados.push(id); },
  };
  for (const [nome, valor] of Object.entries({
    navigator: { geolocation: gps }, document: pagina,
    window: { sessionStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) } },
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, nome);
    Object.defineProperty(globalThis, nome, { value: valor, configurable: true });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, nome, descriptor);
      else delete globalThis[nome];
    });
  }
  return {
    observadores, encerrados, storage, gps,
    ponto(id, extra = {}) { observadores.get(id).onPonto({ coords: { ...BASE, accuracy: 20, ...extra }, timestamp: 1792500000000 }); },
    erro(id, code) { observadores.get(id).onErro({ code }); },
    ocultar(hidden) { pagina.hidden = hidden; pagina.dispatchEvent(new Event('visibilitychange')); },
  };
}

test('ponto persistido valida limites, origem e metadados sem converter entradas inválidas', (t) => {
  const nav = navegador(t);
  const antigo = { ...BASE, origem: 'endereco', endereco: 'Rua A, 10' };
  nav.storage.set(CHAVE, JSON.stringify(antigo));
  assert.deepEqual(localizacao.lerPontoCliente(), antigo);
  const mapa = { ...BASE, origem: 'mapa', endereco: ' Rua B, 20 ', precisao_metros: 15, atualizado_em: 1792500000000, extra: 'descartar' };
  localizacao.gravarPontoCliente(mapa);
  assert.deepEqual(localizacao.lerPontoCliente(), { ...BASE, origem: 'mapa', endereco: 'Rua B, 20', precisao_metros: 15, atualizado_em: 1792500000000 });
  for (const invalido of [
    null, [], { ...antigo, latitude: 91 }, { ...antigo, longitude: -181 }, { ...antigo, latitude: '-23.55' },
    { ...antigo, latitude: null }, { ...antigo, endereco: 10 }, { ...antigo, origem: 'ip' },
    { ...antigo, precisao_metros: -1 }, { ...antigo, precisao_metros: '15' }, { ...antigo, atualizado_em: 'ontem' },
  ]) {
    nav.storage.set(CHAVE, JSON.stringify(invalido));
    assert.equal(localizacao.lerPontoCliente(), null);
  }
  nav.storage.set(CHAVE, '{quebrado');
  assert.equal(localizacao.lerPontoCliente(), null);
  assert.equal(localizacao.coordenadaClienteValida(-90, 180), true);
  assert.equal(localizacao.coordenadaClienteValida(0, 0), true);
  assert.equal(localizacao.coordenadaClienteValida(NaN, 1), false);
  assert.equal(localizacao.coordenadaClienteValida(1, Infinity), false);
  assert.equal(localizacao.coordenadaClienteValida('1', 2), false);
});

test('ponto GPS expira após 30 minutos ou sem data; endereço e mapa permanecem durante a sessão', (t) => {
  const nav = navegador(t);
  const ponto = { ...BASE, origem: 'gps', endereco: '' };
  for (const atualizado_em of [undefined, Date.now() - 31 * 60 * 1000, Date.now() + 120000]) {
    nav.storage.set(CHAVE, JSON.stringify({ ...ponto, atualizado_em }));
    assert.equal(localizacao.lerPontoCliente(), null);
  }
  localizacao.gravarPontoCliente({ ...ponto, atualizado_em: Date.now() });
  assert.equal(localizacao.lerPontoCliente().origem, 'gps');
  for (const origem of ['endereco', 'mapa']) {
    localizacao.gravarPontoCliente({ ...ponto, origem });
    assert.equal(localizacao.lerPontoCliente().origem, origem);
  }
  localizacao.limparPontoCliente();
  assert.equal(localizacao.lerPontoCliente(), null);
});

test('bloqueio de sessionStorage na leitura ou gravação não interrompe o endereço', (t) => {
  navegador(t);
  window.sessionStorage.getItem = () => { throw new Error('SecurityError'); };
  window.sessionStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  window.sessionStorage.removeItem = () => { throw new Error('SecurityError'); };
  assert.equal(localizacao.lerPontoCliente(), null);
  assert.doesNotThrow(() => localizacao.gravarPontoCliente({ ...BASE, origem: 'gps', endereco: '' }));
  assert.doesNotThrow(() => localizacao.limparPontoCliente());
  Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('SecurityError'); } });
  assert.equal(localizacao.lerPontoCliente(), null);
  assert.doesNotThrow(() => localizacao.gravarPontoCliente({ ...BASE, origem: 'gps', endereco: '' }));
  assert.doesNotThrow(() => localizacao.limparPontoCliente());
});

test('GPS emite melhora de precisão no mesmo ponto e evita troca por posição grosseira', (t) => {
  const nav = navegador(t);
  const pontos = [];
  const limpar = localizacao.observarLocalizacao({ onPonto: (ponto) => pontos.push(ponto), onErro: assert.fail });
  t.after(limpar);
  nav.ponto(0, { accuracy: 1200 });
  nav.ponto(0, { accuracy: 15 });
  nav.ponto(0, { accuracy: 14 });
  nav.ponto(0, { latitude: BASE.latitude + 0.0005, accuracy: 1000 });
  assert.equal(pontos.length, 2);
  assert.equal(pontos[1].precisao_metros, 15);
  assert.equal(pontos[1].atualizado_em, 1792500000000);
  nav.ponto(0, { latitude: BASE.latitude + 0.001, accuracy: 20 });
  assert.equal(pontos.length, 3);
});

test('movimento é calculado em metros e posições inválidas são descartadas', (t) => {
  const nav = navegador(t);
  const pontos = [];
  const limpar = localizacao.observarLocalizacao({ onPonto: (ponto) => pontos.push(ponto), onErro: assert.fail });
  t.after(limpar);
  nav.ponto(0, { latitude: 91 });
  nav.ponto(0, { longitude: NaN });
  nav.ponto(0, { latitude: '-23.55' });
  assert.equal(pontos.length, 0);
  nav.ponto(0, { latitude: 80, longitude: 0 });
  nav.ponto(0, { latitude: 80, longitude: 0.001 }); // 19 m na latitude 80°, apesar do delta em graus.
  assert.equal(pontos.length, 1);
  nav.ponto(0, { latitude: 80, longitude: 0.003 });
  assert.equal(pontos.length, 2);
});

test('ocultar a página pausa o GPS e ignora callbacks antigos, inclusive após retomada', (t) => {
  const nav = navegador(t);
  const pontos = [];
  const erros = [];
  const limpar = localizacao.observarLocalizacao({ onPonto: (ponto) => pontos.push(ponto), onErro: (erro) => erros.push(erro) });
  nav.ocultar(true);
  assert.deepEqual(nav.encerrados, [0]);
  nav.ponto(0);
  nav.erro(0, 3);
  assert.equal(pontos.length, 0);
  assert.equal(erros.length, 0);
  nav.ocultar(false);
  assert.equal(nav.observadores.size, 2);
  nav.ponto(0);
  assert.equal(pontos.length, 0);
  nav.ponto(1);
  assert.equal(pontos.length, 1);
  limpar();
  limpar();
  nav.ponto(1, { latitude: BASE.latitude + 0.01 });
  nav.erro(1, 1);
  nav.ocultar(true);
  nav.ocultar(false);
  assert.equal(nav.observadores.size, 2);
  assert.equal(pontos.length, 1);
  assert.equal(erros.length, 0);
  assert.deepEqual(nav.encerrados, [0, 1]);
});

test('observação iniciada em página oculta aguarda retorno e permissão negada encerra a observação', (t) => {
  const nav = navegador(t);
  nav.ocultar(true);
  const erros = [];
  const limpar = localizacao.observarLocalizacao({ onPonto: assert.fail, onErro: (erro) => erros.push(erro) });
  t.after(limpar);
  assert.equal(nav.observadores.size, 0);
  nav.ocultar(false);
  nav.erro(0, 1);
  assert.match(erros[0], /não autorizada.*configurações.*endereço/i);
  assert.deepEqual(nav.encerrados, [0]);
  nav.ponto(0);
  nav.ocultar(true);
  nav.ocultar(false);
  assert.equal(nav.observadores.size, 1);
});

test('consulta pontual aguarda refino, recebe coordenadas recentes e encerra GPS e prazo', async (t) => {
  const nav = navegador(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const consulta = localizacao.obterLocalizacaoAtual();
  let terminou = false;
  consulta.then(() => { terminou = true; });
  assert.equal(nav.observadores.get(0).options.maximumAge, 0);
  assert.equal(nav.observadores.get(0).options.enableHighAccuracy, true);
  nav.ponto(0, { accuracy: 2500 });
  await Promise.resolve();
  assert.equal(terminou, false);
  nav.ponto(0, { accuracy: 12 });
  assert.equal((await consulta).precisao_metros, 12);
  assert.deepEqual(nav.encerrados, [0]);
  nav.ponto(0, { accuracy: 1 });
  nav.erro(0, 1);
  nav.ocultar(true);
  t.mock.timers.tick(20000);
  assert.deepEqual(nav.encerrados, [0]);
});

test('consulta pontual retorna a melhor precisão disponível no prazo e não fica presa a ponto grosseiro', async (t) => {
  const nav = navegador(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const consulta = localizacao.obterLocalizacaoAtual();
  nav.ponto(0, { accuracy: 1500 });
  nav.ponto(0, { accuracy: 180 });
  nav.ponto(0, { accuracy: 3000 });
  t.mock.timers.tick(18000);
  assert.equal((await consulta).precisao_metros, 180);
  assert.deepEqual(nav.encerrados, [0]);
});

test('consulta pontual rejeita prazo sem ponto válido e limpa o observador', async (t) => {
  const nav = navegador(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const consulta = localizacao.obterLocalizacaoAtual();
  const rejeicao = assert.rejects(consulta, /demorou.*tente novamente.*endereço/i);
  nav.ponto(0, { latitude: 91 });
  t.mock.timers.tick(18000);
  await rejeicao;
  assert.deepEqual(nav.encerrados, [0]);
});

test('erros de permissão e timeout apresentam orientação e encerram a consulta pontual', async (t) => {
  const nav = navegador(t);
  const negada = localizacao.obterLocalizacaoAtual();
  const erroNegada = assert.rejects(negada, /não autorizada.*configurações/i);
  nav.ponto(0, { accuracy: 1000 });
  nav.erro(0, 1);
  await erroNegada;
  const lenta = localizacao.obterLocalizacaoAtual();
  const erroLenta = assert.rejects(lenta, /demorou.*endereço/i);
  nav.erro(1, 3);
  await erroLenta;
  assert.deepEqual(nav.encerrados, [0, 1]);
});

test('consulta pontual libera GPS ao ocultar a página e não inicia se já estiver oculta', async (t) => {
  const nav = navegador(t);
  const consulta = localizacao.obterLocalizacaoAtual();
  const rejeicao = assert.rejects(consulta, /pausada.*tente novamente/i);
  nav.ocultar(true);
  await rejeicao;
  assert.deepEqual(nav.encerrados, [0]);
  nav.ponto(0);
  await assert.rejects(localizacao.obterLocalizacaoAtual(), /volte à página/i);
  assert.equal(nav.observadores.size, 1);
});
