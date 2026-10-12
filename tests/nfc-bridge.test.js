import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const asModule = (source) => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString('base64');

test('ponte web recebe evento Android sem foco HTML e retira espera antes de uma segunda leitura', async (t) => {
  const cleanups = [];
  const identified = [];
  const received = [];
  t.after(() => cleanups.reverse().forEach((fn) => fn()));
  const globals = {
    window: new EventTarget(), document: Object.assign(new EventTarget(), { visibilityState: 'visible', hasFocus: () => false }),
    __nfcEffects: (fn) => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup); },
    __nfcIdentify: async (uid) => { identified.push(uid); return { id: identified.length, uid, origem: 'android-local', payload: '' }; },
  };
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
  }
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false }));
  t.mock.timers.enable({ apis: ['setInterval'] });
  const react = asModule('export const useRef = (v) => ({current:v}); export const useEffect = (fn) => globalThis.__nfcEffects(fn);');
  const api = asModule('export const nfcApi = { identificar: (uid) => globalThis.__nfcIdentify(uid), pendentes: async () => [], consumir: async () => { throw new Error("fila indevida"); } };');
  const cups = asModule('export const CUPS_SERVER = "http://127.0.0.1:3002";');
  const delivery = asModule(readFileSync('src/lib/nfcDelivery.ts', 'utf8'));
  const bridge = readFileSync('src/lib/useNfcBridge.ts', 'utf8')
    .replace("'react'", JSON.stringify(react)).replace("'@/lib/api'", JSON.stringify(api))
    .replace("'@/lib/cupsPrint'", JSON.stringify(cups)).replace("'./nfcDelivery'", JSON.stringify(delivery));
  const { useNfcBridge, useNfcLeitura } = await import(asModule(bridge));
  useNfcBridge(() => {});
  const emit = (uid) => window.dispatchEvent(new CustomEvent('doixp:android-nfc', { detail: { uid, lidoEm: Date.now() } }));
  emit('00A224B1C2D380'); // leitura antes da ação
  assert.deepEqual(identified, []);
  useNfcLeitura(true, (e) => received.push(e.uid));
  await new Promise(setImmediate);
  assert.deepEqual(received, ['00A224B1C2D380']);
  emit('04A224B1C2D380');
  await new Promise(setImmediate);
  assert.equal(identified.length, 1); // espera retirada sincronamente
  useNfcLeitura(true, (e) => received.push(e.uid));
  await new Promise(setImmediate);
  assert.deepEqual(received, ['00A224B1C2D380', '04A224B1C2D380']);

  // PDV mantém recepção contínua, até abrir pagamento ou comprovante.
  useNfcLeitura(true, (e) => received.push(e.uid), true);
  emit('00112233');
  await new Promise(setImmediate);
  emit('44556677');
  await new Promise(setImmediate);
  assert.deepEqual(received.slice(-2), ['00112233', '44556677']);
  const stopPdv = cleanups.pop();
  stopPdv();
  emit('8899AABB');
  await new Promise(setImmediate);
  assert.equal(identified.length, 4);
});
