import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import SqliteDb from '../server/sqlite-db.js';
import { handle } from '../shared/router.js';
import { sha256 } from '../shared/util.js';

async function screen(t) {
  const db=new SqliteDb(':memory:');t.after(()=>db.close());
  db.prepare("INSERT INTO estabelecimentos (id,nome) VALUES (1,'Restaurante')").run();
  db.prepare("INSERT INTO funcionarios (id,estabelecimento_id,nome,usuario,senha_hash,modulos) VALUES (1,1,'Recepcionista','recepcao','hash','gestor,area:vendas')").run();
  db.prepare("INSERT INTO sessoes (estabelecimento_id,funcionario_id,token_hash,expira_em) VALUES (1,1,?,'2099-01-01')").bind(await sha256('ui-test')).run();
  db.prepare("INSERT INTO mesas (id,estabelecimento_id,numero,nome,tipo) VALUES (1,1,1,'Mesa 1','normal')").run();
  db.prepare("INSERT INTO produtos (id,estabelecimento_id,nome,preco,estoque_atual) VALUES (1,1,'Prato',20,100)").run();
  const requests=new Set();
  const call=(path,body,method='POST')=>{
    const promise=(async()=>{
      const r=await handle({req:{path,method,json:async()=>body,query:()=>undefined,header:n=>n==='cookie'?'simplesx_session=ui-test':undefined},json:(data,status=200)=>({data,status})},{DB:db});
      if(r.status>=400) throw {...r.data,status:r.status}; return r.data;
    })();
    requests.add(promise);return promise.finally(()=>requests.delete(promise));
  };
  const states=[],refs=[],effectDeps=[];let stateIndex=0,refIndex=0,effectIndex=0,tree,effects=[];
  const events=[],navigation=[],notifications=[];
  const h={
    state(initial){const i=stateIndex++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v;}];},
    ref(initial){const i=refIndex++;return refs[i] ||= {current:initial};},
    effect(fn,deps){const i=effectIndex++;if(!effectDeps[i]||deps?.some((d,j)=>d!==effectDeps[i][j])){effectDeps[i]=deps;effects.push(fn);}},
    node(type,props,...children){return{type,props:{...props,children}};},
    navigate:to=>navigation.push(to),params:new URLSearchParams(),setParams(){},toast:(...args)=>notifications.push(args),
    web:{scan:null,begin(){events.push('scan');return{};},stop(){events.push('stop');}},bridge(){},
    cartaoApi:{list:()=>call('/api/cartoes',null,'GET'),consultar:b=>call('/api/cartoes/consultar',b),cadastrar:b=>call('/api/cartoes/cadastrar',b),fechar:(id,b)=>call(`/api/cartoes/${id}/fechar`,b)},
    mesaApi:{list:()=>call('/api/mesas',null,'GET')},
  };
  const globals={__receptionTest:h,React:{createElement:h.node},document:{hidden:false},localStorage:{getItem:()=>null},setInterval:()=>0,clearInterval:()=>{}};
  const originals=Object.fromEntries(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  for(const[k,v]of Object.entries(globals))Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});
  t.after(()=>{for(const[k,d]of Object.entries(originals)){if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}});
  const runId=crypto.randomUUID();
  const module=source=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64')+'#'+runId;
  const mocks={
    react:'export const useState=globalThis.__receptionTest.state;export const useRef=globalThis.__receptionTest.ref;export const useEffect=globalThis.__receptionTest.effect;',
    'react-router-dom':'export const useNavigate=()=>globalThis.__receptionTest.navigate;export const useSearchParams=()=>[globalThis.__receptionTest.params,globalThis.__receptionTest.setParams];',
    'lucide-react':"export const Nfc='Nfc',Users='Users',Wallet='Wallet';",
    '@/components/AnimatedPage':"export const AnimatedPage='AnimatedPage';",
    '@/components/RestauranteAbas':"export const RestauranteAbas='RestauranteAbas';",
    '@/components/NfcScanButton':"export const NfcScanButton='NfcScanButton';",
    '@/components/ui':"export const Badge='Badge',Button='Button',Card='Card',EmptyState='EmptyState',Field='Field',Input='Input',Modal='Modal',Select='Select',Spinner='Spinner';export const useToast=()=>globalThis.__receptionTest.toast;",
    '@/lib/api':'export const cartaoApi=globalThis.__receptionTest.cartaoApi,mesaApi=globalThis.__receptionTest.mesaApi;',
    '@/lib/useNfcBridge':'export const useNfcLeitura=(active,cb)=>{globalThis.__receptionTest.bridge={active,cb};};',
    '@/lib/useWebNfc':'export const useWebNfc=()=>globalThis.__receptionTest.web;',
    '@/lib/format':"export const fmtBRL=n=>'R$ '+Number(n).toFixed(2);export const FORMAS_PAGAMENTO=[{valor:'pix',label:'Pix'},{valor:'dinheiro',label:'Dinheiro'}];",
  };
  let source=readFileSync('src/pages/RecepcaoPage.tsx','utf8');
  for(const[name,mock]of Object.entries(mocks))source=source.replaceAll(`'${name}'`,JSON.stringify(module(mock)));
  const {RecepcaoPage}=await import(module(source));
  const render=()=>{stateIndex=0;refIndex=0;effectIndex=0;tree=RecepcaoPage();for(const fn of effects.splice(0))fn();return tree;};
  const flush=async()=>{for(let i=0;i<4;i++){await Promise.allSettled([...requests]);await new Promise(setImmediate);render();}};
  const nodes=node=>!node?[]:Array.isArray(node)?node.flatMap(n=>nodes(n)):typeof node!=='object'?[]:[node,...nodes(node.props?.children)];
  const text=node=>node==null?'':Array.isArray(node)?node.map(text).join(''):typeof node==='object'?text(node.props?.children):String(node);
  const find=(type,label)=>{
    const all=nodes(tree),modal=all.find(n=>n.type==='Modal'&&n.props.open);
    const candidates=type==='Modal'?all:nodes(modal||tree);
    const n=candidates.find(n=>n.type===type&&(!label||String(n.props.title||n.props.label||text(n)).includes(label)));
    assert.ok(n,`${type}: ${label}`);return n;
  };
  const click=async(label)=>{find('Button',label).props.onClick();await flush();};
  render();await flush();
  return{db,call,h,render,flush,find,click,text,navigation,notifications,events};
}

