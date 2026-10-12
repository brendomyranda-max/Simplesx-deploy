import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import SqliteDb from '../server/sqlite-db.js';
import { handle } from '../shared/router.js';
import { sha256 } from '../shared/util.js';

async function fixture(t) {
  const DB = new SqliteDb(':memory:');
  t.after(() => DB.close());
  for (const id of [1, 2, 3]) {
    const loja = id === 3 ? 1 : id;
    if (id < 3) DB.prepare('INSERT INTO estabelecimentos (id,nome) VALUES (?,?)').bind(id, `Loja ${id}`).run();
    DB.prepare("INSERT INTO funcionarios (id,estabelecimento_id,nome,usuario,senha_hash,modulos) VALUES (?,?,?,?,'hash','gestor,area:vendas')")
      .bind(id, loja, `Operador ${id}`, `operador-${id}`).run();
    DB.prepare('INSERT INTO sessoes (estabelecimento_id,funcionario_id,token_hash,expira_em) VALUES (?,?,?,?)')
      .bind(loja, id, await sha256(`sessao-${id}`), '2099-01-01').run();
  }
  const call = (path, body, token = 'sessao-1', method = 'POST') => handle({
    req: { path, method, json: async () => body, query: () => undefined,
      header: (name) => name === 'cookie' ? `simplesx_session=${token}` : undefined },
    json: (data, status = 200) => ({ data, status }),
  }, { DB });
  const create = async () => (await call('/api/nfc/solicitacoes', {})).data;
  const read = (r, uid = '00A224B1C2D380', overrides = {}) => call(`/api/nfc/solicitacoes/${r.id}/leitura`, { token: r.token, uid, ...overrides }, '');
  const status = (r, token) => call(`/api/nfc/solicitacoes/${r.id}`, null, token, 'GET');
  return { DB, call, create, read, status };
}

test('solicitar leitura exige login e área; o segredo temporário é armazenado somente como hash', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.call('/api/nfc/solicitacoes', {}, '')).status, 401);
  f.DB.prepare("UPDATE funcionarios SET modulos='gestor,area:gestao' WHERE id=1").run();
  assert.equal((await f.call('/api/nfc/solicitacoes', {})).status, 403);
  f.DB.prepare("UPDATE funcionarios SET modulos='gestor,area:vendas' WHERE id=1").run();
  const r = await f.create();
  assert.match(r.token, /^[A-F0-9]{64}$/);
  const row = f.DB.prepare('SELECT * FROM nfc_solicitacoes WHERE id=?').first(r.id);
  assert.equal(row.token_hash, await sha256(r.token));
  assert.equal(row.estabelecimento_id, 1);
  assert.equal(row.funcionario_id, 1);
  assert.ok(Date.parse(row.expira_em) - Date.now() <= 120_000);
});

test('navegador → solicitação → leitor sem pareamento → retorno → pedido salvo uma vez', async (t) => {
  const f = await fixture(t);
  const r = await f.create();
  assert.equal((await f.status(r)).data.estado, 'aguardando');
  assert.equal((await f.read(r, '00:a2:24:b1:c2:d3:80', { estabelecimento_id: 2, payload: 'texto da tag' })).status, 200);
  for (const table of ['devices', 'mesas', 'comandas', 'comanda_itens', 'nfc_eventos']) {
    assert.equal(f.DB.prepare(`SELECT COUNT(*) n FROM ${table}`).first().n, 0);
  }
  const result = (await f.status(r)).data;
  assert.deepEqual(result, { estado: 'lido', uid: '00A224B1C2D380', payload: '' });
  const produto = f.DB.prepare("INSERT INTO produtos (estabelecimento_id,nome,preco,ativo) VALUES (1,'NFC navegador',15,1)").run();
  const body = { ...result, acao: 'lancar', chave: 'pedido-navegador', itens: [{ produto_id: produto.meta.last_row_id, quantidade: 2 }] };
  const pedido = await f.call('/api/cartoes/usar', body);
  assert.equal(pedido.status, 200);
  assert.equal((await f.call('/api/cartoes/usar', body)).status, 200);
  assert.equal(f.DB.prepare('SELECT COUNT(*) n FROM comanda_itens').first().n, 1);
  assert.equal(f.DB.prepare('SELECT estabelecimento_id,nfc_uid FROM mesas').first().nfc_uid, result.uid);
});

