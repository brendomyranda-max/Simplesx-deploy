import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const PONTO_A = { latitude: -23.55052, longitude: -46.633308, endereco: 'Rua A, Centro, São Paulo', origem: 'endereco' };
const PONTO_B = { latitude: -23.562345678901, longitude: -46.654321098765, endereco: 'Rua B, Bela Vista, São Paulo', origem: 'mapa', atualizado_em: Date.now() };

async function checkout(t, guardado = PONTO_A, loja = {}, cliente = null) {
  const states = [], refs = [], depsAnteriores = [], cleanups = [];
  const distancias = [], enviados = [], salvos = [], perfis = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0, effects = [], tree;
  let limpezas = 0;
  const h = {
    clienteState: { cliente, carregando: false, definir: (value) => { h.clienteState.cliente = value; } },
    atualizarCliente: async (data) => { perfis.push(data); return { ...cliente, ...data }; },
    state(initial) {
      const i = stateIndex++;
      if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
      return [states[i], (value) => { states[i] = typeof value === 'function' ? value(states[i]) : value; }];
    },
    ref(initial) { const i = refIndex++; return refs[i] ||= { current: initial }; },
    effect(fn, deps) {
      const i = effectIndex++;
      if (!depsAnteriores[i] || !deps || deps.some((value, j) => !Object.is(value, depsAnteriores[i][j]))) {
        depsAnteriores[i] = deps;
        effects.push(() => { cleanups[i]?.(); cleanups[i] = fn(); });
      }
    },
    node(type, props, ...children) { return { type, props: { ...props, children } }; },
    lerPonto: () => guardado,
    gravarPonto: (ponto) => salvos.push(ponto),
    limparPonto: () => { limpezas++; },
    distance(slug, params) {
      return new Promise((resolve, reject) => distancias.push({ slug, params, resolve, reject }));
    },
  };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, '__checkoutLocationUi');
  Object.defineProperty(globalThis, '__checkoutLocationUi', { value: h, configurable: true });
  t.after(() => {
    for (const cleanup of cleanups) cleanup?.();
    if (descriptor) Object.defineProperty(globalThis, '__checkoutLocationUi', descriptor);
    else delete globalThis.__checkoutLocationUi;
  });
  const runId = crypto.randomUUID();
  const module = (source) => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText.replaceAll('React.createElement', '__checkoutLocationUi.node').replaceAll('React.Fragment', 'Fragment')).toString('base64') + '#' + runId;
  const mocks = {
    react: 'export const useState=__checkoutLocationUi.state,useEffect=__checkoutLocationUi.effect,useMemo=fn=>fn(),useRef=__checkoutLocationUi.ref;',
    'react-router-dom': 'export const Link="Link",useNavigate=()=>()=>{},useParams=()=>({slug:"casa"}),useSearchParams=()=>[new URLSearchParams()];',
    'lucide-react': 'export const ArrowLeft="ArrowLeft",ChevronRight="ChevronRight",Flame="Flame",Heart="Heart",MapPin="MapPin",Minus="Minus",Plus="Plus",Search="Search",ShoppingBag="ShoppingBag",Settings2="Settings2",Store="Store",X="X",Check="Check",Bike="Bike",BookOpen="BookOpen",CreditCard="CreditCard",Eye="Eye",UtensilsCrossed="UtensilsCrossed",PackagePlus="PackagePlus";',
    qrcode: 'export const toDataURL=()=>{};',
    '@/lib/format': 'export const fmtBRL=v=>"R$ "+Number(v).toFixed(2);',
    '@/lib/delivery-cliente': 'export const gravarUltimoPedido=()=>{},lerUltimoPedido=()=>null,SUPORTE_DOIXP_URL="https://wa.me/5511939417895",whatsappDaLoja=()=>null;',
    '@/lib/api': 'export const authApi={},clienteApi={atualizar:__checkoutLocationUi.atualizarCliente},onlineApi={},produtoApi={},onlinePublicApi={distance:__checkoutLocationUi.distance,locate:()=>{throw Error("O checkout não deve geocodificar endereço já confirmado");}};',
    '@/lib/cliente-marketplace': 'export const useClienteMarketplace=()=>__checkoutLocationUi.clienteState,pontoDoPerfil=c=>c?.latitude!=null?{latitude:c.latitude,longitude:c.longitude,endereco:c.endereco,origem:"endereco"}:null;',
    '@/components/ContaCliente': 'export const ContaCliente="ContaCliente",ModalContaCliente="ModalContaCliente";',
    '@/lib/localizacao-cliente': 'export const lerPontoCliente=__checkoutLocationUi.lerPonto,gravarPontoCliente=__checkoutLocationUi.gravarPonto,limparPontoCliente=__checkoutLocationUi.limparPonto,taxaDaSacola=()=>5,textoEntrega=()=>"Entrega",fmtKm=String,previaEntrega=()=>"",textoCobrancaCliente=area=>area?.taxa_cliente==null?null:"Entrega R$ "+area.taxa_cliente.toFixed(2);',
    '@/components/SeletorLocalizacao': 'export const SeletorLocalizacao="SeletorLocalizacao";',
    '@/pages/Marketplace': 'export const Marketplace="Marketplace";',
    '@/components/BrandLogo': 'export const BrandLogo="BrandLogo";',
    '@/components/FotoGaleria': 'export const FotoGaleria="FotoGaleria";',
    '@/components/ModalidadesDelivery': 'export const ModalidadesDelivery="ModalidadesDelivery";',
    '@/components/FuncionamentoDelivery': 'export const FuncionamentoDelivery="FuncionamentoDelivery";',
    '@/components/ModoCardapioOnline': 'export const ConfiguracaoCardapioOnline="ConfiguracaoCardapioOnline";',
    '@/lib/descricao-composto': 'export const descricaoComIngredientes=()=>"";',
    '@/components/AcrescimoCadastro': 'export const AcrescimoCadastro="AcrescimoCadastro",lerAcrescimos=()=>({itens:[]});',
    '@/components/ComboFields': 'export const ComboEscolha="ComboEscolha",adicionalCombo=()=>0,comboCompleto=()=>true,resumoEscolhasCombo=()=>"";',
  };
  let source = readFileSync('src/pages/OnlineStorefront.tsx', 'utf8').replace("import './online-storefront.css';", '');
  source = source.replace("'@/lib/recursos-em-desenvolvimento'", JSON.stringify(module(readFileSync('src/lib/recursos-em-desenvolvimento.ts', 'utf8'))));
  source = source.replace("'../../shared/categorias-delivery.js'", JSON.stringify(new URL('../shared/categorias-delivery.js', import.meta.url).href));
  for (const [name, mock] of Object.entries(mocks)) source = source.replaceAll(`'${name}'`, JSON.stringify(module(mock)));
  const { CheckoutModal } = await import(module('const Fragment="Fragment";\n' + source + '\nexport { CheckoutModal };'));
  const props = {
    loja: { slug: 'casa', nome: 'Casa', aceita_entrega: 1, aceita_retirada: 1, taxa_entrega: 5, valor_por_km: 2, modo_entrega: 'cliente', ...loja },
    totalBase: 50, onClose() {}, onSubmit: async (dados) => { enviados.push(dados); },
  };
  const render = () => {
    stateIndex = refIndex = effectIndex = 0;
    tree = CheckoutModal(props);
    for (const fn of effects.splice(0)) fn();
    return tree;
  };
  const flush = async () => {
    for (let i = 0; i < 5; i++) { await Promise.resolve(); render(); }
  };
  const nodes = (node) => !node ? [] : Array.isArray(node) ? node.flatMap(nodes) : typeof node !== 'object' ? [] : [node, ...nodes(node.props?.children)];
  const text = (node) => node == null || node === false ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node);
  const find = (predicate) => {
    const node = nodes(tree).find(predicate);
    assert.ok(node, 'controle esperado está visível');
    return node;
  };
  const input = (label) => {
    const campo = find((node) => node.type === 'label' && text(node).startsWith(label));
    const controle = nodes(campo).find((node) => node.type === 'input');
    assert.ok(controle, `campo ${label}`);
    return controle;
  };
  const change = async (label, value) => { input(label).props.onChange({ target: { value } }); await flush(); };
  const selector = () => find((node) => node.type === 'SeletorLocalizacao');
  const button = () => find((node) => node.type === 'button' && node.props.type === 'submit');
  const submit = async () => { await find((node) => node.type === 'form').props.onSubmit({ preventDefault() {} }); await flush(); };
  const cotar = async (index, taxa) => {
    distancias[index].resolve({ taxa_cliente: taxa, distancia_km: 3.5, raio_entrega_km: 15, entrega_na_regiao: 1 });
    await flush();
  };
  const preencherCliente = async () => {
    await change('Seu nome', 'Ana Souza');
    await change('WhatsApp', '11999990000');
    input('Maquininha').props.onChange();
    await flush();
  };
  render();
  await flush();
  return { distancias, enviados, salvos, perfis, limpezas: () => limpezas, render, flush, find, input, change, selector, button, submit, cotar, preencherCliente, text };
}

