import assert from 'node:assert/strict';
import test from 'node:test';
import SqliteDb from '../server/sqlite-db.js';
import { idDoCartao } from '../shared/cartao-nfc.js';
import { handle } from '../shared/router.js';
import { sha256 } from '../shared/util.js';

const UID_A='04A224B1C2D380', UID_B='04A224B1C2D381';
async function fixture(t) {
  const db=new SqliteDb(':memory:'); t.after(()=>db.close());
  db.prepare("INSERT INTO estabelecimentos (id,nome) VALUES (1,'A'),(2,'B')").run();
  db.prepare("INSERT INTO mesas (id,estabelecimento_id,numero,nome,tipo) VALUES (1,1,1,'Mesa 1','normal'),(2,1,2,'Mesa 2','normal'),(3,2,1,'Mesa 1','normal')").run();
  db.prepare("INSERT INTO produtos (id,estabelecimento_id,nome,preco,estoque_atual) VALUES (1,1,'Prato',20,100),(2,2,'Outro',10,100)").run();
  for(const id of [1,2]) {
    db.prepare("INSERT INTO funcionarios (id,estabelecimento_id,nome,usuario,senha_hash,modulos) VALUES (?,?,?,?,'hash','gestor,area:vendas')").bind(id,id,`Operador ${id}`,`user${id}`).run();
    db.prepare("INSERT INTO sessoes (estabelecimento_id,funcionario_id,token_hash,expira_em) VALUES (?,?,?,'2099-01-01')").bind(id,id,await sha256(`sessao-${id}`)).run();
  }
  const call=(path,body,loja=1,method='POST')=>handle({req:{path,method,json:async()=>body,query:()=>undefined,header:name=>name==='cookie'?`simplesx_session=sessao-${loja}`:undefined},json:(data,status=200)=>({data,status})},{DB:db});
  const register=(uid=UID_A,nome='Ana',mesa=1,extra={})=>call('/api/cartoes/cadastrar',{uid,cliente_nome:nome,mesa_id:mesa,chave:crypto.randomUUID(),...extra});
  const order=(uid=UID_A,qtd=1,extra={})=>call('/api/cartoes/usar',{uid,acao:'lancar',chave:crypto.randomUUID(),itens:[{produto_id:1,quantidade:qtd}],...extra});
  const close=(a,total,extra={})=>call(`/api/cartoes/${a.id}/fechar`,{forma:'pix',total,...extra});
  const lookup=async(uid=UID_A)=>(await call('/api/cartoes/consultar',{uid})).data.atendimento;
  return {db,call,register,order,close,lookup};
}

test('cartão só identifica: cadastro exige nome e mesa, leitura não abre conta automaticamente',async t=>{
  const f=await fixture(t); assert.equal(await f.lookup(),null);
  for(const acao of ['abrir','lancar','fechar']) assert.equal((await f.call('/api/cartoes/usar',{uid:UID_A,acao})).status,404);
  for(const extra of [{cliente_nome:''},{cliente_nome:'a'.repeat(101)},{mesa_id:999},{mesa_id:3},{chave:'x'}]) assert.equal((await f.register(UID_A,'Ana',1,extra)).status,400);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comandas').first().n,0);
});

test('Recepção cadastra dois clientes na mesma mesa, sem duplicar cadastro nem permitir reatribuição em uso',async t=>{
  const f=await fixture(t),chave=crypto.randomUUID();
  const a=await f.register(UID_A,' Ana ',1,{chave,payload:'15'}),b=await f.register(UID_B,'Bruno',1,{payload:'15'});
  assert.equal(a.status,201,JSON.stringify(a)); assert.equal(b.status,201);
  assert.equal(a.data.cliente_nome,'Ana'); assert.equal(a.data.mesa_id,1);
  assert.equal(a.data.comanda_id,b.data.comanda_id); assert.notEqual(a.data.pessoa_id,b.data.pessoa_id);
  assert.equal((await f.register(UID_A,'Ana',1,{chave})).data.id,a.data.id);
  assert.equal((await f.register(UID_A,'Carla',2)).status,409);
  assert.equal((await f.call('/api/cartoes',null,1,'GET')).data.length,2);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM mesas WHERE tipo='cartao'").first().n,0);
  assert.equal(f.db.prepare('SELECT pessoas_count FROM comandas').first().pessoas_count,2);
});