test('resultado pertence à solicitação e ao funcionário; outra loja e outro funcionário não recebem o UID', async (t) => {
  const f = await fixture(t);
  const a = await f.create();
  const b = await f.create();
  await f.read(a);
  assert.equal((await f.status(b)).data.estado, 'aguardando');
  for (const session of ['', 'sessao-2', 'sessao-3']) {
    assert.equal((await f.status(a, session)).status, session ? 404 : 401);
  }
  assert.equal((await f.call(`/api/nfc/solicitacoes/${a.id}`, {}, 'sessao-3', 'DELETE')).status, 404);
});

test('segredo errado e UID inválido não gravam uma leitura', async (t) => {
  const f = await fixture(t);
  const r = await f.create();
  assert.equal((await f.read(r, '12345678', { token: 'A'.repeat(64) })).status, 401);
  for (const uid of ['', 'COMANDA-001', '<script>', 12345678]) assert.equal((await f.read(r, uid)).status, 400);
  assert.equal((await f.status(r)).data.estado, 'aguardando');
});

test('espera cancelada ou expirada recusa aproximação; leitura concluída aguarda navegador suspenso', async (t) => {
  const f = await fixture(t);
  const cancelado = await f.create();
  assert.equal((await f.call(`/api/nfc/solicitacoes/${cancelado.id}`, null, 'sessao-1', 'DELETE')).status, 200);
  assert.equal((await f.read(cancelado)).status, 410);
  assert.equal((await f.status(cancelado)).data.estado, 'cancelado');
  const expirado = await f.create();
  f.DB.prepare('UPDATE nfc_solicitacoes SET expira_em=? WHERE id=?').bind(new Date(Date.now() - 1000).toISOString(), expirado.id).run();
  assert.equal((await f.read(expirado)).status, 410);
  assert.equal((await f.status(expirado)).data.estado, 'expirado');
  const concluido = await f.create();
  await f.read(concluido);
  f.DB.prepare('UPDATE nfc_solicitacoes SET expira_em=? WHERE id=?').bind(new Date(Date.now() - 1000).toISOString(), concluido.id).run();
  assert.equal((await f.status(concluido)).data.estado, 'lido');
});

test('aproximações concorrentes têm um vencedor e repetir o mesmo envio é idempotente', async (t) => {
  const f = await fixture(t);
  const r = await f.create();
  const results = await Promise.all([f.read(r, '00112233'), f.read(r, '44556677')]);
  assert.deepEqual(results.map((x) => x.status).sort(), [200, 409]);
  const uid = (await f.status(r)).data.uid;
  assert.equal((await f.read(r, uid)).status, 200);
  const same = await f.create();
  assert.deepEqual((await Promise.all([f.read(same), f.read(same)])).map((x) => x.status), [200, 200]);
});