test('cliente conectado recupera dados e salva endereço no perfil ao finalizar', async (t) => {
  const cliente = { id: 1, nome: 'Ana Salva', telefone: '11999990000', endereco: PONTO_A.endereco, numero: '123', complemento: 'Casa', latitude: PONTO_A.latitude, longitude: PONTO_A.longitude };
  const f = await checkout(t, PONTO_A, {}, cliente);
  assert.equal(f.input('Seu nome').props.value, 'Ana Salva');
  assert.equal(f.input('WhatsApp').props.value, '11999990000');
  assert.equal(f.input('Número').props.value, '123');
  assert.equal(f.input('Complemento').props.value, 'Casa');
  await f.cotar(0, 5);
  f.input('Maquininha').props.onChange(); await f.flush();
  await f.change('Número', '456');
  await f.submit();
  assert.equal(f.perfis.length, 1);
  assert.equal(f.perfis[0].numero, '456');
  assert.equal(f.perfis[0].latitude, PONTO_A.latitude);
  assert.equal(f.enviados.length, 1);
  assert.match(f.enviados[0].endereco, /número 456, Casa/);
});

test('novo destino não reaproveita número e complemento de outro endereço salvo', async (t) => {
  const cliente = { id: 1, nome: 'Ana', telefone: '11999990000', endereco: PONTO_A.endereco, numero: '123', complemento: 'Casa', latitude: PONTO_A.latitude, longitude: PONTO_A.longitude };
  const f = await checkout(t, PONTO_B, {}, cliente);
  assert.equal(f.selector().props.endereco, PONTO_B.endereco);
  assert.equal(f.input('Número').props.value, '');
  assert.equal(f.input('Complemento').props.value, '');
});

