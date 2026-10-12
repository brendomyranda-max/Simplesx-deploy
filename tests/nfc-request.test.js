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
  const call = (path, body, token = 'sessao-1', method = 'POST', headers = {}) => handle({
    req: { path, method, json: async () => body, query: () => undefined,
      header: (name) => headers[name] ?? (name === 'cookie' ? `simplesx_session=${token}` : undefined) },
    json: (data, status = 200) => ({ data, status }),
  }, { DB });
  const create = async () => (await call('/api/nfc/solicitacoes', {})).data;
  const read = (r, uid = '00A224B1C2D380', overrides = {}) => call(`/api/nfc/solicitacoes/${r.id}/leitura`, { token: r.token, uid, ...overrides }, '');
  const status = (r, token) => call(`/api/nfc/solicitacoes/${r.id}`, null, token, 'GET');
  return { DB, call, create, read, status };
}

async function remoteFixture(t) {
  const f = await fixture(t);
  const now = new Date().toISOString();
  for (const [id, loja] of [['s21', 1], ['pda', 1], ['outra-loja', 2]]) {
    f.DB.prepare(`INSERT INTO devices (id,estabelecimento_id,nome,plataforma,token_hash,token_expira_em,status,ultima_conexao,criado_em,atualizado_em)
      VALUES (?,?,?,'android',?,'2099-01-01','online',?,?,?)`).bind(id, loja, id, await sha256(`device-${id}`), now, now, now).run();
  }
  f.DB.prepare(`INSERT INTO gestores (id,token,nome,ativo,estabelecimento_id,sessao_id,ultima_conexao)
    VALUES (1,'pc-token','Caixa PC',1,1,'pc-session',?)`).bind(now).run();
  return { ...f,
    request: async (id = 's21', tipo = 'android', session = 'sessao-1') => f.call('/api/nfc/solicitacoes', { servidor_tipo: tipo, servidor_id: id }, session),
    publish: (id = 's21', uid = '00A224B1C2D380', extras = {}) => f.call('/api/device/nfc', { uid, ...extras }, '', 'POST', { authorization: `Bearer device-${id}`, 'x-device-id': id }),
    received: (id, event) => f.call('/api/device/nfc/status', { evento_id: event }, '', 'POST', { authorization: `Bearer device-${id}`, 'x-device-id': id }),
  };
}

test('servidores NFC usam o pareamento da impressão e a lista não expõe credenciais nem outra loja', async (t) => {
  const f = await remoteFixture(t);
  const result = await f.call('/api/nfc/servidores', null, 'sessao-1', 'GET');
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.map((s) => `${s.tipo}:${s.id}`).sort(), ['android:pda', 'android:s21', 'desktop:1']);
  assert.ok(result.data.every((s) => s.online && !('token' in s) && !('token_hash' in s)));
  assert.equal((await f.request('outra-loja')).status, 404);
  assert.equal((await f.request('s21', 'android', 'sessao-2')).status, 404);
  assert.equal((await f.request('s21', 'evil')).status, 400);
});

test('S21 → web de outro aparelho → pedido salvo uma vez; outro servidor/tela não captura a leitura', async (t) => {
  const f = await remoteFixture(t);
  const a = (await f.request()).data;
  const b = (await f.request('pda', 'android', 'sessao-3')).data;
  assert.equal((await f.publish('s21', '00112233', { servidor_id: 'pda', estabelecimento_id: 2 })).status, 200);
  assert.equal((await f.status(b, 'sessao-3')).data.estado, 'aguardando');
  assert.deepEqual((await f.call('/api/nfc/eventos', null, 'sessao-1', 'GET')).data, []);
  const event = f.DB.prepare('SELECT id FROM nfc_eventos').first().id;
  assert.equal((await f.received('s21', event)).data.recebido_pelo_terminal, false);
  const result = (await f.status(a)).data;
  assert.equal(result.uid, '00112233');
  assert.equal((await f.received('s21', event)).data.recebido_pelo_terminal, true);
  assert.equal((await f.status(a, 'sessao-3')).status, 404);
  const product = f.DB.prepare("INSERT INTO produtos (estabelecimento_id,nome,preco,ativo) VALUES (1,'Cartão pela internet',12,1)").run();
  const body = { ...result, acao: 'lancar', chave: 'pedido-remoto-unico', itens: [{ produto_id: product.meta.last_row_id, quantidade: 2 }] };
  assert.equal((await f.call('/api/cartoes/usar', body)).status, 200);
  assert.equal((await f.call('/api/cartoes/usar', body)).status, 200);
  assert.equal(f.DB.prepare('SELECT COUNT(*) n FROM comanda_itens').first().n, 1);
});

test('computador → web/PDA usa a sessão do servidor e reserva exclusivamente a tela solicitante', async (t) => {
  const f = await remoteFixture(t);
  const r = (await f.request('1', 'desktop')).data;
  assert.equal((await f.read(r)).status, 401, 'Capacidade do leitor local não pode substituir o servidor selecionado');
  const published = await f.call('/api/gestor/nfc', { token: 'pc-token', session_id: 'pc-session', uid: '00112233' }, '');
  assert.equal(published.status, 200);
  assert.equal((await f.status(r)).data.uid, '00112233');
  assert.deepEqual((await f.call('/api/nfc/eventos', null, 'sessao-3', 'GET')).data, []);
  assert.equal((await f.call('/api/gestor/nfc', { token: 'pc-token', session_id: 'errada', uid: '44556677' }, '')).status, 401);
});