test('pedido usa obrigatoriamente a pessoa do cartão, é idempotente e informa mesa/cliente para cozinha',async t=>{
  const f=await fixture(t),a=(await f.register()).data,b=(await f.register(UID_B,'Bruno')).data;
  const body={chave:crypto.randomUUID(),itens:[{produto_id:1,quantidade:2,pessoa_id:b.pessoa_id}]};
  const r=await f.order(UID_A,2,body);
  assert.equal(r.status,200,JSON.stringify(r)); assert.equal((await f.order(UID_A,2,body)).status,200);
  assert.equal(r.data.pessoa_id,a.pessoa_id); assert.equal(r.data.atendimento_id,a.id); assert.equal(r.data.mesa_numero,1);
  assert.deepEqual(r.data.cozinha.sem_rota,['Prato']);
  assert.deepEqual(f.db.prepare('SELECT pessoa_id,comanda_id,quantidade FROM comanda_itens').all().results,[{pessoa_id:a.pessoa_id,comanda_id:a.comanda_id,quantidade:2}]);
  const full=(await f.call(`/api/comandas/${a.comanda_id}`,null,1,'GET')).data;
  assert.equal(full.pessoas.find(p=>p.id===a.pessoa_id).cartao_atendimento_id,a.id);
});

test('fechamento individual cobra só a pessoa, preserva os IDs dos pedidos e libera cartão para reuso sem afetar outros clientes',async t=>{
  const f=await fixture(t),a=(await f.register()).data,b=(await f.register(UID_B,'Bruno')).data;
  await f.order(UID_A,2); await f.order(UID_B,1);
  f.db.prepare('UPDATE comandas SET taxa_garcom_pct=10 WHERE id=?').bind(a.comanda_id).run();
  const idItem=f.db.prepare('SELECT id FROM comanda_itens WHERE pessoa_id=?').first(a.pessoa_id).id;
  const r=await f.close(a,44); assert.equal(r.status,200,JSON.stringify(r)); assert.equal(r.data.total,44);
  assert.equal((await f.close(a,44)).data.repetido,true);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM vendas').first().n,1);
  assert.equal(f.db.prepare('SELECT estoque_atual FROM produtos WHERE id=1').first().estoque_atual,98);
  assert.equal(f.db.prepare('SELECT SUM(valor) total FROM caixa').first().total,44);
  const item=f.db.prepare('SELECT * FROM comanda_itens WHERE id=?').first(idItem);
  assert.notEqual(item.comanda_id,a.comanda_id); assert.equal(item.pessoa_id,a.pessoa_id);
  assert.equal(f.db.prepare('SELECT status FROM comandas WHERE id=?').first(a.comanda_id).status,'aberta');
  assert.equal(f.db.prepare('SELECT status FROM mesas WHERE id=1').first().status,'ocupada');
  const full=(await f.call(`/api/comandas/${a.comanda_id}`,null,1,'GET')).data;
  assert.equal(full.subtotal,20); assert.equal(full.transfer_comanda_id,null); assert.equal(full.pessoas.length,1); assert.equal(full.pessoas[0].nome,'Bruno');
  assert.equal(await f.lookup(),null);
  const novo=(await f.register(UID_A,'Carla',2)).data;
  assert.notEqual(novo.id,a.id); assert.notEqual(novo.pessoa_id,a.pessoa_id); assert.equal(novo.mesa_id,2);
  await f.close(a,44); assert.equal((await f.lookup()).id,novo.id);
  assert.equal((await f.close(b,22)).status,200);
  assert.equal(f.db.prepare('SELECT status FROM mesas WHERE id=1').first().status,'livre');
  assert.equal(f.db.prepare('SELECT estoque_atual FROM produtos WHERE id=1').first().estoque_atual,97);
});

test('encerrar sem consumo não gera venda; total alterado exige nova confirmação',async t=>{
  const f=await fixture(t),a=(await f.register()).data;
  await f.order(); assert.equal((await f.close(a,0)).status,409);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM vendas').first().n,0); assert.equal((await f.lookup()).id,a.id);
  assert.equal((await f.close(a,20)).status,200);
  const b=(await f.register()).data,r=await f.close(b,0);
  assert.equal(r.status,200); assert.equal(r.data.sem_consumo,true);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM vendas').first().n,1);
  assert.equal(f.db.prepare('SELECT status FROM mesas WHERE id=1').first().status,'livre');
});

