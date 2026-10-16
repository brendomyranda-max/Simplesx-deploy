import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import * as plataforma from '../src/lib/pda-plataforma.js';

const require = createRequire(import.meta.url);
const bootstrap = readFileSync(new URL('../public/pwa-manifest.js', import.meta.url), 'utf8');
const store = transformSync(readFileSync(new URL('../src/lib/pda-instalacao.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code;

function ambiente(path, semIcone = false) {
  const window = new EventTarget();
  window.location = { pathname: path };
  window.matchMedia = () => ({ matches: false, addEventListener() {} });
  const manifest = {
    href: '/manifest.webmanifest',
    getAttribute() { return this.href; },
    setAttribute(_, value) { this.href = value; },
  };
  const titulo = {};
  const icone = {};
  const document = new EventTarget();
  document.querySelector = selector => selector.includes('manifest') ? manifest : selector.includes('meta') ? titulo : semIcone ? null : icone;
  document.documentElement = {};
  const context = vm.createContext({ window, document, navigator: { userAgent: 'Chrome/155 Linux' }, Event, console });
  vm.runInContext(bootstrap, context);
  return {
    window, manifest, titulo, icone,
    carregarStore() {
      context.module = { exports: {} };
      context.exports = context.module.exports;
      context.require = name => name === 'react'
        ? { useSyncExternalStore: (_, getSnapshot) => getSnapshot() }
        : plataforma;
      vm.runInContext(store, context);
      return context.module.exports;
    },
  };
}

function eventoInstalacao(prompt = () => Promise.resolve(), outcome = 'dismissed') {
  const evento = new Event('beforeinstallprompt', { cancelable: true });
  evento.prompt = prompt;
  evento.userChoice = Promise.resolve({ outcome });
  return evento;
}

for (const [path, app, manifesto] of [
  ['/gestor', 'gestor', '/manifest-gestor.webmanifest'],
  ['/login', 'gestor', '/manifest-gestor.webmanifest'],
  ['/dashboard', 'gestor', '/manifest-gestor.webmanifest'],
  ['/pedido', 'marketplace', '/manifest-marketplace.webmanifest'],
  ['/pedido/loja/acompanhar/chave', 'marketplace', '/manifest-marketplace.webmanifest'],
  ['/', 'portal', '/manifest.webmanifest'],
]) {
  test(`seleciona o PDA correto em ${path} antes do React`, () => {
    const env = ambiente(path);
    assert.equal(env.window.doixpPwa.app, app);
    assert.equal(env.manifest.href, manifesto);
  });
}

test('ícone do Marketplace não causa exceção mesmo quando o elemento não existe', () => {
  assert.doesNotThrow(() => ambiente('/pedido', true));
  assert.equal(ambiente('/pedido').icone.href, '/icons/marketplace-192.png');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('rel="apple-touch-icon"') < html.indexOf('src="/pwa-manifest.js?'));
  assert.ok(html.indexOf('src="/pwa-manifest.js?') < html.indexOf('src="/src/main.tsx"'));
});

for (const path of ['/gestor', '/pedido']) {
  test(`guarda evento anterior ao React e chama prompt no mesmo clique uma única vez: ${path}`, async () => {
    const env = ambiente(path);
    let chamadas = 0;
    const evento = eventoInstalacao(() => { chamadas++; return Promise.resolve(); }, 'accepted');
    env.window.dispatchEvent(evento);
    assert.equal(evento.defaultPrevented, true);
    const api = env.carregarStore();
    assert.equal(api.usePdaInstalacao().podeInstalar, true);
    const pedido = api.instalarPda();
    assert.equal(chamadas, 1, 'prompt deve ser chamado antes de retornar a Promise');
    assert.equal(api.instalarPda(), pedido, 'clique duplicado compartilha o mesmo pedido');
    assert.equal(api.usePdaInstalacao().podeInstalar, false);
    assert.equal(await pedido, 'aceito');
    assert.equal(api.usePdaInstalacao().instalado, false, 'aceitar não equivale ao evento appinstalled');
    env.window.dispatchEvent(new Event('appinstalled'));
    assert.equal(api.usePdaInstalacao().instalado, true);
    assert.equal(env.window.doixpPwa.promptEvent, null);
  });
}

test('recebe autorização depois do carregamento e permite novo evento após cancelar', async () => {
  const env = ambiente('/pedido');
  const api = env.carregarStore();
  assert.equal(await api.instalarPda(), 'indisponivel');
  env.window.dispatchEvent(eventoInstalacao());
  assert.equal(api.usePdaInstalacao().podeInstalar, true);
  assert.equal(await api.instalarPda(), 'recusado');
  assert.equal(api.usePdaInstalacao().instalado, false);
  assert.equal(await api.instalarPda(), 'indisponivel');
  env.window.dispatchEvent(eventoInstalacao());
  assert.equal(api.usePdaInstalacao().podeInstalar, true);
});

test('falhas síncronas e assíncronas não reutilizam evento consumido nem indicam sucesso', async () => {
  for (const prompt of [() => { throw new Error('bloqueado'); }, () => Promise.reject(new Error('bloqueado'))]) {
    const env = ambiente('/gestor');
    const api = env.carregarStore();
    env.window.dispatchEvent(eventoInstalacao(prompt));
    assert.equal(await api.instalarPda(), 'indisponivel');
    assert.equal(api.usePdaInstalacao().podeInstalar, false);
    assert.equal(api.usePdaInstalacao().instalado, false);
  }
});

test('os PDAs mantêm identidades, destinos e ícones válidos separados', () => {
  for (const [app, inicio] of [['gestor', '/gestor'], ['marketplace', '/pedido']]) {
    const manifest = JSON.parse(readFileSync(new URL(`../public/manifest-${app}.webmanifest`, import.meta.url), 'utf8'));
    assert.equal(manifest.id, inicio);
    assert.equal(manifest.start_url, inicio);
    for (const tamanho of [192, 512]) {
      const icon = manifest.icons.find(icon => icon.sizes === `${tamanho}x${tamanho}`);
      const png = readFileSync(new URL(`../public${icon.src}`, import.meta.url));
      assert.equal(png.readUInt32BE(16), tamanho);
      assert.equal(png.readUInt32BE(20), tamanho);
    }
  }
});

test('pop-up inicial oferece os dois PDAs; cada aplicativo tem seu botão nativo', () => {
  const source = transformSync(readFileSync(new URL('../src/components/InstallPrompt.tsx', import.meta.url), 'utf8'), { loader: 'tsx', jsx: 'automatic', format: 'cjs' }).code;
  for (const [path, app] of [['/', 'portal'], ['/gestor', 'gestor'], ['/pedido', 'marketplace']]) {
    const module = { exports: {} };
    vm.runInNewContext(source, {
      module, exports: module.exports,
      require: name => name === 'react-router-dom' ? { useLocation: () => ({ pathname: path }) }
        : name === '@/lib/pda-instalacao' ? { usePdaInstalacao: () => ({ app, instalado: false, podeInstalar: true, plataforma: 'linux', compativel: true, passos: [] }) }
          : require(name),
    });
    const html = require('react-dom/server').renderToStaticMarkup(require('react').createElement(module.exports.InstallPrompt));
    if (app === 'portal') {
      assert.match(html, /href="\/pedido"/);
      assert.match(html, /href="\/gestor"/);
    } else {
      assert.match(html, />Instalar PDA<\/button>/);
      assert.match(html, new RegExp(`Instalar PDA ${app === 'gestor' ? 'Gestor' : 'Marketplace'}`));
    }
  }
});
