import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

test('seletor exige escolha de endereço, ignora respostas antigas e preserva o GPS sem endereço reverso', async (t) => {
  const states = [], refs = [], deps = [], effects = [], cleanups = [];
  const buscas = [], reversas = [], gps = [], pontos = [];
  let si = 0, ri = 0, ei = 0, tree, mudancas = 0;
  let props = {
    value: null,
    endereco: '',
    onChange(value) { mudancas++; props.value = value; pontos.push(value); },
    onEnderecoChange(endereco) { mudancas++; props.endereco = endereco; },
  };
  const harness = {
    state(initial) {
      const i = si++;
      if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
      return [states[i], (value) => { mudancas++; states[i] = typeof value === 'function' ? value(states[i]) : value; }];
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
    search: (consulta) => new Promise((resolve, reject) => buscas.push({ consulta, resolve, reject })),
    reverse: (consulta) => new Promise((resolve, reject) => reversas.push({ consulta, resolve, reject })),
    gps: () => new Promise((resolve, reject) => gps.push({ resolve, reject })),
  };
  globalThis.__localizacaoSeletor = harness;
  t.after(() => { for (const fn of cleanups) fn?.(); delete globalThis.__localizacaoSeletor; });
  const moduleUrl = (source) => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText.replaceAll('React.createElement', '__localizacaoSeletor.node')).toString('base64');
  const mocks = {
    react: 'export class Component {} export const lazy=()=>"MapaLocalizacao",Suspense="Suspense",useState=__localizacaoSeletor.state,useRef=__localizacaoSeletor.ref,useEffect=__localizacaoSeletor.effect,useId=()=>"localizacao-test";',
    'lucide-react': 'export const CheckCircle2="CheckCircle2",Crosshair="Crosshair",Loader2="Loader2",MapPin="MapPin",Search="Search";',
    '@/lib/api': 'export const onlinePublicApi={locateOptions:__localizacaoSeletor.search,locate:__localizacaoSeletor.reverse};',
    '@/lib/localizacao-cliente': 'export const obterLocalizacaoAtual=__localizacaoSeletor.gps,coordenadaClienteValida=(lat,lng)=>Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180;',
  };
  let source = readFileSync('src/components/SeletorLocalizacao.tsx', 'utf8').replace("import './seletor-localizacao.css';", '');
  for (const [name, mock] of Object.entries(mocks)) source = source.replaceAll(`'${name}'`, JSON.stringify(moduleUrl(mock)));
  const { SeletorLocalizacao } = await import(moduleUrl(source));
  const render = () => { si = ri = ei = 0; tree = SeletorLocalizacao(props); for (const fn of effects.splice(0)) fn(); };
  const flush = async () => { await new Promise(setImmediate); render(); };
  const nodes = (n) => Array.isArray(n) ? n.flatMap(nodes) : n && typeof n === 'object' ? [n, ...nodes(n.props.children)] : [];
  const text = (n) => Array.isArray(n) ? n.map(text).join('') : n && typeof n === 'object' ? text(n.props.children) : n == null ? '' : String(n);
  const find = (type, label) => {
    const found = nodes(tree).find((n) => n.type === type && (!label || text(n) === label));
    assert.ok(found, `${type} ${label || ''}`);
    return found;
  };
  const editar = (texto) => { find('input').props.onChange({ target: { value: texto } }); render(); };
  const buscar = () => { find('button', 'Buscar').props.onClick(); render(); };
  const localizar = () => { find('button', 'Usar minha localização').props.onClick(); render(); };
  const modoManter = () => nodes(tree).find((n) => n.type === 'input' && n.props.type === 'checkbox');
  const opcao = (endereco, latitude, longitude) => ({ endereco, latitude, longitude });

  render();
  editar('Rua primeira, 10, São Paulo');
  assert.equal(buscas.length, 0, 'digitar não consulta geocodificação');
  let interceptado = 0;
  find('input').props.onKeyDown({ key: 'Enter', preventDefault() { interceptado++; }, stopPropagation() {}, nativeEvent: {} });
  render();
  assert.equal(interceptado, 1, 'Enter não submete o formulário que contém o seletor');
  assert.equal(buscas.length, 1);
  editar('Rua segunda, 20, São Paulo');
  buscas[0].resolve({ opcoes: [opcao('Resultado antigo', -23, -46)] });
  await flush();
  assert.doesNotMatch(text(tree), /Resultado antigo/);
  assert.equal(props.value, null);

  buscar();
  buscas[1].resolve({ opcoes: [opcao('Primeira alternativa', -23.1, -46.1), opcao('Rua das Flores, Centro, São Paulo', -23.2, -46.2)] });
  await flush();
  assert.equal(props.value, null, 'nenhum resultado é selecionado automaticamente');
  find('button', 'Rua das Flores, Centro, São PauloEscolher este endereço').props.onClick();
  render();
  assert.equal(props.value.latitude, -23.2);
  assert.equal(props.value.origem, 'endereco');
  assert.equal(props.endereco, 'Rua das Flores, Centro, São Paulo');

  await t.test('rua selecionada sem número permite completar endereço ao preservar o ponto explicitamente', () => {
    const pontoConfirmado = { ...props.value };
    assert.equal(modoManter().props.checked, false, 'escolher um endereço não ativa a preservação silenciosamente');
    modoManter().props.onChange({ target: { checked: true } });
    render();
    editar('Rua das Flores, 120, sala 2, Centro, São Paulo');
    assert.equal(props.value.origem, 'endereco');
    assert.equal(props.value.latitude, pontoConfirmado.latitude);
    assert.equal(props.value.longitude, pontoConfirmado.longitude);
    assert.equal(props.value.atualizado_em, pontoConfirmado.atualizado_em);
    assert.equal(props.value.endereco, 'Rua das Flores, 120, sala 2, Centro, São Paulo');
    assert.equal(props.endereco, props.value.endereco);
    assert.equal(buscas.length, 2, 'completar número e complemento não repete a geocodificação');
    assert.equal(modoManter().props.checked, true);
    modoManter().props.onChange({ target: { checked: false } });
    render();
  });

  editar('12345');
  assert.equal(props.value, null, 'editar remove imediatamente as coordenadas do endereço anterior');
  buscar();
  assert.equal(buscas.length, 2, 'CEP incompleto não consulta o serviço');
  assert.match(text(tree), /CEP completo/);
  editar('01001-000');
  buscar();
  assert.equal(buscas.length, 3, 'CEP completo pode ser buscado');
  buscas[2].resolve({ opcoes: [] });
  await flush();

  localizar();
  gps[0].resolve({ latitude: -23.55, longitude: -46.63, precisao_metros: 350, atualizado_em: 123 });
  await flush();
  assert.equal(props.value.latitude, -23.55, 'GPS é utilizável antes da descrição reversa');
  assert.equal(props.value.precisao_metros, 350);
  assert.equal(props.endereco, '', 'endereço antigo não é associado ao novo GPS');
  assert.equal(props.value.endereco, '');
  assert.match(text(tree), /Localização aproximada/);
  reversas[0].reject({ error: 'Serviço de endereço temporariamente indisponível' });
  await flush();
  assert.equal(props.value.origem, 'gps');
  assert.equal(props.value.longitude, -46.63, 'falha reversa preserva a coordenada do aparelho');
  assert.match(text(tree), /Não foi possível identificar o endereço/);
  assert.equal(modoManter().props.checked, false, 'falha reversa também exige escolher explicitamente a preservação');
  modoManter().props.onChange({ target: { checked: true } });
  render();
  editar('Rua preenchida manualmente, 50, São Paulo');
  assert.equal(props.value.latitude, -23.55);
  assert.equal(props.value.longitude, -46.63);
  assert.equal(props.value.precisao_metros, 350);
  assert.equal(props.value.endereco, 'Rua preenchida manualmente, 50, São Paulo');
  assert.equal(buscas.length, 3, 'preencher o endereço do GPS não depende do geocodificador');

  buscar();
  assert.equal(modoManter().props.checked, false, 'iniciar outra busca desativa a preservação do ponto');
  editar('Outro endereço, 60, São Paulo');
  assert.equal(props.value, null, 'após outra busca, editar volta a invalidar o ponto');
  buscas[3].resolve({ opcoes: [opcao('Resultado antigo após modo manual', -21, -42)] });
  await flush();
  assert.doesNotMatch(text(tree), /Resultado antigo após modo manual/);

  localizar();
  editar('Novo endereço manual, 40');
  gps[1].resolve({ latitude: -10, longitude: -40, atualizado_em: 125 });
  await flush();
  assert.equal(props.value, null, 'GPS antigo não substitui endereço digitado depois');
  assert.equal(reversas.length, 1);

  localizar();
  gps[2].resolve({ latitude: -22, longitude: -43, atualizado_em: 127 });
  await flush();
  assert.match(text(tree), /Precisão não informada pelo aparelho/);
  find('MapaLocalizacao').props.onChange({ latitude: -22.001, longitude: -43.001 });
  render();
  reversas[1].resolve({ latitude: -99, longitude: -99, endereco: 'Descrição antiga' });
  await flush();
  assert.equal(props.value.origem, 'mapa');
  assert.equal(props.value.latitude, -22.001, 'descrição reversa antiga não substitui ajuste manual');
  assert.equal(props.endereco, '', 'novo GPS exige confirmar o endereço correspondente');
  assert.equal(modoManter().props.checked, false, 'ajuste no mapa disponibiliza modo de preservar ponto sem ativá-lo silenciosamente');
  modoManter().props.onChange({ target: { checked: true } });
  render();
  editar('Entrada indicada no mapa, 90, Rio de Janeiro');
  assert.equal(props.value.origem, 'mapa');
  assert.equal(props.value.latitude, -22.001);
  assert.equal(props.value.endereco, 'Entrada indicada no mapa, 90, Rio de Janeiro');
  buscar();
  buscas[4].resolve({ opcoes: [opcao('Endereço escolhido novamente', -22.01, -43.01)] });
  await flush();
  find('button', 'Endereço escolhido novamenteEscolher este endereço').props.onClick();
  render();
  assert.equal(props.value.origem, 'endereco');
  editar('Edição após escolher outro endereço');
  assert.equal(props.value, null, 'selecionar endereço desativa a preservação anterior');

  localizar();
  gps[3].resolve({ latitude: -23.6, longitude: -46.7, atualizado_em: 128 });
  await flush();
  reversas[2].resolve({ latitude: -23, longitude: -46, endereco: 'Rua identificada, São Paulo' });
  await flush();
  assert.equal(props.value.latitude, -23.6, 'coordenada reversa nunca substitui o GPS');
  assert.equal(props.value.longitude, -46.7);
  assert.equal(props.endereco, 'Rua identificada, São Paulo');

  localizar();
  assert.equal(props.value, null, 'pedir novo GPS invalida imediatamente o ponto anterior');
  gps[4].reject(new Error('Localização não autorizada'));
  await flush();
  assert.equal(props.value, null, 'GPS pendente ou negado não permite usar o ponto antigo');

  editar('Consulta pendente ao sair');
  buscar();
  for (const fn of cleanups) fn?.();
  const antesDeSair = mudancas;
  buscas[5].reject({ error: 'Erro depois de desmontar' });
  await new Promise(setImmediate);
  assert.equal(mudancas, antesDeSair, 'não altera estado depois de desmontar');
  assert.ok(pontos.includes(null));
});