for(const taxa of [0,5.5]) test(`conta NFC imprime e paga com taxa individual de ${taxa}%, preservando demais clientes e comprovante após reuso`,async t=>{
  const f=await fixture(t),a=(await f.register()).data,b=(await f.register(UID_B,'Bruno')).data;
  await f.order(UID_A,2);await f.order(UID_B);
  f.db.prepare('UPDATE comandas SET taxa_garcom_pct=10 WHERE id=?').bind(a.comanda_id).run();
  const total=40+40*taxa/100;
  const before=await f.call(`/api/cartoes/${a.id}/conta`,{taxa_garcom_pct:taxa});
  assert.equal(before.status,200,JSON.stringify(before));assert.equal(before.data.total,total);
  assert.equal(before.data.subtotal,40);assert.equal(before.data.taxa_garcom_pct,taxa);
  assert.match(before.data.impressao,/PESSOA: Ana/);assert.match(before.data.impressao,/STATUS: PENDENTE/);
  assert.doesNotMatch(before.data.impressao,/Bruno/);assert.ok(before.data.impressao.includes(`GARÇOM (${taxa}%):`));
  assert.ok(before.data.impressao.includes(`CARTÃO: ${UID_A}`));
  assert.equal((await f.lookup()).id,a.id,'impressão não libera o cartão');
  const closed=await f.close(a,total,{taxa_garcom_pct:taxa});assert.equal(closed.status,200,JSON.stringify(closed));
  assert.equal(closed.data.total,total);assert.equal(closed.data.taxa_garcom_pct,taxa);
  assert.equal(f.db.prepare('SELECT taxa_garcom_pct FROM comandas WHERE id=?').first(a.comanda_id).taxa_garcom_pct,10);
  const saved=f.db.prepare('SELECT c.* FROM comanda_pessoas p JOIN comandas c ON c.id=p.comanda_id WHERE p.id=?').first(a.pessoa_id);
  assert.equal(saved.taxa_garcom_pct,taxa);assert.equal(saved.status,'fechada');
  assert.equal(f.db.prepare('SELECT total FROM vendas').first().total,total);
  assert.equal(f.db.prepare('SELECT SUM(valor) total FROM pagamentos').first().total,total);
  assert.equal(f.db.prepare('SELECT SUM(valor) total FROM caixa').first().total,total);
  const novo=(await f.register(UID_A,'Carla',2)).data;await f.order(UID_A,3);
  const after=await f.call(`/api/cartoes/${a.id}/conta`,{taxa_garcom_pct:99});
  assert.equal(after.data.total,total);assert.equal(after.data.taxa_garcom_pct,taxa);
  assert.match(after.data.impressao,/PESSOA: Ana/);assert.match(after.data.impressao,/STATUS: PAGO/);
  assert.doesNotMatch(after.data.impressao,/Carla|Bruno/);assert.match(after.data.impressao,/2x Prato/);
  const replay=await f.close(a,0,{taxa_garcom_pct:99});assert.equal(replay.data.repetido,true);
  assert.equal(replay.data.total,total);assert.equal(replay.data.taxa_garcom_pct,taxa);
  assert.equal((await f.lookup()).id,novo.id);
  assert.equal((await f.close(b,22)).status,200,'outro cliente conserva a taxa da mesa');
});

test('taxa inválida e total divergente não geram baixa; impressão e pagamento arredondam os mesmos centavos',async t=>{
  const f=await fixture(t),a=(await f.register()).data;
  f.db.prepare('UPDATE produtos SET preco=0.335 WHERE id=1').run();await f.order(UID_A,3);
  for(const taxa_garcom_pct of [-1,101,null,'', '10',NaN,Infinity]) {
    assert.equal((await f.close(a,1,{taxa_garcom_pct})).status,400);
    assert.equal((await f.call(`/api/cartoes/${a.id}/conta`,{taxa_garcom_pct})).status,400);
  }
  assert.equal((await f.close(a,1,{taxa_garcom_pct:10})).status,409);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM vendas').first().n,0);
  assert.equal((await f.lookup()).id,a.id);
  const before=await f.call(`/api/cartoes/${a.id}/conta`,{taxa_garcom_pct:10});
  assert.equal(before.data.subtotal,1.01);assert.equal(before.data.total,1.11);
  const closed=await f.close(a,before.data.total,{taxa_garcom_pct:10});assert.equal(closed.status,200,JSON.stringify(closed));
  const after=await f.call(`/api/cartoes/${a.id}/conta`,{});assert.equal(after.data.total,closed.data.total);
  assert.equal(f.db.prepare('SELECT total FROM vendas').first().total,after.data.total);
});