test('Recepção: botão inicia NFC no gesto, leitura abre cadastro e cliente é fechado individualmente pela tela',async t=>{
  const f=await screen(t);
  const start=f.find('Button','Cadastrar ou consultar cartão');start.props.onClick();
  assert.deepEqual(f.events,['scan'],'scan começa no clique, antes dos efeitos');
  f.render(); f.find('NfcScanButton').props.onRead({uid:'04A224B1C2D380',payload:''});await f.flush();
  const form=f.find('Modal','Cadastrar comanda individual');assert.equal(form.props.open,true);
  f.find('Field','Nome do cliente').props.children[0].props.onChange({target:{value:'Ana'}});
  f.find('Field','Mesa').props.children[0].props.onChange({target:{value:'1'}});f.render();
  await f.find('form').props.onSubmit({preventDefault(){}});await f.flush();
  const a=(await f.call('/api/cartoes',null,'GET'))[0];assert.equal(a.cliente_nome,'Ana');assert.equal(a.mesa_id,1);
  await f.call('/api/cartoes/cadastrar',{uid:'04A224B1C2D381',cliente_nome:'Bruno',mesa_id:1,chave:crypto.randomUUID()});
  await f.call('/api/cartoes/usar',{uid:a.cartao,acao:'lancar',chave:crypto.randomUUID(),itens:[{produto_id:1,quantidade:1}]});
  // Reaproximar consulta o vínculo existente e atualiza o consumo exibido.
  await f.click('Cadastrar ou consultar cartão');f.find('NfcScanButton').props.onRead({uid:a.cartao,payload:''});await f.flush();
  await f.click('Ver / lançar pedidos');assert.equal(f.navigation.at(-1),`/restaurante/comanda/${a.comanda_id}?pessoa=${a.pessoa_id}`);
  await f.click('Fechar comanda');await f.click('Confirmar pagamento e liberar cartão');
  const ativos=await f.call('/api/cartoes',null,'GET');assert.equal(ativos.length,1);assert.equal(ativos[0].cliente_nome,'Bruno');
  assert.equal(f.db.prepare('SELECT total FROM vendas').first().total,20);
});

test('Recepção ignora retorno de modal cancelado e bloqueia duas leituras simultâneas',async t=>{
  const f=await screen(t);await f.click('Cadastrar ou consultar cartão');
  const stale=f.find('NfcScanButton').props.onRead;
  f.find('Modal','Aproxime o cartão').props.onClose();f.render();await f.click('Cadastrar ou consultar cartão');
  stale({uid:'04A224B1C2D380',payload:''});await f.flush();
  assert.equal(f.find('Modal','Cadastrar comanda individual').props.open,false);
  const read=f.find('NfcScanButton').props.onRead;
  read({uid:'04A224B1C2D381',payload:''});read({uid:'04A224B1C2D380',payload:''});await f.flush();
  assert.equal(f.find('Modal','Cadastrar comanda individual').props.open,true);
  assert.ok(f.text(f.find('Modal','Cadastrar comanda individual')).includes('04A224B1C2D381'));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comandas').first().n,0,'leitura por si só não abre conta');
});
