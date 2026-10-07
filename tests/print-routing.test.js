import assert from 'node:assert/strict';
import test from 'node:test';
import SqliteDb from '../server/sqlite-db.js';
import { TenantDb } from '../shared/tenant-db.js';
import { dispatchOrders } from '../shared/order-printing.js';
import { imprimirComandaHandler, imprimirEtiquetaHandler, imprimirVendaHandler } from '../shared/handlers-cadastros.js';
import { enviarImpressaoHandler } from '../shared/handlers-gestor.js';
import { selectPrinter } from '../gestor-impressora/src/printer-discovery.cjs';

function fixture(t, platform = 'desktop', destination = null) {
  const db = new SqliteDb(':memory:');
  t.after(() => db.close());
  db.prepare("INSERT INTO estabelecimentos (id,nome) VALUES (1,'Restaurante')").run();
  db.prepare("INSERT INTO gestores (id,estabelecimento_id,token,sessao_id) VALUES (1,1,'desktop-token','session')").run();
  db.prepare(`INSERT INTO devices (id,estabelecimento_id,nome,plataforma,token_hash,token_expira_em,criado_em,atualizado_em)
    VALUES ('android',1,'Android','android','hash','2099-01-01','','')`).run();
  db.prepare(`INSERT INTO empresa_config (estabelecimento_id,chave,valor) VALUES
    (1,'gestor_token','desktop-token'),(1,'gestor_device_id','android')`).run();
  db.prepare(`INSERT INTO impressora_agentes
    (id,estabelecimento_id,nome,ip,servidor_tipo,servidor_id,impressora_destino,imprime_pedidos,imprime_conta,imprime_venda,imprime_validade)
    VALUES (1,1,'Cozinha','',?,?,?,1,1,1,1)`)
    .bind(platform, platform === 'android' ? 'android' : platform === 'desktop' ? '1' : null, destination).run();
  db.prepare("INSERT INTO produtos (id,estabelecimento_id,nome,preco) VALUES (1,1,'Prato',20)").run();
  db.prepare("INSERT INTO categorias (id,estabelecimento_id,nome,impressora_agente_id) VALUES (1,1,'Pratos',1)").run();
  db.prepare('INSERT INTO produto_categorias (estabelecimento_id,produto_id,categoria_id) VALUES (1,1,1)').run();
  db.prepare("INSERT INTO mesas (id,estabelecimento_id,numero,status) VALUES (1,1,1,'ocupada')").run();
  db.prepare('INSERT INTO comandas (id,estabelecimento_id,mesa_id) VALUES (1,1,1)').run();
  db.prepare(`INSERT INTO comanda_itens (id,estabelecimento_id,comanda_id,produto_id,nome,quantidade,preco_unitario)
    VALUES (1,1,1,1,'Prato',1,20)`).run();
  db.prepare(`INSERT INTO validade_controles (id,estabelecimento_id,produto_id,tipo,data_vencimento)
    VALUES (1,1,1,'aberto','2099-01-01')`).run();
  db.prepare("INSERT INTO vendas (id,estabelecimento_id,numero,tipo,criado_em) VALUES (1,1,'1','pdv','2026-10-07')").run();
  const env = { DB: new TenantDb(db, 1), rawDB: db, estabelecimentoId: 1 };
  const context = (body = {}) => ({
    params: { id: '1' }, user: { id: 1 }, req: { json: async () => body, query: () => '' },
    json: (data, status = 200) => ({ data, status }),
  });
  return { db, env, context };
}

const documents = {
  pedido: (f) => dispatchOrders(f.context(), f.env, { comanda_id: 1 }),
  conta: (f) => imprimirComandaHandler(f.context({ comanda_id: 1, tipo: 'conta' }), f.env),
  etiqueta: (f) => imprimirEtiquetaHandler(f.context(), f.env),
  venda: (f) => imprimirVendaHandler(f.context(), f.env),
};

for (const platform of ['desktop', 'android']) {
  for (const destination of [null, 'Termica USB']) {
    for (const [document, send] of Object.entries(documents)) {
      test(`${document} via ${platform} usa ${destination || 'a impressora padrão do gestor'}, independentemente do nome da rota`, async (t) => {
        const f = fixture(t, platform, destination);
        await send(f);
        const desktopJobs = f.db.prepare('SELECT * FROM gestor_jobs').all().results;
        const androidJobs = f.db.prepare('SELECT * FROM device_tasks').all().results;
        assert.equal(desktopJobs.length, platform === 'desktop' ? 1 : 0);
        assert.equal(androidJobs.length, platform === 'android' ? 1 : 0);
        const printer = platform === 'desktop' ? desktopJobs[0].impressora : JSON.parse(androidJobs[0].payload_json).printer;
        assert.equal(printer, destination);
        if (platform === 'desktop') {
          const installed = [{ name: 'Termica USB' }, { name: 'Outra impressora', isDefault: true }];
          assert.equal(selectPrinter(installed, printer, 'Termica USB').name, 'Termica USB');
        }
      });
    }
  }
}

test('rota antiga sem servidor explícito preserva o nome da fila cadastrada', async (t) => {
  const f = fixture(t, null);
  f.db.prepare("DELETE FROM empresa_config WHERE chave='gestor_device_id'").run();
  await documents.pedido(f);
  await documents.etiqueta(f);
  assert.deepEqual(f.db.prepare('SELECT impressora FROM gestor_jobs ORDER BY id').all().results,
    [{ impressora: 'Cozinha' }, { impressora: 'Cozinha' }]);
});

test('teste direcionado ao desktop não é desviado para o Android padrão', async (t) => {
  const f = fixture(t);
  const response = await enviarImpressaoHandler(f.context({ conteudo: 'Teste', gestor_token: 'desktop-token' }), f.env);
  assert.equal(response.status, 201);
  assert.ok(response.data.job_id);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM device_tasks').first().n, 0);
  assert.equal(f.db.prepare('SELECT gestor_token FROM gestor_jobs').first().gestor_token, 'desktop-token');
});

test('impressão sem destino explícito mantém o Android padrão', async (t) => {
  const f = fixture(t);
  const response = await enviarImpressaoHandler(f.context({ conteudo: 'Teste' }), f.env);
  assert.equal(response.status, 201);
  assert.ok(response.data.task_id);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM gestor_jobs').first().n, 0);
});