test('pré-fechamento mantém cartão e bloqueia novos cadastros; baixa total libera cartão',async t=>{
  const f=await fixture(t),a=(await f.register()).data; await f.order();
  assert.equal((await f.call(`/api/comandas/${a.comanda_id}/fechar`,{tipo:'unica',pre_fechar:true})).status,200);
  assert.equal((await f.register(UID_B,'Bruno')).status,409); assert.equal((await f.order()).status,409); assert.equal((await f.lookup()).id,a.id);
  assert.equal((await f.call(`/api/comandas/${a.comanda_id}/fechar`,{tipo:'unica',forma:'pix'})).status,200); assert.equal(await f.lookup(),null);
});

test('cancelamento libera cartão; remoção da pessoa e transferência integral não desfazem o vínculo',async t=>{
  const f=await fixture(t),a=(await f.register()).data; await f.order();
  assert.equal((await f.call(`/api/comandas/${a.comanda_id}/pessoas/${a.pessoa_id}`,null,1,'DELETE')).status,409);
  assert.equal((await f.call(`/api/comandas/${a.comanda_id}/fechar`,{tipo:'individual'})).status,409);
  const itens=f.db.prepare('SELECT id,versao FROM comanda_itens').all().results;
  assert.equal((await f.call(`/api/comandas/${a.comanda_id}/transferir-mesa`,{chave:crypto.randomUUID(),mesa_destino_id:2,comanda_destino_id:null,liberar_origem:true,itens})).status,409);
  assert.equal((await f.call(`/api/comandas/${a.comanda_id}/cancelar`,{chave:crypto.randomUUID(),confirmar:true,motivo:'Cliente desistiu',itens})).status,200);
  assert.equal(await f.lookup(),null); assert.equal(f.db.prepare('SELECT COUNT(*) n FROM vendas').first().n,0);
});

test('cadastro simultâneo não duplica pessoa e mantém uma comanda por mesa',async t=>{
  const f=await fixture(t),rs=await Promise.all([f.register(UID_A,'Ana'),f.register(UID_A,'Outra')]);
  assert.deepEqual(rs.map(r=>r.status).sort(),[201,409]); assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comanda_pessoas').first().n,1);
  assert.equal((await f.register(UID_B,'Bruno')).status,201); assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comandas').first().n,1);
});

test('consulta/cadastro/baixa isolam lojas e exigem sessão e área de vendas',async t=>{
  const f=await fixture(t),a=(await f.register()).data;
  assert.equal((await f.call('/api/cartoes/consultar',{uid:UID_A},2)).data.atendimento,null);
  assert.deepEqual((await f.call('/api/cartoes',null,2,'GET')).data,[]);
  assert.equal((await f.call(`/api/cartoes/${a.id}/fechar`,{forma:'pix',total:0},2)).status,404);
  assert.equal((await f.call(`/api/cartoes/${a.id}/conta`,{},2)).status,404);
  assert.equal((await f.call(`/api/cartoes/${a.id}/conta`,{},99)).status,401);
  assert.equal((await f.call('/api/cartoes/cadastrar',{uid:UID_A,cliente_nome:'Loja B',mesa_id:3,chave:crypto.randomUUID()},2)).status,201);
  f.db.prepare("UPDATE funcionarios SET modulos='gestor,area:financeiro' WHERE id=1").run();
  assert.equal((await f.call('/api/cartoes',null,1,'GET')).status,403); assert.equal((await f.call('/api/cartoes/consultar',{uid:UID_A},99)).status,401);
  assert.equal((await f.call(`/api/cartoes/${a.id}/conta`,{})).status,403);
});

test('conta antiga permanece acessível para fechar sem migrar seu saldo',async t=>{
  const f=await fixture(t);
  const mesa=f.db.prepare("INSERT INTO mesas (estabelecimento_id,numero,nome,status,tipo,nfc_uid) VALUES (1,1001,'Antigo','ocupada','cartao',?)").bind(UID_A).run().meta.last_row_id;
  const com=f.db.prepare("INSERT INTO comandas (estabelecimento_id,mesa_id,status) VALUES (1,?,'aberta')").bind(mesa).run().meta.last_row_id;
  assert.equal((await f.call('/api/cartoes/usar',{uid:UID_A,acao:'abrir'})).data.comanda_id,com); assert.equal((await f.register()).status,409);
  await f.call(`/api/comandas/${com}/fechar`,{tipo:'unica'}); assert.equal((await f.register()).status,201);
});

