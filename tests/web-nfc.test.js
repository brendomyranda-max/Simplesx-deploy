import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = ts.transpileModule(readFileSync('src/lib/webNfc.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { createWebNfcScan, webNfcAvailable, startWebNfc } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

class Reader extends EventTarget {
  calls = 0;
  signal;
  scan({ signal }) { this.calls++; this.signal = signal; return Promise.resolve(); }
  read(serialNumber) {
    const event = new Event('reading');
    Object.defineProperties(event, {
      serialNumber: { value: serialNumber },
      message: { get: () => { throw new Error('O conteúdo NDEF não deve ser acessado'); } },
    });
    this.dispatchEvent(event);
  }
}

test('Web NFC começa no clique, normaliza o UID NTAG215 e ignora inteiramente o texto do cartão', async () => {
  const reader = new Reader();
  const scan = createWebNfcScan(reader, () => true);
  assert.equal(reader.calls, 1, 'O scan deve começar sincronamente, antes de um await/efeito React');
  await new Promise(setImmediate);
  assert.equal(scan.state().phase, 'ready');
  reader.read('00:a2:24:b1:c2:d3:80');
  assert.equal(scan.state().phase, 'read');
  assert.equal(scan.take(), '00A224B1C2D380');
  assert.equal(reader.signal.aborted, false, 'Mantém a captura enquanto o pedido é enviado');
  assert.equal(scan.take(), null);
  reader.read('11223344');
  assert.equal(scan.take(), null, 'A segunda notificação não pode salvar outro pedido');
  scan.close();
  assert.equal(reader.signal.aborted, true);
});

test('uma leitura que chega antes da montagem da tela fica disponível uma única vez', () => {
  const reader = new Reader();
  const scan = createWebNfcScan(reader, () => true);
  reader.read('00-11-22-33');
  const readings = [];
  const off = scan.subscribe(() => { const uid = scan.take(); if (uid) readings.push(uid); });
  off();
  scan.subscribe(() => { const uid = scan.take(); if (uid) readings.push(uid); });
  assert.deepEqual(readings, ['00112233']);
});

test('cancelamento e página invisível não entregam o cartão ao próximo atendimento', () => {
  const reader = new Reader();
  let visible = false;
  const scan = createWebNfcScan(reader, () => visible);
  reader.read('00112233');
  assert.equal(scan.take(), null);
  visible = true;
  reader.read('44556677');
  scan.close();
  assert.equal(scan.take(), null);
  reader.read('00112233');
  assert.equal(scan.take(), null);
  assert.equal(scan.state().phase, 'closed');
});

test('UID ausente ou inválido não vira identificação pelo texto NDEF; permite aproximar novamente', () => {
  const reader = new Reader();
  const scan = createWebNfcScan(reader, () => true);
  for (const value of ['', undefined, 'COMANDA-001', '123', 12345678]) {
    reader.read(value);
    assert.equal(scan.take(), null);
  }
  reader.dispatchEvent(new Event('readingerror'));
  assert.equal(scan.state().phase, 'ready');
  assert.equal(reader.signal.aborted, false);
  reader.read('00112233');
  assert.equal(scan.take(), '00112233');
});

test('permissão negada e aparelho incompatível mostram erro e não gravam pedido nem abrem outro aplicativo', async () => {
  for (const name of ['NotAllowedError', 'NotSupportedError', 'NotReadableError']) {
    const reader = new Reader();
    reader.scan = ({ signal }) => { reader.signal = signal; return Promise.reject(Object.assign(new Error('falha'), { name })); };
    const scan = createWebNfcScan(reader, () => true);
    await new Promise(setImmediate);
    assert.equal(scan.state().phase, 'error');
    assert.equal(scan.state().unavailable, name === 'NotSupportedError');
    assert.equal(scan.take(), null);
    assert.equal(reader.signal.aborted, true);
  }
});

test('detecta a API em HTTPS e na página principal, sem inferir suporte pela marca do aparelho', (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalDoc = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const window = { isSecureContext: true, NDEFReader: Reader };
  window.top = window;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { visibilityState: 'visible' } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'window', original); else delete globalThis.window;
    if (originalDoc) Object.defineProperty(globalThis, 'document', originalDoc); else delete globalThis.document;
  });
  assert.equal(webNfcAvailable(), true);
  assert.ok(startWebNfc());
  window.isSecureContext = false;
  assert.equal(startWebNfc(), null);
  window.isSecureContext = true;
  window.top = {};
  assert.equal(startWebNfc(), null);
  window.top = window;
  delete window.NDEFReader;
  assert.equal(startWebNfc(), null);
});