test('checkout cota coordenadas confirmadas e resposta antiga não substitui o frete do novo ponto', async (t) => {
  const f = await checkout(t);
  assert.equal(f.distancias.length, 1);
  assert.deepEqual(f.distancias[0].params, { lat: PONTO_A.latitude, lng: PONTO_A.longitude, plataforma: false });
  assert.equal(f.distancias[0].slug, 'casa');
  assert.equal(Object.hasOwn(f.distancias[0].params, 'q'), false);

  f.selector().props.onEnderecoChange(PONTO_B.endereco);
  f.selector().props.onChange(PONTO_B);
  await f.flush();
  assert.equal(f.distancias.length, 2);
  assert.deepEqual(f.distancias[1].params, { lat: PONTO_B.latitude, lng: PONTO_B.longitude, plataforma: false });
  await f.cotar(1, 7);
  assert.match(f.text(f.button()), /R\$ 57\.00/);
  await f.cotar(0, 99);
  assert.match(f.text(f.button()), /R\$ 57\.00/);
  assert.doesNotMatch(f.text(f.button()), /149\.00/);

  await f.preencherCliente();
  await f.change('Número ou s/n', '120');
  await f.change('Complemento e referência', 'Apartamento 42, portão azul');
  assert.equal(f.distancias.length, 2, 'número e complemento preservam a cotação do ponto confirmado');
  assert.equal(f.button().props.disabled, false);
  await f.submit();
  assert.equal(f.enviados.length, 1);
  assert.deepEqual(f.enviados[0].ponto, PONTO_B);
  assert.equal(f.enviados[0].ponto.latitude, -23.562345678901);
  assert.equal(f.enviados[0].ponto.longitude, -46.654321098765);
  assert.equal(f.enviados[0].endereco, 'Rua B, Bela Vista, São Paulo, número 120, Apartamento 42, portão azul');
  assert.equal(f.enviados[0].nome, 'Ana Souza');
  assert.equal(f.enviados[0].pagamento, 'maquininha');
  assert.deepEqual(f.salvos, [PONTO_B]);
});

