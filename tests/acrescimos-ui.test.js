import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

test('cadastro de produto simples permite selecionar bebida e salva seu acréscimo', async (t) => {
  const prato = { id: 1, nome: 'Prato', tipo: 'produto', unidade: 'UN', ativo: 1, preco: 25, sem_vencimento: 1 };
  const lista = [
    prato,
    { id: 2, nome: 'Bife extra', tipo: 'insumo', ativo: 1, preco: 8 },
    { id: 3, nome: 'Refrigerante', tipo: 'produto', ativo: 1, preco: 6 },
    { id: 4, nome: 'Somente estoque', tipo: 'produto', ativo: 1, preco: null },
    { id: 5, nome: 'Inativo', tipo: 'produto', ativo: 0, preco: 7 },
    { id: 6, nome: 'Combo', tipo: 'combo', ativo: 1, preco: 50 },
  ];
  let index = 0, mount = true, saved, errors = [];
  const states = [], effects = [];
  const harness = {
    state(initial) {
      const i = index++;
      if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
      return [states[i], (value) => { states[i] = typeof value === 'function' ? value(states[i]) : value; }];
    },
    effect(fn) { if (mount) effects.push(fn); },
    node(type, props, ...children) {
      const p = { ...props, children };
      return typeof type === 'function' ? type(p) : { type, props: p };
    },
    api: {
      list: async () => lista,
      update: async (id, payload) => { saved = { id, ...payload }; return saved; },
    },
    toast: (type, message) => { if (type === 'error') errors.push(message); },
  };
  globalThis.__acrescimoUi = harness;
  t.after(() => { delete globalThis.__acrescimoUi; });
  const module = (source) => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText.replaceAll('React.createElement', '__acrescimoUi.node').replaceAll('React.Fragment', '"Fragment"')).toString('base64');
  const mocks = {
    react: 'export const useState=__acrescimoUi.state,useEffect=__acrescimoUi.effect,useMemo=fn=>fn();',
    'lucide-react': 'export const Plus="Plus",Trash2="Trash2",ScanBarcode="ScanBarcode",Boxes="Boxes",MessageSquare="MessageSquare",X="X",ChefHat="ChefHat";',
    '@/components/ui': 'export const Button="Button",Field="Field",Input="Input",Modal="Modal",Select="Select",Textarea="Textarea",Toggle="Toggle",useToast=()=>__acrescimoUi.toast;',
    '@/components/FotoGaleria': 'export const FotoGaleria="FotoGaleria";',
    '@/components/ComboFields': 'export const ComboCadastro="ComboCadastro";',
    '@/lib/descricao-composto': 'export const descricaoComIngredientes=()=>"";',
    '@/lib/format': 'export const fmtBRL=v=>"R$ "+Number(v).toFixed(2);',
    '@/lib/cmv': 'export const UNIDADES=["UN"],calcularCmv=()=>0,custoLinha=()=>0,unidadeCompativel=()=>true;',
    '@/lib/api': 'export const produtoApi=__acrescimoUi.api,categoriaApi={list:async()=>[]},fornecedorApi={list:async()=>[]},onlineApi={};',
  };
  const prepare = (source) => {
    for (const [name, mock] of Object.entries(mocks)) source = source.replaceAll(`'${name}'`, JSON.stringify(module(mock)));
    return source;
  };
  const extrasModule = module(prepare(readFileSync('src/components/AcrescimoCadastro.tsx', 'utf8')));
  const source = prepare(readFileSync('src/components/ProdutoForm.tsx', 'utf8')).replace("'@/components/AcrescimoCadastro'", JSON.stringify(extrasModule));
  const { ProdutoForm } = await import(module(source));
  const { lerAcrescimos } = await import(extrasModule);
  const render = () => { index = 0; return ProdutoForm({ open: true, produto: prato, onClose() {}, onSaved() {} }); };
  const nodes = (node) => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === 'object' ? [node, ...nodes(node.props.children)] : [];
  const find = (tree, predicate) => { const node = nodes(tree).find(predicate); assert.ok(node, 'controle esperado disponível'); return node; };
  render();
  mount = false;
  for (const effect of effects) effect();
  await new Promise((resolve) => setImmediate(resolve));
  let tree = render();
  const button = find(tree, (node) => node.type === 'Button' && node.props.children.includes('Adicionar acréscimo'));
  button.props.onClick();
  tree = render();
  const field = find(tree, (node) => node.type === 'Field' && node.props.label === 'Acréscimo de produto');
  const choices = nodes(field).filter((node) => node.type === 'option').map((node) => node.props.value);
  assert.deepEqual(choices, ['', 2, 3]);
  find(field, (node) => node.type === 'Select').props.onChange({ target: { value: '3' } });
  tree = render();
  await find(tree, (node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.deepEqual(errors, []);
  assert.equal(saved.tipo, 'produto');
  assert.deepEqual(saved.acrescimos, [{ insumo_id: 3, valor: 6 }]);
  assert.match(lerAcrescimos([{ insumo_id: 4, nome: 'Somente estoque', preco: 10 }], lista).erro, /preço de venda/);
});
