import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import SqliteDb from '../server/sqlite-db.js';
import { TenantDb } from '../shared/tenant-db.js';
import { createDespesaHandler, listDespesasHandler, listLancamentosHandler, resumoRelatorioHandler, cmvProdutosHandler } from '../shared/handlers-financeiro.js';
import { createProdutoHandler, updateProdutoHandler } from '../shared/handlers-catalog.js';
import { handle } from '../shared/router.js';
import { sha256 } from '../shared/util.js';

function context(body = {}, query = {}, id) {
  return { params: { id }, user: { id: 1, nome: 'Dono' },
    req: { json: async () => body, query: (key) => query[key] || '' },
    json: (data, status = 200) => ({ data, status }) };
}
function fixture(t) {
  const db = new SqliteDb(':memory:');
  t.after(() => db.close());
  db.prepare("INSERT INTO estabelecimentos (id,nome) VALUES (1,'Loja A'),(2,'Loja B')").run();
  const env = (id) => ({ DB: new TenantDb(db, id), rawDB: db, estabelecimentoId: id });
  return { db, a: env(1), b: env(2) };
}
const periodo = { de: '2026-10-01', ate: '2026-10-01' };

test('despesa aceita somente nome e valor, normaliza o nome e integra lançamento e caixa', async (t) => {
  const f = fixture(t);
  const result = await createDespesaHandler(context({ descricao: '  Gás da cozinha  ', valor: 125.5, data: periodo.de }), f.a);
  assert.equal(result.status, 201);
  assert.equal(result.data.descricao, 'Gás da cozinha');
  assert.equal(result.data.valor, 125.5);
  const despesas = (await listDespesasHandler(context(), f.a)).data;
  assert.equal(despesas.length, 1);
  assert.equal(despesas[0].categoria, null);
  assert.equal(despesas[0].forma_pagamento, null);
  assert.equal((await listDespesasHandler(context(), f.b)).data.length, 0);
  const lancamento = f.db.prepare('SELECT * FROM lancamentos').first();
  assert.equal(lancamento.ref_id, result.data.id);
  assert.equal(lancamento.ref_tipo, 'despesa');
  assert.equal(lancamento.valor, 125.5);
  const caixa = f.db.prepare('SELECT * FROM caixa').first();
  assert.equal(caixa.tipo, 'saida');
  assert.equal(caixa.valor, 125.5);
  assert.equal(caixa.estabelecimento_id, 1);
});

test('despesas sem nome ou com valor inválido não geram registros financeiros', async (t) => {
  const f = fixture(t);
  for (const body of [
    { descricao: '', valor: 10 }, { descricao: '   ', valor: 10 }, { descricao: {}, valor: 10 },
    { descricao: 'x'.repeat(201), valor: 10 },
    ...[0, -1, NaN, Infinity, -Infinity, 'inválido'].map((valor) => ({ descricao: 'Energia', valor })),
  ]) assert.equal((await createDespesaHandler(context(body), f.a)).status, 400);
  for (const tabela of ['despesas', 'lancamentos', 'caixa']) assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${tabela}`).first().n, 0);
});

test('data de despesa inválida é recusada e a data padrão continua disponível', async (t) => {
  const f = fixture(t);
  for (const data of ['2026-02-30', '2026-13-01', 'ontem', '2026-10-01T10:00:00']) {
    assert.equal((await createDespesaHandler(context({ descricao: 'Energia', valor: 10, data }), f.a)).status, 400);
  }
  const result = await createDespesaHandler(context({ descricao: 'Energia', valor: 10 }), f.a);
  assert.equal(result.status, 201);
  assert.match(result.data.data, /^\d{4}-\d{2}-\d{2}$/);
});

test('despesa, lançamento e saída de caixa são revertidos juntos se o caixa falhar', async (t) => {
  const f = fixture(t);
  f.db.db.exec("CREATE TRIGGER falha_despesa BEFORE INSERT ON caixa BEGIN SELECT RAISE(ABORT,'falha simulada'); END");
  await assert.rejects(createDespesaHandler(context({ descricao: 'Aluguel', valor: 100 }), f.a), /falha simulada/);
  for (const tabela of ['despesas', 'lancamentos', 'caixa']) assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${tabela}`).first().n, 0);
});