test('um leitor aceita uma espera; cancelar/expirar libera outra tela e respostas concorrentes têm um vencedor', async (t) => {
  const f = await remoteFixture(t);
  const attempts = await Promise.all([f.request(), f.request('s21', 'android', 'sessao-3')]);
  assert.deepEqual(attempts.map((a) => a.status).sort(), [200, 409]);
  const index = attempts.findIndex((a) => a.status === 200);
  const active = attempts[index].data;
  await f.call(`/api/nfc/solicitacoes/${active.id}`, {}, index ? 'sessao-3' : 'sessao-1', 'DELETE');
  const next = (await f.request()).data;
  await Promise.all([f.publish('s21', '00112233'), f.publish('s21', '44556677')]);
  assert.ok(['00112233', '44556677'].includes((await f.status(next)).data.uid));
  assert.deepEqual((await f.call('/api/nfc/eventos', null, 'sessao-3', 'GET')).data, []);
  const expired = (await f.request()).data;
  f.DB.prepare('UPDATE nfc_solicitacoes SET expira_em=? WHERE id=?').bind(new Date(Date.now() - 1000).toISOString(), expired.id).run();
  assert.equal((await f.request('s21', 'android', 'sessao-3')).status, 200);
});

test('leituras rápidas de servidores diferentes e uma nova espera com o mesmo cartão não se confundem', async (t) => {
  const f = await remoteFixture(t);
  const a = (await f.request()).data;
  const b = (await f.request('pda')).data;
  await f.publish(); await f.publish('pda');
  assert.equal((await f.status(a)).data.uid, '00A224B1C2D380');
  assert.equal((await f.status(b)).data.uid, '00A224B1C2D380');
  const next = (await f.request()).data;
  await f.publish();
  assert.equal((await f.status(next)).data.uid, '00A224B1C2D380');
  const repeat = await f.publish();
  assert.equal(repeat.data.duplicate, true);
  assert.deepEqual((await f.call('/api/nfc/eventos', null, 'sessao-1', 'GET')).data, []);
});

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