test('link acionado pelo usuário abre somente o pacote Android esperado com parâmetros codificados', async () => {
  const source = ts.transpileModule(readFileSync('src/lib/nfcScanLink.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
  const { nfcScanLink } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const id = '12345678-1234-1234-1234-123456789abc';
  const token = 'A'.repeat(64);
  const link = nfcScanLink('https://doixp.com', id, token);
  assert.match(link, /^intent:\/\/nfc\/ler\?servidor=https%3A%2F%2Fdoixp.com/);
  assert.match(link, /#Intent;scheme=doixp;package=br.com.simplesx.gestor;end$/);
  for (const origin of ['http://doixp.com', 'https://user@doixp.com', 'https://doixp.com/path', 'https://doixp.com?x=1']) {
    assert.throws(() => nfcScanLink(origin, id, token));
  }
  assert.throws(() => nfcScanLink('https://doixp.com', id, 'x;component=evil'));
});

test('botão web prepara link real, espera retorno do Android e entrega UID uma vez à ação', async (t) => {
  const f = await fixture(t);
  const effects = [];
  const cleanups = [];
  const states = [];
  let slot = 0;
  let started = false;
  const delivered = [];
  let created;
  const creation = new Promise((resolve) => { created = resolve; });
  let accepted;
  const acceptance = new Promise((resolve) => { accepted = resolve; });
  let cancelled;
  const cancellation = new Promise((resolve) => { cancelled = resolve; });
  t.after(() => cleanups.reverse().forEach((fn) => fn()));
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const globals = {
    window: Object.assign(new EventTarget(), { location: { origin: 'https://doixp.com' } }),
    document, navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 15; Samsung S21) Chrome/140.0' },
    __scanState: (initial) => { const index = slot++; if (!(index in states)) states[index] = initial; return [states[index], (v) => { states[index] = typeof v === 'function' ? v(states[index]) : v; }]; },
    __scanEffect: (fn) => effects.push(fn),
    __scanApi: {
      solicitar: async () => { const request = await f.create(); created(); return request; },
      solicitacao: async (id) => (await f.status({ id })).data,
      cancelarSolicitacao: async (id) => { const result = await f.call(`/api/nfc/solicitacoes/${id}`, null, 'sessao-1', 'DELETE'); cancelled(); return result; },
    },
  };
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
  }
  t.mock.timers.enable({ apis: ['setInterval'] });
  const module = (source, tsx = false) => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: tsx ? 'component.tsx' : 'module.ts',
  }).outputText.replace('"react/jsx-runtime"', JSON.stringify(runtime))).toString('base64');
  const runtime = 'data:text/javascript;base64,' + Buffer.from('export const jsx = (type,props) => ({type,props}); export const jsxs = jsx;').toString('base64');
  const react = module('export const useRef = (v) => ({current:v}); export const useState = (v) => globalThis.__scanState(v); export const useEffect = (fn) => globalThis.__scanEffect(fn);');
  const api = module('export const nfcApi = globalThis.__scanApi;');
  const ui = module('export const Button = () => {};');
  const linkModule = module(readFileSync('src/lib/nfcScanLink.ts', 'utf8'));
  const source = readFileSync('src/components/NfcScanButton.tsx', 'utf8')
    .replace("'react'", JSON.stringify(react)).replace("'@/lib/api'", JSON.stringify(api))
    .replace("'@/components/ui'", JSON.stringify(ui)).replace("'@/lib/nfcScanLink'", JSON.stringify(linkModule));
  const { NfcScanButton } = await import(module(source, true));
  const props = { enabled: true, onStart: () => { started = true; }, onRead: (reading) => { delivered.push(reading); accepted(); } };
  NfcScanButton(props);
  cleanups.push(effects.shift()());
  await creation;
  await new Promise(setImmediate);
  slot = 0;
  const tree = NfcScanButton(props);
  const anchor = tree.props.children.find((node) => node?.type === 'a');
  assert.ok(anchor, 'A solicitação deve preparar o link de leitura');
  assert.ok(anchor.props.href.startsWith('intent://nfc/ler?'));
  anchor.props.onClick();
  assert.equal(started, true);
  const native = new URL(anchor.props.href.replace(/^intent:/, 'doixp:').split('#')[0]);
  const request = { id: native.searchParams.get('id'), token: native.searchParams.get('token') };
  document.visibilityState = 'hidden';
  await f.read(request);
  document.dispatchEvent(new Event('visibilitychange'));
  await new Promise(setImmediate);
  assert.deepEqual(delivered, []);
  document.visibilityState = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
  await acceptance;
  assert.deepEqual(delivered, [{ uid: '00A224B1C2D380', payload: '' }]);
  window.dispatchEvent(new Event('focus'));
  t.mock.timers.tick(6000);
  await new Promise(setImmediate);
  assert.equal(delivered.length, 1);
  cleanups.pop()();
  await cancellation;
  assert.equal((await f.read(request)).status, 410);
});