test('despesas com data sem horário entram no período e no lucro líquido sem misturar empresas', async (t) => {
  const f = fixture(t);
  await createDespesaHandler(context({ descricao: 'Energia', valor: 100, data: '2026-10-01' }), f.a);
  await createDespesaHandler(context({ descricao: 'Anterior', valor: 50, data: '2026-09-30' }), f.a);
  await createDespesaHandler(context({ descricao: 'Posterior', valor: 70, data: '2026-10-02' }), f.a);
  await createDespesaHandler(context({ descricao: 'Outra empresa', valor: 999, data: '2026-10-01' }), f.b);
  f.a.DB.prepare(`INSERT INTO lancamentos (data,tipo,descricao,valor) VALUES ('2026-10-01T23:59:59.000Z','despesa','No fim do dia',25)`).run();
  const lancamentos = await listLancamentosHandler(context({}, periodo), f.a);
  assert.equal(lancamentos.data.length, 2);
  assert.equal(lancamentos.data.reduce((s, item) => s + item.valor, 0), 125);
  const resumo = (await resumoRelatorioHandler(context({}, periodo), f.a)).data;
  assert.equal(resumo.despesas, 125);
  assert.equal(resumo.lucro_liquido, -125);
});

function catalogoCmv(f) {
  f.db.prepare(`INSERT INTO categorias (id,estabelecimento_id,nome,categoria_pai_id) VALUES
    (1,1,'Bar',NULL),(2,1,'Bebidas',1),(3,1,'Cozinha',NULL),(4,2,'Outra categoria',NULL)`).run();
  f.db.prepare(`INSERT INTO produtos (id,estabelecimento_id,nome,codigo_interno,custo,preco,tipo,ativo,exibir_restaurante,exibir_mercado) VALUES
    (1,1,'Água','AGUA',1,5,'produto',1,1,1),
    (2,1,'Prato','PRATO',10,20,'composto',1,1,0),
    (3,1,'Promoção','PROMO',8,5,'produto',1,1,0),
    (4,1,'Sem preço','SEM',2,NULL,'produto',1,0,0),
    (5,1,'Custo zerado','ZERO',0,7,'produto',1,1,1),
    (6,1,'Matéria-prima','MP',4,NULL,'insumo',1,0,0),
    (7,1,'Desativado','OFF',1,9,'produto',0,1,1),
    (8,2,'Outro estabelecimento','OUTRO',1,500,'produto',1,1,1),
    (9,1,'Adicional vendido','ADD',2,6,'insumo',1,1,0)`).run();
  f.db.prepare(`INSERT INTO produto_categorias (estabelecimento_id,produto_id,categoria_id) VALUES
    (1,1,1),(1,1,2),(1,2,3),(1,3,2),(2,8,4)`).run();
}

test('CMV lista produtos uma vez, calcula margem sobre o preço e respeita o estabelecimento', async (t) => {
  const f = fixture(t); catalogoCmv(f);
  const result = await cmvProdutosHandler(context(), f.a);
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.produtos.map((item) => item.id).sort((a,b) => a-b), [1,2,3,4,5,9]);
  assert.deepEqual(result.data.categorias.map((item) => item.id).sort(), [1,2,3]);
  const agua = result.data.produtos.find((item) => item.id === 1);
  assert.equal(agua.custo, 1);
  assert.equal(agua.preco, 5);
  assert.equal(agua.lucro_unitario, 4);
  assert.equal(agua.margem_pct, 80);
  assert.equal(agua.cmv_pct, 20);
  assert.equal(agua.categorias.length, 2);
  const prejuizo = result.data.produtos.find((item) => item.id === 3);
  assert.equal(prejuizo.lucro_unitario, -3);
  assert.equal(prejuizo.margem_pct, -60);
  assert.equal(prejuizo.cmv_pct, 160);
});

test('CMV sem preço não inventa margem e custo zero continua identificável', async (t) => {
  const f = fixture(t); catalogoCmv(f);
  f.db.prepare('UPDATE produtos SET preco=0 WHERE id=4').run();
  const { produtos } = (await cmvProdutosHandler(context(), f.a)).data;
  const sem = produtos.find((item) => item.id === 4);
  assert.equal(sem.lucro_unitario, null);
  assert.equal(sem.margem_pct, null);
  assert.equal(sem.cmv_pct, null);
  const zero = produtos.find((item) => item.id === 5);
  assert.equal(zero.custo, 0);
  assert.equal(zero.margem_pct, 100);
});

