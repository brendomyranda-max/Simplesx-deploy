import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

test('estoque conserva a busca e aba atuais quando respostas chegam fora de ordem', async (t) => {
  const states = [], refs = [], deps = [], cleanups = [], effects = [], requests = [], errors = [];
  const timers = new Map();
  let si = 0, ri = 0, ei = 0, nextTimer = 0, configReads = 0, changes = 0, tree;
  const h = {
    state(initial) {
      const i = si++;
      if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
      return [states[i], (value) => { changes++; states[i] = typeof value === 'function' ? value(states[i]) : value; }];
    },
    ref(initial) { return refs[ri++] ||= { current: initial }; },
    effect(fn, next) {
      const i = ei++;
      if (!deps[i] || next.some((d, j) => d !== deps[i][j])) {
        deps[i] = next;
        effects.push(() => { cleanups[i]?.(); cleanups[i] = fn(); });
      }
    },
    node: (type, props, ...children) => ({ type, props: { ...props, children } }),
    list: (busca, local, tipo) => new Promise((resolve, reject) => requests.push({ busca, local, tipo, resolve, reject })),
    config: async () => { configReads++; return { nome: 'Loja' }; },
    toast: (kind, message) => errors.push({ kind, message }),
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  globalThis.__stockUi = h;
  t.after(() => { for (const fn of cleanups) fn?.(); delete globalThis.__stockUi; });
  const module = (source) => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText.replaceAll('React.createElement', '__stockUi.node')).toString('base64');
  const mocks = {
    react: 'export const useState=__stockUi.state,useRef=__stockUi.ref,useEffect=__stockUi.effect,useMemo=fn=>fn();',
    'react-router-dom': 'export const useSearchParams=()=>[new URLSearchParams()];',
    'lucide-react': 'export const Boxes="Boxes",Plus="Plus",Search="Search",Pencil="Pencil",Trash2="Trash2",PackageMinus="PackageMinus",ChefHat="ChefHat";',
    '@/components/AnimatedPage': 'export const AnimatedPage="AnimatedPage";',
    '@/components/ui': 'export const Badge="Badge",Button="Button",Card="Card",EmptyState="EmptyState",IconButton="IconButton",Input="Input",Select="Select",Modal="Modal",Field="Field",Spinner="Spinner",useConfirm=()=>()=>{},useToast=()=>__stockUi.toast;',
    '@/components/ProdutoForm': 'export const ProdutoForm="ProdutoForm";',
    '@/pages/OnlineCatalogPage': 'export const OnlineCatalogPage="OnlineCatalogPage";',
    '@/lib/api': 'export const produtoApi={list:__stockUi.list},estoqueApi={},configApi={get:__stockUi.config},categoriaApi={list:async()=>[]};',
    '@/lib/format': 'export const fmtBRL=v=>String(v??0),fmtNum=v=>String(v??0);',
    '@/lib/estoqueSync': 'export const avisarEstoqueAtualizado=()=>{};',
  };
  let source = readFileSync('src/pages/EstoquePage.tsx', 'utf8')
    .replaceAll('setTimeout(', '__stockUi.setTimeout(').replaceAll('clearTimeout(', '__stockUi.clearTimeout(');
  for (const [name, mock] of Object.entries(mocks)) source = source.replaceAll(`'${name}'`, JSON.stringify(module(mock)));
  const { EstoquePage } = await import(module(source));
  const render = () => { si = ri = ei = 0; tree = EstoquePage(); for (const fn of effects.splice(0)) fn(); };
  const flush = async () => { await new Promise(setImmediate); render(); };
  const runTimers = () => { const tasks = [...timers.values()]; timers.clear(); for (const fn of tasks) fn(); };
  const nodes = (n) => Array.isArray(n) ? n.flatMap(nodes) : n && typeof n === 'object' ? [n, ...nodes(n.props.children)] : [];
  const text = (n) => Array.isArray(n) ? n.map(text).join('') : n && typeof n === 'object' ? text(n.props.children) : n == null ? '' : String(n);
  const find = (type, label) => {
    const n = nodes(tree).find((n) => n.type === type && (!label || text(n) === label));
    assert.ok(n, `${type} ${label || ''}`);
    return n;
  };
  const product = (id, nome) => ({ id, nome, tipo: 'produto', ativo: 1, unidade: 'UN', estoque_atual: 2, estoque_minimo: 0, preco: 5, custo: 1 });
  const search = (value) => { find('Input').props.onChange({ target: { value } }); render(); runTimers(); };

  render(); runTimers();
  find('button', 'Produtos').props.onClick(); render(); runTimers();
  assert.deepEqual(requests.map((r) => r.tipo), [undefined, 'produto']);
  requests[1].resolve([product(2, 'Produto da aba atual')]); await flush();
  requests[0].resolve([product(1, 'Produto da aba antiga')]); await flush();
  assert.match(text(tree), /Produto da aba atual/);
  assert.doesNotMatch(text(tree), /Produto da aba antiga/);

  search('frango'); search('queijo');
  assert.deepEqual(requests.slice(2).map((r) => r.busca), ['frango', 'queijo']);
  requests[3].resolve([product(3, 'Queijo atual')]); await flush();
  requests[2].reject({ error: 'Erro da busca antiga' }); await flush();
  assert.match(text(tree), /Queijo atual/);
  assert.deepEqual(errors, [], 'falhas de buscas antigas não interrompem a consulta atual');
  assert.equal(configReads, 1, 'configuração é lida uma vez ao abrir a página');

  search('pendente');
  find('button', 'Delivery').props.onClick(); render(); runTimers();
  assert.ok(find('OnlineCatalogPage'));
  const changesOnDelivery = changes;
  requests[4].resolve([product(4, 'Resposta após mudar para delivery')]); await flush();
  assert.equal(changes, changesOnDelivery, 'retorno do estoque não altera a aba delivery');

  find('button', 'Produtos').props.onClick(); render(); runTimers();
  assert.equal(requests.length, 6);
  for (const fn of cleanups) fn?.();
  const changesOnUnmount = changes;
  requests[5].reject({ error: 'Erro após sair da página' });
  await new Promise(setImmediate);
  assert.equal(changes, changesOnUnmount, 'não atualiza estado após desmontar');
  assert.deepEqual(errors, []);
});
