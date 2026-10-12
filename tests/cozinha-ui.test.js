import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

test('tela de preparo mantém filtro no endereço, ignora retorno antigo e marca apenas itens visíveis',async t=>{
  const states=[],refs=[],deps=[],cleanups=[],effects=[],requests=[],statuses=[];
  let si=0,ri=0,ei=0,tree,params=new URLSearchParams('categoria=1');
  const categorias=[{id:1,nome:'Cozinha',caminho:'Cozinha'},{id:2,nome:'Bar',caminho:'Bar'},{id:3,nome:'Drinks',categoria_pai_id:2,caminho:'Bar › Drinks'}];
  const data=id=>({categorias,estacoes:[{id:`categoria:${id}`,nome:categorias.find(c=>c.id===id).caminho,lancamentos:[{id:`pedido-${id}`,comanda_id:10,lugar:'Mesa 1',canal:'restaurante',status:'novo',criado_em:'2026-10-12',espera_min:1,itens:[{id:id*10,nome:`Produto ${id}`,quantidade:1,status:'novo'}]}]}]});
  const h={
    state(initial){const i=si++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},
    ref(initial){return refs[ri++] ||= {current:initial};},
    effect(fn,next){const i=ei++;if(!deps[i]||next.some((d,j)=>d!==deps[i][j])){deps[i]=next;effects.push(()=>{cleanups[i]?.();cleanups[i]=fn();});}},
    node:(type,props,...children)=>({type,props:{...props,children}}),
    search:()=>[params,next=>{params=next;}],navigate(){},toast(){},
    cozinha:id=>new Promise(resolve=>requests.push({id,resolve})),
    itemStatus:async(comanda,id,status)=>{statuses.push({comanda,id,status});},
  };
  const globals={__kitchen:h,React:{createElement:h.node},document:{title:'DoixP'},setInterval:()=>0,clearInterval:()=>{}};
  const originals=Object.fromEntries(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const[key,value]of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  t.after(()=>{for(const[key,value]of Object.entries(originals)){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}});
  const module=source=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64');
  const mocks={
    react:'export const useState=__kitchen.state,useRef=__kitchen.ref,useEffect=__kitchen.effect;',
    'react-router-dom':'export const useNavigate=()=>__kitchen.navigate,useSearchParams=__kitchen.search;',
    'lucide-react':"export const ChefHat='ChefHat';",
    '@/components/AnimatedPage':"export const AnimatedPage='AnimatedPage';",
    '@/components/RestauranteAbas':"export const RestauranteAbas='RestauranteAbas';",
    '@/components/ui':"export const Badge='Badge',Button='Button',Card='Card',EmptyState='EmptyState',Field='Field',Select='Select';export const useToast=()=>__kitchen.toast;",
    '@/lib/api':'export const pedidosApi={cozinha:__kitchen.cozinha},comandaApi={itemStatus:__kitchen.itemStatus};',
    '@/lib/format':'export const fmtHora=()=>"12:00";',
  };
  let source=readFileSync('src/pages/CozinhaPage.tsx','utf8');
  for(const[name,mock]of Object.entries(mocks))source=source.replaceAll(`'${name}'`,JSON.stringify(module(mock)));
  const {CozinhaPage}=await import(module(source));
  const render=()=>{si=ri=ei=0;tree=CozinhaPage();for(const fn of effects.splice(0))fn();};
  const flush=async()=>{await new Promise(setImmediate);render();};
  const nodes=n=>Array.isArray(n)?n.flatMap(nodes):n&&typeof n==='object'?[n,...nodes(n.props.children)]:[];
  const text=n=>Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.props.children):n==null?'':String(n);
  const find=(type,label)=>{const node=nodes(tree).find(n=>n.type===type&&(!label||text(n).includes(label)));assert.ok(node,`${type} ${label}`);return node;};
  render();assert.equal(requests[0].id,1,'reabrir endereço conserva a categoria');
  requests[0].resolve(data(1));await flush();assert.match(text(tree),/Produto 1/);
  find('Select').props.onChange({target:{value:'2'}});render();assert.equal(params.get('categoria'),'2');
  find('Select').props.onChange({target:{value:'3'}});render();assert.equal(params.get('categoria'),'3');
  assert.deepEqual(requests.map(r=>r.id),[1,2,3]);
  requests[2].resolve(data(3));await flush();
  requests[1].resolve(data(2));await flush();assert.match(text(tree),/Produto 3/);assert.doesNotMatch(text(tree),/Produto 2/);
  assert.equal(document.title,'Bar › Drinks (1) · DoixP');
  const ready=find('Button','Pronto').props.onClick();await flush();
  assert.deepEqual(statuses,[{comanda:10,id:30,status:'entregue'}]);
  requests[3].resolve({...data(3),estacoes:[{id:'categoria:3',nome:'Bar › Drinks',lancamentos:[]}]});await ready;await flush();
  assert.equal(params.get('categoria'),'3');assert.doesNotMatch(text(tree),/Produto 3/);
});
