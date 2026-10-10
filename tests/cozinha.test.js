import assert from 'node:assert/strict';
import test from 'node:test';
import SqliteDb from '../server/sqlite-db.js';
import { TenantDb } from '../shared/tenant-db.js';
import { painelCozinhaHandler } from '../shared/handlers-online.js';

function context() {
  return {
    params: {},
    user: { id: 1 },
    req: { json: async () => ({}), header: () => '', query: () => '' },
    json: (data, status = 200) => ({ data, status }),
  };
}

function nomes(painel, estacao) {
  return painel.data.estacoes.find((item) => item.id === estacao).lancamentos
    .flatMap((lancamento) => lancamento.itens.map((item) => item.nome));
}

test('a cozinha separa lançamentos do bar e da cozinha e esconde outra empresa', async (t) => {
  const raw = new SqliteDb(':memory:');
  t.after(() => raw.close());
  raw.prepare("INSERT INTO estabelecimentos (id,nome,ativo) VALUES (1,'Brasa',1),(2,'Outra',1)").run();
  raw.prepare(`INSERT INTO impressora_agentes (id,estabelecimento_id,nome,ip,porta,tipo,protocolo,ativo,imprime_pedidos,criado_em)
    VALUES (1,1,'Cozinha quente','0',9100,'impressora','raw',1,1,''),(2,1,'Copa do bar','0',9100,'impressora','raw',1,1,'')`).run();
  raw.prepare(`INSERT INTO categorias (id,estabelecimento_id,nome,impressora_agente_id,criado_em)
    VALUES (1,1,'Lanches',1,''),(2,1,'Bebidas',2,''),(3,1,'Sucos',NULL,'')`).run();
  raw.prepare('UPDATE categorias SET categoria_pai_id=2 WHERE id=3').run();
  raw.prepare(`INSERT INTO produtos (id,estabelecimento_id,nome,codigo_interno,preco,ativo,tipo,sem_vencimento,criado_em) VALUES
    (10,1,'X-burger','XB',20,1,'produto',1,''),
    (11,1,'Suco','SU',8,1,'produto',1,''),
    (12,1,'Pao','PA',2,1,'produto',1,''),
    (13,1,'Combo','CB',30,1,'produto',1,'')`).run();
  raw.prepare(`INSERT INTO produto_categorias (estabelecimento_id,produto_id,categoria_id) VALUES
    (1,10,1),(1,11,3),(1,13,1),(1,13,2)`).run();
  raw.prepare(`INSERT INTO mesas (id,estabelecimento_id,numero,nome,capacidade,status,ativo,criado_em,tipo) VALUES
    (2,1,4,'Mesa 4',4,'ocupada',1,'','normal'),
    (3,1,5,'Mesa 5',4,'ocupada',1,'','normal'),
    (4,2,4,'Mesa 4',4,'ocupada',1,'','normal')`).run();
  raw.prepare(`INSERT INTO comandas (id,estabelecimento_id,mesa_id,cliente_nome,garcom_nome,status,criado_em) VALUES
    (2,1,2,'Lia','Ana','aberta','2026-10-09T10:00:00.000Z'),
    (3,1,3,'Fechada','Ana','fechada','2026-10-09T10:00:00.000Z'),
    (4,2,4,'Outra','Joao','aberta','2026-10-09T10:00:00.000Z')`).run();
  raw.prepare(`INSERT INTO comanda_itens (id,estabelecimento_id,comanda_id,produto_id,nome,quantidade,observacao,status,enviado_em,criado_em) VALUES
    (1,1,2,10,'X-burger',1,'sem cebola','enviado','2026-10-09T12:00:00.000Z','2026-10-09T11:00:00.000Z'),
    (2,1,2,10,'Batata',1,NULL,'enviado','2026-10-09T12:00:00.000Z','2026-10-09T11:01:00.000Z'),
    (3,1,2,11,'Suco',2,NULL,'enviado','2026-10-09T12:05:00.000Z','2026-10-09T12:04:00.000Z'),
    (4,1,2,12,'Pao',1,NULL,'novo',NULL,'2026-10-09T12:06:00.000Z'),
    (5,1,2,13,'Combo',1,NULL,'enviado','2026-10-09T12:07:00.000Z','2026-10-09T12:07:00.000Z'),
    (6,1,2,10,'Pronto',1,NULL,'entregue','2026-10-09T11:00:00.000Z','2026-10-09T11:00:00.000Z'),
    (7,1,3,10,'Encerrado',1,NULL,'enviado','2026-10-09T12:00:00.000Z','2026-10-09T12:00:00.000Z'),
    (8,2,4,10,'Segredo',1,NULL,'enviado','2026-10-09T12:00:00.000Z','2026-10-09T12:00:00.000Z')`).run();

  const painel = await painelCozinhaHandler(context(), { DB: new TenantDb(raw, 1), rawDB: raw, estabelecimentoId: 1 });
  assert.equal(painel.status, 200);
  assert.deepEqual(painel.data.estacoes.map((estacao) => estacao.id), ['cozinha', 'bar', 'sem-rota']);
  const cozinha = painel.data.estacoes[0].lancamentos;
  const bar = painel.data.estacoes[1].lancamentos;
  assert.equal(cozinha.length, 2);
  assert.deepEqual(cozinha[0].itens.map((item) => item.nome), ['X-burger', 'Batata']);
  assert.equal(cozinha[0].lugar, 'Mesa 4');
  assert.equal(cozinha[0].status, 'enviado');
  assert.equal(cozinha[1].itens[0].nome, 'Combo');
  assert.deepEqual(bar.flatMap((lancamento) => lancamento.itens.map((item) => item.nome)), ['Suco', 'Combo']);
  assert.equal(bar[0].lugar, 'Mesa 4');
  assert.ok(nomes(painel, 'cozinha').includes('X-burger'));
  assert.equal(nomes(painel, 'cozinha').includes('Suco'), false);
  assert.equal(nomes(painel, 'cozinha').includes('Segredo'), false);
  assert.equal(nomes(painel, 'cozinha').includes('Pronto'), false);
  assert.equal(nomes(painel, 'cozinha').includes('Encerrado'), false);
  const semDestino = painel.data.estacoes.find((estacao) => estacao.id === 'sem-rota');
  assert.equal(semDestino.nome, 'Sem destino');
  assert.deepEqual(semDestino.lancamentos[0].itens.map((item) => item.nome), ['Pao']);
  assert.equal(JSON.stringify(painel.data).includes('Segredo'), false);
});
