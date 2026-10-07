import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import SqliteDb from '../server/sqlite-db.js';
import { TenantDb } from '../shared/tenant-db.js';
import { createProdutoHandler, updateProdutoHandler, entradaMercadoriaHandler, listProdutosHandler } from '../shared/handlers-catalog.js';
import { criarValidadeHandler, listValidadeHandler } from '../shared/handlers-vendas.js';
import { imprimirEtiquetaHandler } from '../shared/handlers-cadastros.js';

function context(body = {}, id, query = {}) {
  return {
    user: { id: 1, nome: 'Dono' }, params: { id: String(id || '') },
    req: { json: async () => body, query: (name) => query[name] || '' },
    json: (data, status = 200) => ({ data, status }),
  };
}

function fixture(t) {
  const DB = new SqliteDb(':memory:');
  t.after(() => DB.close());
  DB.prepare("INSERT INTO estabelecimentos (id,nome) VALUES (1,'Loja A'),(2,'Loja B')").run();
  const tenant = (id) => ({ DB: new TenantDb(DB, id), rawDB: DB, estabelecimentoId: id });
  return { DB, a: tenant(1), b: tenant(2) };
}

const produto = { nome: 'Produto teste', tipo: 'produto', unidade: 'UN', preco: 12, custo: 4 };
const comValidade = { ...produto, data_fabricacao: '2026-10-01', data_vencimento: '2026-10-31', validade_fabricacao_dias: 30 };

test('migração mantém produtos existentes com suas datas e vencimento habilitado', (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const dir = new URL('../migrations/', import.meta.url);
  const nova = '0024_produtos_sem_vencimento.sql';
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql') && f < nova).sort()) {
    db.exec(readFileSync(new URL(file, dir), 'utf8'));
  }
  db.exec("INSERT INTO produtos (nome,data_fabricacao,data_vencimento,validade_aberto_dias) VALUES ('Existente','2026-10-01','2026-10-31',5)");
  db.exec(readFileSync(new URL(nova, dir), 'utf8'));
  assert.deepEqual({ ...db.prepare('SELECT nome,sem_vencimento,data_vencimento,validade_aberto_dias FROM produtos').get() }, {
    nome: 'Existente', sem_vencimento: 0, data_vencimento: '2026-10-31', validade_aberto_dias: 5,
  });
});

test('produto sem vencimento aceita cadastro e entrada sem datas, sem gerar alertas de fabricação', async (t) => {
  const f = fixture(t);
  const criado = await createProdutoHandler(context({ ...produto, sem_vencimento: true, estoque_atual: 2 }), f.a);
  assert.equal(criado.status, 201);
  assert.equal(criado.data.sem_vencimento, 1);
  assert.equal(criado.data.data_vencimento, null);
  assert.equal(criado.data.data_fabricacao, null);
  assert.equal(criado.data.validade_fabricacao_dias, null);
  const entrada = await entradaMercadoriaHandler(context({ produto_id: criado.data.id, quantidade: 3 }), f.a);
  assert.equal(entrada.status, 200);
  assert.equal(entrada.data.novo_saldo, 5);
  const lotes = f.DB.prepare('SELECT data_validade, quantidade FROM lotes ORDER BY id').all().results;
  assert.deepEqual(lotes, [{ data_validade: null, quantidade: 2 }, { data_validade: null, quantidade: 3 }]);
  assert.equal(f.DB.prepare('SELECT COUNT(*) AS n FROM validade_controles').first().n, 0);
  assert.equal(f.DB.prepare('SELECT SUM(quantidade) AS qtd FROM estoque_movimentacoes').first().qtd, 5);
});

test('sem vencimento descarta datas antigas enviadas no cadastro ou na entrada', async (t) => {
  const f = fixture(t);
  const criado = await createProdutoHandler(context({ ...comValidade, sem_vencimento: 1, estoque_atual: 1 }), f.a);
  assert.equal(criado.status, 201);
  assert.equal(criado.data.data_vencimento, null);
  assert.equal(criado.data.validade_fabricacao_dias, null);
  const entrada = await entradaMercadoriaHandler(context({
    produto_id: criado.data.id, quantidade: 2, data_fabricacao: '2026-10-01', data_validade: '2026-09-01',
  }), f.a);
  assert.equal(entrada.status, 200);
  assert.equal(f.DB.prepare('SELECT COUNT(*) AS n FROM lotes WHERE data_validade IS NOT NULL').first().n, 0);
  assert.equal(f.DB.prepare('SELECT COUNT(*) AS n FROM validade_controles').first().n, 0);
});