for (const mode of ['native', 'remote', 'multi', 'web', 'integrated']) test({
  native: 'navegador sem Web NFC mantém alternativa de leitura pelo aplicativo Android',
  remote: 'web no computador identifica automaticamente o S21 e recebe sem foco na janela',
  multi: 'vários servidores conectados: leitor ocupado é preservado e a próxima tela usa outro leitor livre',
  web: 'Chrome Android lê NFC direto na web e salva o pedido sem pareamento nem abertura de aplicativo',
  integrated: 'tela interna identifica o leitor integrado automaticamente sem solicitar outro aplicativo',
}[mode], async (t) => {
  const remote = mode === 'remote' || mode === 'multi';
  const web = mode === 'web';
  const f = remote ? await remoteFixture(t) : await fixture(t);
  if (mode === 'multi') await f.request('s21', 'android', 'sessao-3');
  const effects = [];
  const cleanups = [];
  const states = [];
  let slot = 0;
  let started = false;
  const delivered = [];
  const apiCalls = [];
  let order;
  class Reader extends EventTarget {
    calls = 0;
    scan({ signal }) { this.calls++; this.signal = signal; return Promise.resolve(); }
    read() { this.dispatchEvent(Object.assign(new Event('reading'), { serialNumber: '00:a2:24:b1:c2:d3:80' })); }
  }
  let created;
  const creation = new Promise((resolve) => { created = resolve; });
  let accepted;
  const acceptance = new Promise((resolve) => { accepted = resolve; });
  let cancelled;
  const cancellation = new Promise((resolve) => { cancelled = resolve; });
  t.after(() => cleanups.reverse().forEach((fn) => fn?.()));
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible', hasFocus: () => false });
  const globals = {
    window: Object.assign(new EventTarget(), { location: { origin: 'https://doixp.com' } }),
    document, navigator: { userAgent: remote ? 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0' : `Mozilla/5.0 (Linux; Android 15; Samsung S21${mode === 'integrated' ? '; wv' : ''}) Chrome/140.0` },
    localStorage: { getItem: () => null, setItem: () => {} },
    __scanState: (initial) => { const index = slot++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial; return [states[index], (v) => { states[index] = typeof v === 'function' ? v(states[index]) : v; }]; },
    __scanEffect: (fn) => effects.push(fn),
    __scanApi: {
      servidores: async () => { apiCalls.push('servers'); return remote ? [{ tipo: 'android', id: 's21', nome: 'S21', online: true }, ...(mode === 'multi' ? [{ tipo: 'android', id: 'pda', nome: 'PDA', online: true }] : [])] : []; },
      solicitar: async (source) => {
        apiCalls.push(source?.id || 'native');
        const result = source ? await f.request(source.id, source.tipo) : { status: 200, data: await f.create() };
        if (result.status >= 400) throw { ...result.data, status: result.status };
        created(); return result.data;
      },
      solicitacao: async (id) => (await f.status({ id })).data,
      cancelarSolicitacao: async (id) => { const result = await f.call(`/api/nfc/solicitacoes/${id}`, null, 'sessao-1', 'DELETE'); cancelled(); return result; },
    },
  };
  globals.window.top = globals.window;
  globals.window.isSecureContext = true;
  if (web) globals.window.NDEFReader = Reader;
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
  const api = module(`export const nfcApi = globalThis.__scanApi; // mode:${mode}`);
  const ui = module('export const Button = () => {};');
  const linkModule = module(readFileSync('src/lib/nfcScanLink.ts', 'utf8'));
  const webNfcModule = module(readFileSync('src/lib/webNfc.ts', 'utf8'));
  const source = readFileSync('src/components/NfcScanButton.tsx', 'utf8')
    .replace("'react'", JSON.stringify(react)).replace("'@/lib/api'", JSON.stringify(api))
    .replace("'@/components/ui'", JSON.stringify(ui)).replace("'@/lib/nfcScanLink'", JSON.stringify(linkModule))
    .replace("'@/lib/webNfc'", JSON.stringify(webNfcModule));
  const { NfcScanButton } = await import(module(source, true));
  const webReader = web ? new Reader() : null;
  const { createWebNfcScan } = await import(webNfcModule);
  const webScan = web ? createWebNfcScan(webReader, () => document.visibilityState === 'visible') : null;
  const product = web && f.DB.prepare("INSERT INTO produtos (estabelecimento_id,nome,preco,ativo) VALUES (1,'Pedido Web NFC',10,1)").run();
  const props = { enabled: true, webScan, onStart: (exclusive) => { started = exclusive !== false; }, onRead: (reading) => {
    delivered.push(reading); accepted();
    if (web) order = f.call('/api/cartoes/usar', { ...reading, acao: 'lancar', chave: 'pedido-web-direto', itens: [{ produto_id: product.meta.last_row_id, quantidade: 2 }] });
  } };
  NfcScanButton(props);
  if (!web && mode !== 'integrated') {
    cleanups.push(effects[1]()); // Lista os servidores antes da escolha automática.
    await new Promise(setImmediate);
    effects.length = 0;
    slot = 0;
    NfcScanButton(props);
  }
  cleanups.push(effects.shift()());
  if (mode === 'integrated') {
    assert.equal(started, false, 'O leitor nativo integrado usa a ponte existente');
    assert.deepEqual(apiCalls, []);
    return;
  }
  if (!web) await creation;
  await new Promise(setImmediate);
  slot = 0;
  const tree = NfcScanButton(props);
  const anchor = tree.props.children.find((node) => node?.type === 'a');
  if (!remote && !web) {
    assert.ok(anchor, 'A solicitação deve preparar o link de leitura');
    assert.ok(anchor.props.href.startsWith('intent://nfc/ler?'));
  } else assert.equal(anchor, undefined, 'Uma tela remota aguarda o servidor, sem tentar abrir um app neste computador');
  assert.equal(started, true);
  if (mode === 'multi') assert.deepEqual(apiCalls, ['servers', 's21', 'pda']);
  if (web) assert.deepEqual(apiCalls, [], 'A leitura web não consulta nem abre servidores');
  const native = !remote && !web && new URL(anchor.props.href.replace(/^intent:/, 'doixp:').split('#')[0]);
  const request = web ? null : remote ? f.DB.prepare('SELECT id FROM nfc_solicitacoes WHERE servidor_id=?').first(mode === 'multi' ? 'pda' : 's21')
    : { id: native.searchParams.get('id'), token: native.searchParams.get('token') };
  document.visibilityState = 'hidden';
  if (web) webReader.read();
  else if (remote) await f.publish(mode === 'multi' ? 'pda' : 's21'); else await f.read(request);
  document.dispatchEvent(new Event('visibilitychange'));
  await new Promise(setImmediate);
  assert.deepEqual(delivered, []);
  document.visibilityState = 'visible';
  if (web) webReader.read();
  document.dispatchEvent(new Event('visibilitychange'));
  await acceptance;
  assert.deepEqual(delivered, [{ uid: '00A224B1C2D380', payload: '' }]);
  window.dispatchEvent(new Event('focus'));
  t.mock.timers.tick(6000);
  await new Promise(setImmediate);
  assert.equal(delivered.length, 1);
  if (web) {
    assert.equal((await order).status, 200);
    assert.equal(f.DB.prepare('SELECT COUNT(*) n FROM comanda_itens').first().n, 1);
    for (const table of ['devices', 'nfc_solicitacoes', 'nfc_eventos']) assert.equal(f.DB.prepare(`SELECT COUNT(*) n FROM ${table}`).first().n, 0);
    return;
  }
  cleanups.pop()();
  await cancellation;
  assert.equal((await f.status(request)).data.estado, 'cancelado');
  if (!remote) assert.equal((await f.read(request)).status, 410);
});
