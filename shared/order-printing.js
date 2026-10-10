import { estabelecimentoId, getConfig, httpError, now, num } from './util.js';

const ascii = (value) => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[–—]/g, '-').replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
const ids = (value) => [...new Set(String(value || '').split(',').map(Number).filter((id) => id > 0))];

// Reserva de cada item/destino + criação dos trabalhos + mudança de status:
// uma única transação. A restrição UNIQUE é a autoridade entre dispositivos.
export async function dispatchOrders(c, env, body) {
  const tenant = estabelecimentoId(env);
  const comandaId = Number(body.comanda_id);
  const command = await env.DB.prepare(`SELECT c.*,m.numero,m.tipo AS mesa_tipo,m.nfc_uid
    FROM comandas c JOIN mesas m ON m.id=c.mesa_id WHERE c.id=?`)
    .bind(comandaId).first();
  if (!command) throw httpError(404, 'Comanda não encontrada');
  if (command.status !== 'aberta' || command.comanda_origem_id) throw httpError(409, 'Somente comandas abertas podem enviar pedidos');
  if (command.fechamento_bloqueado_ate > now()) throw httpError(409, 'A conta está sendo fechada. Aguarde a confirmação antes de enviar.');
  if (body.itens_ids !== undefined && (!Array.isArray(body.itens_ids) || !body.itens_ids.length || body.itens_ids.some((id) => !Number.isInteger(id) || id <= 0))) {
    throw httpError(400, 'Selecione os itens do pedido');
  }
  const selected = body.itens_ids ? new Set(body.itens_ids) : null;
  const rows = await env.DB.prepare(`SELECT i.*,
    (SELECT GROUP_CONCAT(DISTINCT COALESCE(cat.impressora_agente_id,pai.impressora_agente_id))
      FROM produto_categorias pc JOIN categorias cat ON cat.id=pc.categoria_id
      LEFT JOIN categorias pai ON pai.id=cat.categoria_pai_id WHERE pc.produto_id=i.produto_id) AS impressora_ids
    FROM comanda_itens i WHERE i.comanda_id=? AND i.status='novo' ORDER BY i.id`).bind(comandaId).all();
  const items = rows.results.filter((i) => !selected || selected.has(i.id));
  const routes = (await env.DB.prepare('SELECT * FROM impressora_agentes WHERE ativo=1 AND imprime_pedidos=1').all()).results;
  const config = await getConfig(env);
  const timestamp = now();
  const missing = items.filter((i) => !ids(i.impressora_ids).length).map((i) => i.nome);
  const failures = [];
  const statements = [];
  const batches = [];
  const db = env.rawDB;
  const expected = items.flatMap((item) => ids(item.impressora_ids).map((route) => ({ item: item.id, route })));

  for (const routeId of [...new Set(expected.map((pair) => pair.route))]) {
    const route = routes.find((r) => r.id === routeId);
    if (!route) { failures.push({ impressora: `Rota ${routeId}`, erro: 'Impressora desativada ou não configurada para pedidos' }); continue; }
    const deviceId = route.servidor_tipo === 'android' ? String(route.servidor_id || '') : !route.servidor_tipo ? config.gestor_device_id : '';
    const server = deviceId
      ? await env.DB.prepare('SELECT id FROM devices WHERE id=? AND revogado_em IS NULL AND token_expira_em>?').bind(deviceId, timestamp).first()
      : route.servidor_tipo === 'desktop'
        ? await env.DB.prepare('SELECT id,token FROM gestores WHERE id=? AND ativo=1').bind(route.servidor_id).first()
        : await env.DB.prepare('SELECT id,token FROM gestores WHERE token=? AND ativo=1').bind(config.gestor_token || '').first();
    if (!server) { failures.push({ impressora: route.nome, erro: 'Servidor não configurado ou credencial expirada' }); continue; }
    const routeItems = items.filter((item) => ids(item.impressora_ids).includes(routeId));
    const waiters = [...new Set(routeItems.map((item) => JSON.stringify([item.funcionario_id, item.responsavel || command.garcom_nome || 'Não informado'])))];
    for (const waiter of waiters) {
      const [actorId, actorName] = JSON.parse(waiter);
      const group = routeItems.filter((item) => JSON.stringify([item.funcionario_id, item.responsavel || command.garcom_nome || 'Não informado']) === waiter);
      const batchId = crypto.randomUUID();
      const snapshots = JSON.stringify(group.map((item) => ({ id: item.id, versao: item.versao, texto: ascii([
        `#${item.id}  ${num(item.quantidade)}x ${item.nome}`,
        ...String(item.observacao || '').split('\n').filter(Boolean).map((line) => `  (${line})`),
      ].join('\n')) })));
      const header = ascii([
        '='.repeat(32), String(config.empresa_nome || 'MEU NEGÓCIO').toUpperCase(),
        `MESA: ${command.mesa_tipo === 'cartao' && command.nfc_uid ? command.nfc_uid : command.numero}  GARÇOM: ${actorName}`, `DESTINO: ${route.nome}`,
        `PEDIDO: ${batchId.slice(0, 8)}`, '-'.repeat(32), '',
      ].join('\n'));
      const footer = ascii(`\n${'='.repeat(32)}\nEmitida: ${timestamp}\n`);
      const width = num(route.largura_mm) || 80;
      // Em rotas vinculadas a um servidor, destino vazio pede a impressora padrão.
      // O nome da rota só identifica a fila nas configurações antigas sem servidor.
      const printer = route.impressora_destino || (route.servidor_tipo ? null : route.nome);
      const serverGuard = deviceId
        ? 'EXISTS (SELECT 1 FROM devices WHERE id=? AND estabelecimento_id=? AND revogado_em IS NULL AND token_expira_em>?)'
        : 'EXISTS (SELECT 1 FROM gestores WHERE token=? AND estabelecimento_id=? AND ativo=1)';
      const serverParams = deviceId ? [deviceId, tenant, timestamp] : [server.token, tenant];
      statements.push(db.prepare(`INSERT INTO pedido_impressoes (estabelecimento_id,item_id,impressora_id,lote_id,conteudo_item,criado_em)
        SELECT ?,i.id,?,?,json_extract(j.value,'$.texto'),? FROM json_each(?) j
        JOIN comanda_itens i ON i.id=json_extract(j.value,'$.id')
        JOIN comandas c ON c.id=i.comanda_id AND c.estabelecimento_id=i.estabelecimento_id
        WHERE i.estabelecimento_id=? AND i.comanda_id=? AND i.status='novo' AND i.versao=json_extract(j.value,'$.versao')
          AND c.status='aberta' AND (c.fechamento_bloqueado_ate IS NULL OR c.fechamento_bloqueado_ate<=?)
          AND EXISTS (SELECT 1 FROM produto_categorias pc JOIN categorias cat ON cat.id=pc.categoria_id AND cat.estabelecimento_id=pc.estabelecimento_id
            LEFT JOIN categorias pai ON pai.id=cat.categoria_pai_id AND pai.estabelecimento_id=cat.estabelecimento_id
            WHERE pc.produto_id=i.produto_id AND pc.estabelecimento_id=i.estabelecimento_id AND COALESCE(cat.impressora_agente_id,pai.impressora_agente_id)=?)
          AND EXISTS (SELECT 1 FROM impressora_agentes r WHERE r.id=? AND r.estabelecimento_id=? AND r.ativo=1 AND r.imprime_pedidos=1
            AND COALESCE(r.servidor_tipo,'')=? AND COALESCE(r.servidor_id,'')=? AND COALESCE(r.impressora_destino,'')=?)
          AND ${serverGuard}
        ON CONFLICT(estabelecimento_id,item_id,impressora_id) DO NOTHING`)
        .bind(tenant, routeId, batchId, timestamp, snapshots, tenant, comandaId, timestamp, routeId,
          routeId, tenant, route.servidor_tipo || '', String(route.servidor_id || ''), route.impressora_destino || '', ...serverParams));
      const content = `(SELECT ? || GROUP_CONCAT(conteudo_item,char(10)) || ? FROM
        (SELECT conteudo_item FROM pedido_impressoes WHERE lote_id=? ORDER BY item_id))`;
      if (deviceId) {
        statements.push(db.prepare(`INSERT INTO device_tasks
          (id,estabelecimento_id,device_id,tipo,payload_json,idempotency_key,status,disponivel_em,origem_tipo,origem_id,criado_por,criado_em,atualizado_em)
          SELECT ?,?,?,'PRINT_ORDER',json_object('content',${content},'printer',?,'width_mm',?,'copies',1,'cut',json('true'),'feed',?),
            ?,'pending',?,'comanda',?,?,?,? WHERE EXISTS (SELECT 1 FROM pedido_impressoes WHERE lote_id=?)`)
          .bind(batchId, tenant, deviceId, header, footer, batchId, printer, width, width === 58 ? 3 : 0,
            `pedido:${batchId}`, timestamp, String(comandaId), actorId || c.user.id, timestamp, timestamp, batchId));
        statements.push(db.prepare(`INSERT INTO device_task_events
          (estabelecimento_id,task_id,device_id,evento,status_novo,ator_tipo,ator_id,criado_em)
          SELECT ?,?,?,'created','pending','user',?,? WHERE EXISTS (SELECT 1 FROM pedido_impressoes WHERE lote_id=?)`)
          .bind(tenant, batchId, deviceId, String(c.user.id), timestamp, batchId));
      } else {
        statements.push(db.prepare(`INSERT INTO gestor_jobs
          (estabelecimento_id,gestor_token,tipo,conteudo,impressora,largura_mm,copias,cortar,alimentar,status,criado_em,pedido_lote_id)
          SELECT ?,?,'PRINT_ORDER',${content},?,?,1,1,?,'pendente',?,?
          WHERE EXISTS (SELECT 1 FROM pedido_impressoes WHERE lote_id=?)`)
          .bind(tenant, server.token, header, footer, batchId, printer, width, width === 58 ? 3 : 0, timestamp, batchId, batchId));
      }
      batches.push({ id: batchId, impressora: route.nome });
    }
  }
  if (statements.length) {
    // Um item com duas rotas só deixa de ser novo quando ambas estão na fila.
    statements.push(db.prepare(`UPDATE comanda_itens SET status='enviado',enviado_em=?
      WHERE estabelecimento_id=? AND comanda_id=? AND status='novo'
      AND EXISTS (SELECT 1 FROM json_each(?) e WHERE json_extract(e.value,'$.item')=comanda_itens.id)
      AND NOT EXISTS (SELECT 1 FROM json_each(?) e WHERE json_extract(e.value,'$.item')=comanda_itens.id
        AND NOT EXISTS (SELECT 1 FROM pedido_impressoes p WHERE p.estabelecimento_id=? AND p.item_id=comanda_itens.id
          AND p.impressora_id=json_extract(e.value,'$.route')))
      AND EXISTS (SELECT 1 FROM comandas c WHERE c.id=? AND c.estabelecimento_id=? AND c.status='aberta'
        AND (c.fechamento_bloqueado_ate IS NULL OR c.fechamento_bloqueado_ate<=?))`)
      .bind(timestamp, tenant, comandaId, JSON.stringify(expected), JSON.stringify(expected), tenant, comandaId, tenant, timestamp));
    await db.batch(statements);
  }
  const created = batches.length ? (await env.DB.prepare(`SELECT p.lote_id,COUNT(*) AS itens,
      (SELECT id FROM gestor_jobs j WHERE j.pedido_lote_id=p.lote_id) AS job_id,
      (SELECT id FROM device_tasks t WHERE t.id=p.lote_id) AS task_id
      FROM pedido_impressoes p WHERE p.lote_id IN (SELECT value FROM json_each(?)) GROUP BY p.lote_id`)
    .bind(JSON.stringify(batches.map((b) => b.id))).all()).results : [];
  const jobs = created.map((row) => ({ ...row, ok: true, impressora: batches.find((b) => b.id === row.lote_id).impressora }));
  return { ok: true, impressao: '', itens: created.reduce((sum, row) => sum + row.itens, 0), jobs,
    sem_rota: missing, falhas: failures, setor: body.setor || 'Cozinha', tipo: 'cozinha' };
}
