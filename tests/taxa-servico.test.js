import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import SqliteDb from '../server/sqlite-db.js';
import { TenantDb } from '../shared/tenant-db.js';
import { fecharComandaHandler } from '../shared/handlers-vendas.js';

const code = ts.transpileModule(readFileSync('src/lib/taxa-servico.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const { taxaServicoAtual } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('polling não substitui zero nem o campo vazio durante a edição da taxa', () => {
  assert.equal(taxaServicoAtual(1,10,null),'10');
  for (const valor of ['0','','5.5']) for (const recebida of [10,12,0]) {
    assert.equal(taxaServicoAtual(1,recebida,{comandaId:1,valor}),valor);
  }
  assert.equal(taxaServicoAtual(2,15,{comandaId:1,valor:'0'}),'15');
  const source = readFileSync('src/pages/ComandaPage.tsx','utf8');
  assert.match(source,/taxaServicoAtual\(comandaId, comanda\?\.taxa_garcom_pct, taxaEditada\)/);
  const load = source.slice(source.indexOf('const loadComanda ='),source.indexOf('useEffect(() => {'));
  assert.doesNotMatch(load,/setTaxa/);
});

function fixture(t) {
  const db = new SqliteDb(':memory:');
  t.after(()=>db.close());
  db.prepare("INSERT INTO estabelecimentos (id,nome) VALUES (1,'Restaurante')").run();
  db.prepare("INSERT INTO mesas (id,estabelecimento_id,numero,status) VALUES (1,1,1,'ocupada')").run();
  db.prepare("INSERT INTO mesas (id,estabelecimento_id,numero,status,tipo) VALUES (2,1,999,'livre','pagamentos')").run();
  db.prepare("INSERT INTO comandas (id,estabelecimento_id,mesa_id,status,taxa_garcom_pct) VALUES (1,1,1,'aberta',10)").run();
  db.prepare("INSERT INTO produtos (id,estabelecimento_id,nome,preco,custo,estoque_atual) VALUES (1,1,'Prato',50,15,10)").run();
  db.prepare("INSERT INTO comanda_pessoas (id,estabelecimento_id,comanda_id,nome) VALUES (1,1,1,'Cliente')").run();
  db.prepare(`INSERT INTO comanda_itens (id,estabelecimento_id,comanda_id,pessoa_id,produto_id,nome,quantidade,preco_unitario,status)
    VALUES (1,1,1,1,1,'Prato',2,50,'entregue')`).run();
  const env={DB:new TenantDb(db,1),rawDB:db,estabelecimentoId:1};
  const close = (body={}) => fecharComandaHandler({params:{id:'1'},req:{json:async()=>body},json:(data,status=200)=>({data,status})},env);
  return {db,env,close};
}

for (const tipo of ['unica','divisao']) test(`fechamento ${tipo} aceita taxa zero e não cobra o percentual padrão`,async(t)=>{
  const f=fixture(t);
  const result=await f.close({tipo,taxa_garcom_pct:0,forma:'pix'});
  assert.equal(result.status,200);
  assert.equal(result.data.total,100);
  const venda=f.db.prepare('SELECT * FROM vendas').first();
  assert.equal(venda.subtotal,100);
  assert.equal(venda.taxa_servico,0);
  assert.equal(venda.total,100);
  assert.equal(f.db.prepare('SELECT taxa_garcom_pct FROM comandas WHERE id=1').first().taxa_garcom_pct,0);
  assert.equal(f.db.prepare('SELECT SUM(valor) total FROM pagamentos').first().total,100);
  assert.equal(f.db.prepare('SELECT estoque_atual FROM produtos WHERE id=1').first().estoque_atual,8);
});

test('taxa zero permanece no pré-fechamento e na baixa posterior',async(t)=>{
  const f=fixture(t);
  const pre=await f.close({tipo:'unica',pre_fechar:true,taxa_garcom_pct:0});
  assert.equal(pre.status,200);
  assert.equal(pre.data.total,100);
  assert.equal(f.db.prepare('SELECT taxa_garcom_pct FROM comandas WHERE id=1').first().taxa_garcom_pct,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM vendas').first().n,0);
  assert.equal((await f.close({tipo:'unica'})).data.total,100);
  assert.equal(f.db.prepare('SELECT taxa_servico FROM vendas').first().taxa_servico,0);
});

test('conta pré-fechada com 10% pode ser baixada sem taxa de serviço',async(t)=>{
  const f=fixture(t);
  assert.equal((await f.close({tipo:'unica',pre_fechar:true})).data.total,110);
  assert.equal((await f.close({tipo:'unica',taxa_garcom_pct:0})).data.total,100);
  assert.equal(f.db.prepare('SELECT taxa_servico FROM vendas').first().taxa_servico,0);
});

test('pagamento individual inicia com taxa zero e valores sem acréscimo',async(t)=>{
  const f=fixture(t);
  const result=await f.close({tipo:'individual',taxa_garcom_pct:0,pessoas_valores:[{pessoa_id:1,valor:100}]});
  assert.equal(result.status,200);
  assert.equal(result.data.total,100);
  const pagamentos=f.db.prepare('SELECT * FROM comandas WHERE id=?').bind(result.data.comanda_pagamentos_id).first();
  assert.equal(pagamentos.taxa_garcom_pct,0);
  assert.equal(Object.values(JSON.parse(pagamentos.individual_valores).valores).reduce((s,v)=>s+v,0),100);
});

test('taxa inválida é recusada sem fechar a mesa ou bloquear novas tentativas',async(t)=>{
  const f=fixture(t);
  for (const taxa_garcom_pct of [-1,101,NaN,Infinity,'inválida']) {
    assert.equal((await f.close({tipo:'unica',taxa_garcom_pct})).status,400);
    const comanda=f.db.prepare('SELECT * FROM comandas WHERE id=1').first();
    assert.equal(comanda.status,'aberta');
    assert.equal(comanda.fechamento_bloqueado_ate,null);
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM vendas').first().n,0);
  assert.equal((await f.close({tipo:'unica'})).data.total,110);
});
