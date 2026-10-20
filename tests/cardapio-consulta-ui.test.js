import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

test('cliente consulta detalhes sem controles de pedido e volta a usar sacola no delivery', async (t) => {
  const loja = { slug: 'casa', nome: 'Casa', ativo: 1, aceita_pedidos_online: 0, aceita_entrega: 1, aceita_retirada: 1, taxa_entrega: 5 };
  const catalogo = [{
    id: 1, nome: 'Prato da casa', descricao: 'Arroz e feijão', preco: 27, foto_url: '/prato.jpg',
    categoria_nome: 'Pratos', disponivel: 1, ativo: 1, vendidos: 0,
    opcoes: [{ id: 2, nome: 'Ovo', tipo: 'adicional', preco_adicional: 3 }],
  }];
  const states = [];
  let index = 0;
  const harness = {
    state(initial) {
      const i = index++;
      if (!(i in states)) states[i] = i === 0 ? loja : i === 1 ? catalogo : initial === 'carregando' ? 'pronto' : typeof initial === 'function' ? initial() : initial;
      return [states[i], (value) => { states[i] = typeof value === 'function' ? value(states[i]) : value; }];
    },
    node(type, props, ...children) {
      const allProps = { ...props, children };
      return typeof type === 'function' ? type(allProps) : { type, props: allProps };
    },
  };
  globalThis.__menuUi = harness;
  t.after(() => { delete globalThis.__menuUi; });
  const module = (source) => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText.replaceAll('React.createElement', '__menuUi.node').replaceAll('React.Fragment', 'Fragment')).toString('base64');
  const mocks = {
    react: 'export const useState=__menuUi.state,useEffect=()=>{},useMemo=fn=>fn(),useRef=()=>({current:null});',
    'react-router-dom': 'export const Link="Link",useNavigate=()=>()=>{},useParams=()=>({slug:"casa"}),useSearchParams=()=>[new URLSearchParams()];',
    'lucide-react': 'export const ArrowLeft="ArrowLeft",ChevronRight="ChevronRight",Flame="Flame",Heart="Heart",MapPin="MapPin",Minus="Minus",Plus="Plus",Search="Search",ShoppingBag="ShoppingBag",Settings2="Settings2",Store="Store",X="X",Check="Check",Bike="Bike",BookOpen="BookOpen",CreditCard="CreditCard",Eye="Eye",UtensilsCrossed="UtensilsCrossed",PackagePlus="PackagePlus";',
    qrcode: 'export const toDataURL=()=>{};',
    '@/lib/format': 'export const fmtBRL=v=>"R$ "+v.toFixed(2);',
    '@/lib/delivery-cliente': 'export const gravarUltimoPedido=()=>{},lerUltimoPedido=()=>__menuUi.lastOrder||null,SUPORTE_DOIXP_URL="https://wa.me/5511939417895",whatsappDaLoja=()=>null;',
    '@/lib/api': 'export const authApi={},onlineApi={},onlinePublicApi={},produtoApi={};',
    '@/lib/localizacao-cliente': 'export const lerPontoCliente=()=>null,taxaDaSacola=()=>5,textoEntrega=()=>"Entrega",fmtKm=String,previaEntrega=()=>"",textoCobrancaCliente=()=>"";',
    '@/pages/Marketplace': 'export const Marketplace="Marketplace";',
    '@/components/BrandLogo': 'export const BrandLogo="BrandLogo";',
    '@/components/FotoGaleria': 'export const FotoGaleria="FotoGaleria";',
    '@/components/FuncionamentoDelivery': 'export const FuncionamentoDelivery="FuncionamentoDelivery";',
    '@/components/ModoCardapioOnline': 'export const ConfiguracaoCardapioOnline="ConfiguracaoCardapioOnline";',
    '@/lib/descricao-composto': 'export const descricaoComIngredientes=()=>"";',
    '@/components/AcrescimoCadastro': 'export const AcrescimoCadastro="AcrescimoCadastro",lerAcrescimos=()=>({itens:[]});',
    '@/components/ComboFields': 'export const ComboEscolha="ComboEscolha",adicionalCombo=()=>0,comboCompleto=()=>true,resumoEscolhasCombo=()=>"";',
  };
  let source = readFileSync('src/pages/OnlineStorefront.tsx', 'utf8').replace("import './online-storefront.css';", '');
  source = source.replace("'../../shared/categorias-delivery.js'", JSON.stringify(new URL('../shared/categorias-delivery.js', import.meta.url).href));
  for (const [name, mock] of Object.entries(mocks)) source = source.replaceAll(`'${name}'`, JSON.stringify(module(mock)));
  source = 'const Fragment="Fragment";\n' + source + '\nexport { LojaOnline };';
  const { LojaOnline } = await import(module(source));
  const render = () => { index = 0; return LojaOnline(); };
  const nodes = (node) => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === 'object' ? [node, ...nodes(node.props.children)] : [];
  const text = (node) => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props.children) : node == null || node === false ? '' : String(node);
  const find = (tree, predicate) => {
    const found = nodes(tree).find(predicate);
    assert.ok(found, 'controle esperado está visível');
    return found;
  };
  let tree = render();
  assert.match(text(tree), /Prato da casa/);
  assert.match(text(tree), /R\$ 27.00/);
  assert.equal(nodes(tree).some((node) => /online-cart-trigger|online-mobile-cart/.test(node.props.className || '')), false);
  assert.equal(nodes(tree).some((node) => node.props.className === 'online-address'), false);
  find(tree, (node) => node.props['aria-label'] === 'Ver detalhes de Prato da casa').props.onClick();
  tree = render();
  assert.match(text(tree), /DETALHES DO PRODUTO/);
  assert.match(text(tree), /Ovo/);
  assert.equal(nodes(tree).some((node) => ['input', 'textarea'].includes(node.type) && node.props.type === 'checkbox'), false);
  assert.equal(nodes(tree).some((node) => node.props.className === 'online-add-button'), false);
  assert.equal(nodes(tree).some((node) => node.props.className === 'online-quantity'), false);

  find(tree, (node) => node.props['aria-label'] === 'Fechar').props.onClick();
  states[0] = { ...loja, aceita_pedidos_online: 1 };
  harness.lastOrder = '/pedido/casa/acompanhar/pedido-publico-0001';
  tree = render();
  find(tree, (node) => /online-cart-trigger/.test(node.props.className || '')).props.onClick();
  tree = render();
  assert.equal(find(tree, (node) => node.type === 'Link' && node.props.to === harness.lastOrder).props.children[0], 'Acompanhar meu pedido');
  find(tree, (node) => node.props['aria-label'] === 'Fechar sacola').props.onClick();
  harness.lastOrder = null;
  tree = render();
  find(tree, (node) => node.props['aria-label'] === 'Adicionar Prato da casa').props.onClick();
  tree = render();
  find(tree, (node) => node.props.className === 'online-add-button').props.onClick();
  tree = render();
  assert.match(text(tree), /Sua sacola/);
  assert.match(text(tree), /Prato da casa/);
  find(tree, (node) => node.props.className === 'online-checkout-button');
  find(tree, (node) => node.props['aria-label'] === 'Fechar sacola').props.onClick();
  // Pausar após o cliente abrir o cardápio conserva o produto e bloqueia compra.
  states[1] = [{ ...catalogo[0], disponivel: 0 }];
  tree = render();
  assert.match(text(tree), /Prato da casa/);
  assert.match(text(tree), /Indisponível/);
  assert.equal(find(tree, (node) => node.props['aria-label'] === 'Prato da casa indisponível').props.disabled, true);
  states[0] = { ...loja, aceita_pedidos_online: 0 };
  tree = render();
  assert.match(text(tree), /Indisponível/);
  find(tree, (node) => node.props['aria-label'] === 'Ver detalhes de Prato da casa').props.onClick();
  tree = render();
  assert.match(text(tree), /DETALHES DO PRODUTO/);
  assert.equal(nodes(tree).some((node) => node.props.className === 'online-add-button'), false);
  find(tree, (node) => node.props['aria-label'] === 'Fechar').props.onClick();
  // Fechamento por horário mantém a consulta e bloqueia a sacola existente.
  states[0] = { ...loja, aceita_pedidos_online: 1, aberta_agora: 0, motivo_fechado: 'Loja fechada neste horário.' };
  states[1] = catalogo;
  tree = render();
  assert.match(text(tree), /Loja fechada neste horário/);
  find(tree, (node) => /online-cart-trigger/.test(node.props.className || '')).props.onClick();
  tree = render();
  assert.equal(find(tree, (node) => node.props.className === 'online-checkout-button').props.disabled, true);
});