test('editar e invalidar endereço bloqueia envio mesmo com cotação anterior concluída', async (t) => {
  const f = await checkout(t);
  await f.cotar(0, 5);
  await f.preencherCliente();
  await f.change('Número ou s/n', '10');
  assert.equal(f.button().props.disabled, false);
  assert.match(f.text(f.button()), /R\$ 55\.00/);
  f.selector().props.onEnderecoChange('Rua alterada, ainda sem confirmação');
  f.selector().props.onChange(null);
  await f.flush();
  assert.equal(f.button().props.disabled, true);
  assert.equal(f.limpezas(), 1);
  assert.equal(f.distancias.length, 1, 'texto sem ponto confirmado não dispara cotação nem geocodificação');
  await f.submit();
  assert.equal(f.enviados.length, 0, 'handler também recusa envio se o formulário for acionado diretamente');
  f.find((node) => node.type === 'p' && /Escolha a localização de entrega/.test(f.text(node)));
});

test('retirada dispensa localização, mantém o total base e ignora cotação pendente da entrega', async (t) => {
  const f = await checkout(t, null);
  assert.equal(f.distancias.length, 0);
  assert.equal(f.button().props.disabled, true);
  f.input('Retirar no balcão').props.onChange();
  await f.flush();
  await f.preencherCliente();
  assert.equal(f.button().props.disabled, false);
  assert.match(f.text(f.button()), /R\$ 50\.00/);
  assert.equal(f.distancias.length, 0);
  await f.submit();
  assert.equal(f.enviados[0].entrega, 'retirada');
  assert.equal(f.enviados[0].ponto, null);
  assert.equal(f.enviados[0].endereco, '');
});

test('trocar para retirada invalida resposta pendente do ponto de entrega', async (t) => {
  const f = await checkout(t);
  assert.equal(f.distancias.length, 1);
  f.input('Retirar no balcão').props.onChange();
  await f.flush();
  await f.cotar(0, 99);
  await f.preencherCliente();
  assert.equal(f.button().props.disabled, false);
  assert.match(f.text(f.button()), /R\$ 50\.00/);
  await f.submit();
  assert.equal(f.enviados[0].entrega, 'retirada');
  assert.equal(f.enviados[0].ponto, null);
  assert.equal(f.enviados[0].endereco, '');
});

test('falha de cotação permite tentar novamente no mesmo ponto e libera pedido após sucesso', async (t) => {
  const f = await checkout(t);
  await f.preencherCliente();
  await f.change('Número ou s/n', '120');
  f.distancias[0].reject({ error: 'Serviço de frete temporariamente indisponível' });
  await f.flush();
  assert.equal(f.button().props.disabled, true);
  f.find((node) => node.type === 'p' && /Serviço de frete temporariamente indisponível/.test(f.text(node)));
  const repetir = f.find((node) => node.type === 'button' && node.props.className === 'online-retry-location');
  assert.match(f.text(repetir), /Tentar calcular o frete novamente/);
  repetir.props.onClick();
  await f.flush();
  assert.equal(f.distancias.length, 2);
  assert.equal(f.distancias[1].slug, f.distancias[0].slug);
  assert.deepEqual(f.distancias[1].params, f.distancias[0].params, 'nova tentativa usa o ponto já confirmado sem nova busca de endereço');
  assert.equal(f.button().props.disabled, true, 'envio aguarda a nova cotação');
  await f.cotar(1, 7);
  assert.equal(f.button().props.disabled, false);
  assert.match(f.text(f.button()), /R\$ 57\.00/);
  await f.submit();
  assert.equal(f.enviados.length, 1);
  assert.deepEqual(f.enviados[0].ponto, PONTO_A);
  assert.equal(f.enviados[0].endereco, 'Rua A, Centro, São Paulo, número 120');
});


test('loja somente retirada abre checkout sem frete ou endereço do cliente', async t => {
  const f = await checkout(t, null, { aceita_entrega: 0, aceita_retirada: 1, endereco: 'Rua da Loja, 20' });
  await f.preencherCliente();
  assert.equal(f.distancias.length, 0);
  assert.equal(f.input('Retirar no balcão').props.checked, true);
  const texto = f.text(f.render());
  assert.doesNotMatch(texto, /Entrega do estabelecimento|Endereço de entrega/);
  assert.match(texto, /Endereço para retirada:.*Rua da Loja, 20/);
  assert.equal(f.button().props.disabled, false);
  await f.submit();
  assert.equal(f.enviados.length, 1);
  assert.equal(f.enviados[0].entrega, 'retirada');
  assert.equal(f.enviados[0].endereco, '');
  assert.equal(f.enviados[0].ponto, null);
  assert.equal(f.enviados[0].plataforma, false);
});