test('UID físico tem prioridade e leitores que só fornecem texto podem ser cadastrados',async t=>{
  assert.equal(idDoCartao({uid:'04 A2 24 B1 C2 D3 80',payload:'15'}),UID_A); assert.throws(()=>idDoCartao({}),{status:400});
  const f=await fixture(t); assert.equal((await f.register('','Ana',1,{payload:'15'})).status,201);
  const r=await f.call('/api/cartoes/usar',{acao:'abrir',payload:'15'}); assert.equal(r.status,200); assert.equal(r.data.mesa_id,1); assert.equal(r.data.cliente_nome,'Ana');
});

for (const android of [false,true]) test(`cozinha recebe mesa, cliente e cartão; fechamento preserva impressão (${android?'Android':'Windows/Linux'})`,async t=>{
  const f=await fixture(t),a=(await f.register()).data;
  if(android) f.db.prepare("INSERT INTO devices (id,estabelecimento_id,nome,plataforma,token_hash,token_expira_em,criado_em,atualizado_em) VALUES ('android',1,'S21','android','hash','2099-01-01','','')").run();
  else f.db.prepare("INSERT INTO gestores (id,estabelecimento_id,token,sessao_id) VALUES (1,1,'desktop-test','session')").run();
  f.db.prepare("INSERT INTO impressora_agentes (id,estabelecimento_id,nome,ip,ativo,imprime_pedidos,servidor_tipo,servidor_id) VALUES (1,1,'Cozinha','',1,1,?,?)").bind(android?'android':'desktop',android?'android':'1').run();
  f.db.prepare("INSERT INTO categorias (id,estabelecimento_id,nome,impressora_agente_id) VALUES (1,1,'Cozinha',1)").run();
  f.db.prepare('INSERT INTO produto_categorias (estabelecimento_id,produto_id,categoria_id) VALUES (1,1,1)').run();
  const r=await f.order(); assert.equal(r.status,200); assert.equal(r.data.cozinha.jobs.length,1);
  const job=f.db.prepare(`SELECT * FROM ${android?'device_tasks':'gestor_jobs'}`).first();
  const content=android?JSON.parse(job.payload_json).content:job.conteudo;
  assert.match(content,/MESA: 1/); assert.match(content,/CLIENTE: Ana/); assert.ok(content.includes(`CARTAO: ${UID_A}`));
  const print=f.db.prepare('SELECT * FROM pedido_impressoes').first();
  assert.equal((await f.close(a,20)).status,200);
  assert.deepEqual(f.db.prepare('SELECT * FROM pedido_impressoes').first(),print);
});

test('falha no arquivo do pagamento reverte venda, estoque, caixa e liberação do cartão',async t=>{
  const f=await fixture(t),a=(await f.register()).data; await f.order();
  f.db.db.exec("CREATE TRIGGER fail_archive BEFORE UPDATE OF comanda_id ON comanda_itens BEGIN SELECT RAISE(ABORT,'falha simulada'); END");
  const originalError=console.error; console.error=()=>{};
  try { assert.equal((await f.close(a,20)).status,500); } finally { console.error=originalError; }
  assert.equal((await f.lookup()).id,a.id);
  for(const tabela of ['vendas','pagamentos','estoque_movimentacoes','caixa']) assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${tabela}`).first().n,0);
  assert.equal(f.db.prepare('SELECT estoque_atual FROM produtos WHERE id=1').first().estoque_atual,100);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comandas').first().n,1);
  f.db.db.exec('DROP TRIGGER fail_archive'); assert.equal((await f.close(a,20)).status,200);
});

test('dois caixas não cobram simultaneamente a mesma pessoa; reenvio não repete estoque',async t=>{
  const f=await fixture(t),a=(await f.register()).data; await f.order();
  const rs=await Promise.all([f.close(a,20),f.close(a,20)]);
  assert.equal(rs.filter(r=>r.status===200 && !r.data.repetido).length,1);
  assert.ok(rs.every(r=>r.status===200 || r.status===409));
  assert.equal((await f.close(a,20)).status,200);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM vendas').first().n,1);
  assert.equal(f.db.prepare('SELECT estoque_atual FROM produtos WHERE id=1').first().estoque_atual,99);
});