test('CMV de produto composto acompanha a alteração do custo dos insumos', async (t) => {
  const f = fixture(t);
  const insumo = await createProdutoHandler(context({ nome:'Insumo',tipo:'insumo',unidade:'UN',custo:12,sem_vencimento:true,validade_aberto_dias:2 }), f.a);
  assert.equal(insumo.status, 201);
  const prato = await createProdutoHandler(context({ nome:'Receita',tipo:'composto',unidade:'UN',preco:30,ficha:[{insumo_id:insumo.data.id,quantidade:2,unidade:'UN'}] }), f.a);
  assert.equal(prato.status, 201);
  let produto = (await cmvProdutosHandler(context(), f.a)).data.produtos.find((item) => item.id === prato.data.id);
  assert.equal(produto.custo, 24);
  assert.equal(produto.margem_pct, 20);
  assert.equal((await updateProdutoHandler(context({ nome:'Insumo', custo:6 }, {}, String(insumo.data.id)), f.a)).status, 200);
  produto = (await cmvProdutosHandler(context(), f.a)).data.produtos.find((item) => item.id === prato.data.id);
  assert.equal(produto.custo, 12);
  assert.equal(produto.lucro_unitario, 18);
  assert.equal(produto.margem_pct, 60);
});

const code = ts.transpileModule(readFileSync('src/lib/relatorio-cmv.ts','utf8'), { compilerOptions:{ module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022 } }).outputText;
const { filtrarProdutosCmv } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('filtro de CMV inclui subcategorias, busca sem acentos e produtos sem categoria', async (t) => {
  const f = fixture(t); catalogoCmv(f);
  const { produtos,categorias } = (await cmvProdutosHandler(context(), f.a)).data;
  assert.deepEqual(filtrarProdutosCmv(produtos,categorias,'1','','lucro_desc').map((item) => item.id), [1,3]);
  assert.deepEqual(filtrarProdutosCmv(produtos,categorias,'2','agua','lucro_desc').map((item) => item.id), [1]);
  assert.deepEqual(filtrarProdutosCmv(produtos,categorias,'','PRATO','lucro_desc').map((item) => item.id), [2]);
  assert.deepEqual(filtrarProdutosCmv(produtos,categorias,'sem','','nome').map((item) => item.id), [9,5,4]);
});

test('ordenação distingue lucro em reais de margem percentual e mantém sem preço no final', async (t) => {
  const f = fixture(t); catalogoCmv(f);
  const { produtos,categorias } = (await cmvProdutosHandler(context(), f.a)).data;
  assert.equal(filtrarProdutosCmv(produtos,categorias,'','','lucro_desc')[0].id, 2);
  assert.equal(filtrarProdutosCmv(produtos,categorias,'','','margem_desc')[0].id, 5);
  assert.equal(filtrarProdutosCmv(produtos,categorias,'','','lucro_asc')[0].id, 3);
  for (const ordem of ['lucro_desc','lucro_asc','margem_desc','margem_asc']) assert.equal(filtrarProdutosCmv(produtos,categorias,'','',ordem).at(-1).id, 4);
  const ordenados = filtrarProdutosCmv(produtos,categorias,'','','categoria');
  assert.equal(ordenados[0].id, 1);
  assert.equal(ordenados.length, produtos.length);
  assert.notEqual(ordenados, produtos);
});

test('rota de CMV exige sessão e retorna somente os produtos da empresa autenticada', async (t) => {
  const f = fixture(t); catalogoCmv(f);
  const c = (token='') => ({ req:{path:'/api/relatorios/cmv-produtos',method:'GET',header:(key)=>key==='cookie'?`simplesx_session=${token}`:'',query:()=>''},json:(data,status=200)=>({data,status}) });
  assert.equal((await handle(c(),{DB:f.db})).status,401);
  f.db.prepare("INSERT INTO funcionarios (id,estabelecimento_id,nome,usuario,senha_hash,modulos) VALUES (1,1,'Gestor','gestor','hash','gestor,area:gestao')").run();
  f.db.prepare("INSERT INTO sessoes (estabelecimento_id,funcionario_id,token_hash,expira_em) VALUES (1,1,?,'2099-01-01')").bind(await sha256('sessao-teste')).run();
  const result = await handle(c('sessao-teste'),{DB:f.db});
  assert.equal(result.status,200);
  assert.ok(!result.data.produtos.some((item)=>item.id===8));
});