for (const tipo of ['produto', 'insumo']) {
  test(`${tipo} sem vencimento mantém o prazo após abertura, a busca e a etiqueta`, async (t) => {
    const f = fixture(t);
    const criado = await createProdutoHandler(context({ ...produto, tipo, sem_vencimento: 1, validade_aberto_dias: 5 }), f.a);
    assert.equal(criado.status, 201);
    const editado = await updateProdutoHandler(context({ nome: 'Produto renomeado', preco: 12 }, criado.data.id), f.a);
    assert.equal(editado.status, 200);
    assert.equal(editado.data.sem_vencimento, 1);
    assert.equal(editado.data.validade_aberto_dias, 5);
    const busca = await listProdutosHandler(context({}, undefined, { busca: 'renomeado' }), f.a);
    assert.equal(busca.data[0].id, criado.data.id);
    assert.equal(busca.data[0].sem_vencimento, 1);
    const aberto = await criarValidadeHandler(context({
      produto_id: criado.data.id, quantidade: 1, tipo: 'aberto', data_abertura: '2026-10-06', responsavel: 'Maria',
    }), f.a);
    assert.equal(aberto.status, 201);
    assert.equal(aberto.data.data_vencimento, '2026-10-11');
    const etiqueta = await imprimirEtiquetaHandler(context({}, aberto.data.id), f.a);
    assert.equal(etiqueta.status, 200);
    assert.match(etiqueta.data.impressao, /ABERTO: 2026-10-06/);
    assert.match(etiqueta.data.impressao, /VENCE: 2026-10-11/);
    assert.match(etiqueta.data.impressao, /RESP: Maria/);
    const controles = await listValidadeHandler(context(), f.a);
    assert.equal(controles.data.length, 1);
    assert.equal(controles.data[0].tipo, 'aberto');
    assert.equal(controles.data[0].validade_aberto_dias, 5);
    assert.equal((await listValidadeHandler(context(), f.b)).data.length, 0);
    assert.equal((await imprimirEtiquetaHandler(context({}, aberto.data.id), f.b)).status, 404);
  });
}

test('editar sem vencimento limpa a validade fechada e preserva lotes e etiquetas já registrados', async (t) => {
  const f = fixture(t);
  const criado = await createProdutoHandler(context({ ...comValidade, estoque_atual: 2, validade_aberto_dias: 3 }), f.a);
  const aberto = await criarValidadeHandler(context({ produto_id: criado.data.id, data_abertura: '2026-10-06' }), f.a);
  const editado = await updateProdutoHandler(context({ ...comValidade, sem_vencimento: 1, data_fabricacao: null }, criado.data.id), f.a);
  assert.equal(editado.status, 200);
  assert.equal(editado.data.data_fabricacao, null);
  assert.equal(editado.data.data_vencimento, null);
  assert.equal(editado.data.validade_fabricacao_dias, null);
  assert.equal(editado.data.validade_aberto_dias, 3);
  assert.equal(f.DB.prepare('SELECT data_validade FROM lotes').first().data_validade, '2026-10-31');
  assert.equal(f.DB.prepare('SELECT COUNT(*) AS n FROM validade_controles').first().n, 2);
  assert.equal(f.DB.prepare('SELECT data_vencimento FROM validade_controles WHERE id=?').bind(aberto.data.id).first().data_vencimento, '2026-10-09');
  const invalido = await updateProdutoHandler(context({ ...produto, sem_vencimento: false }, criado.data.id), f.a);
  assert.equal(invalido.status, 400);
  const restaurado = await updateProdutoHandler(context({ ...comValidade, sem_vencimento: false }, criado.data.id), f.a);
  assert.equal(restaurado.status, 200);
  assert.equal(restaurado.data.sem_vencimento, 0);
  assert.equal(restaurado.data.data_vencimento, '2026-10-31');
});

test('produtos comuns continuam exigindo datas e gerando controle de vencimento', async (t) => {
  const f = fixture(t);
  assert.equal((await createProdutoHandler(context(produto), f.a)).status, 400);
  assert.equal((await createProdutoHandler(context({ ...comValidade, data_vencimento: '2026-09-30' }), f.a)).status, 400);
  const criado = await createProdutoHandler(context({ ...comValidade, estoque_atual: 2 }), f.a);
  assert.equal(criado.status, 201);
  assert.equal(criado.data.sem_vencimento, 0);
  const entrada = { produto_id: criado.data.id, quantidade: 1 };
  assert.equal((await entradaMercadoriaHandler(context({ ...entrada, sem_vencimento: true }), f.a)).status, 400);
  assert.equal((await entradaMercadoriaHandler(context({ ...entrada, data_fabricacao: '2026-10-01', data_validade: '2026-10-31' }), f.a)).status, 200);
  assert.equal(f.DB.prepare('SELECT COUNT(*) AS n FROM validade_controles').first().n, 2);
});

test('sem vencimento não remove a exigência de pós-abertura do insumo nem inventa prazo para etiquetas', async (t) => {
  const f = fixture(t);
  const insumo = { ...produto, tipo: 'insumo', sem_vencimento: 1 };
  assert.equal((await createProdutoHandler(context(insumo), f.a)).status, 400);
  const criado = await createProdutoHandler(context({ ...insumo, validade_aberto_dias: 5 }), f.a);
  assert.equal((await updateProdutoHandler(context({ ...insumo, validade_aberto_dias: null }, criado.data.id), f.a)).status, 400);
  const simples = await createProdutoHandler(context({ ...produto, sem_vencimento: 1 }), f.a);
  assert.equal((await criarValidadeHandler(context({ produto_id: simples.data.id }), f.a)).status, 400);
});
