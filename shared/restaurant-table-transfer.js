import { estabelecimentoId, now, sha256 } from './util.js';

const ACTIVE = "('novo','enviado','entregue')";
const CONFLICT = 'A mesa ou os pedidos mudaram, estão em fechamento ou possuem pagamento a revisar. Atualize antes de transferir.';

export async function transferirMesaHandler(c, env) {
  const b = await c.req.json();
  const sourceId = Number(c.params.id);
  const mesaId = Number(b?.mesa_destino_id);
  const destinoId = b?.comanda_destino_id == null ? null : Number(b.comanda_destino_id);
  const key = String(b?.chave || '');
  if (!Number.isSafeInteger(sourceId) || sourceId <= 0 || !Number.isSafeInteger(mesaId) || mesaId <= 0 ||
      (destinoId !== null && (!Number.isSafeInteger(destinoId) || destinoId <= 0)) ||
      !/^[a-zA-Z0-9_-]{16,100}$/.test(key) || typeof b?.liberar_origem !== 'boolean' ||
      !Array.isArray(b?.itens) || !b.itens.length || b.itens.length > 2000 ||
      b.itens.some((i) => !Number.isSafeInteger(i?.id) || i.id <= 0 || !Number.isSafeInteger(i?.versao) || i.versao < 0) ||
      new Set(b.itens.map((i) => i.id)).size !== b.itens.length) {
    return c.json({ error: 'Informe a mesa de destino e a lista atual de pedidos (até 2.000 lançamentos)' }, 400);
  }
  const items = b.itens.map(({ id, versao }) => ({ id, versao })).sort((a, z) => a.id - z.id);
  const hash = await sha256(JSON.stringify({ sourceId, mesaId, destinoId, items, liberar: b.liberar_origem, actor: c.user.id }));
  const previous = () => env.DB.prepare('SELECT * FROM comanda_mesa_transferencias WHERE chave=?').bind(key).first();
  const reply = (saved, repetido) => saved.conteudo_hash !== hash
    ? c.json({ error: 'Este identificador já foi usado em outra transferência' }, 409)
    : c.json({ ok: true, transferencia_id: saved.id, comanda_destino_id: saved.comanda_destino_id,
      abriu_comanda: saved.abriu_comanda, liberou_origem: saved.liberou_origem, itens_count: saved.itens_count, repetido });
  const saved = await previous();
  if (saved) return reply(saved, true);
  if (await env.DB.prepare('SELECT id FROM cartao_atendimentos WHERE comanda_id=? AND encerrado_em IS NULL LIMIT 1').bind(sourceId).first()) {
    return c.json({ error: 'Esta mesa possui cartões em atendimento. Encerre essas contas na Recepção antes de transferir a mesa inteira.' }, 409);
  }
  const source = await env.DB.prepare('SELECT id,mesa_id FROM comandas WHERE id=?').bind(sourceId).first();
  if (!source) return c.json({ error: 'Comanda de origem não encontrada' }, 404);
  if (source.mesa_id === mesaId) return c.json({ error: 'Selecione outra mesa' }, 400);
  const table = await env.DB.prepare("SELECT id FROM mesas WHERE id=? AND ativo=1 AND tipo='normal'").bind(mesaId).first();
  if (!table) return c.json({ error: 'Mesa de destino não encontrada ou não é uma mesa do salão' }, 404);

  const db = env.rawDB;
  const tenant = estabelecimentoId(env);
  const id = crypto.randomUUID();
  const timestamp = now();
  const data = JSON.stringify(items);
  // O marcador é criado apenas se a lista inteira ainda corresponde à tela.
  // Todos os passos usam esse UUID, nunca um marcador de outra tentativa.
  const results = await db.batch([
    db.prepare(`INSERT INTO comanda_mesa_transferencias
      (id,estabelecimento_id,chave,conteudo_hash,comanda_origem_id,mesa_destino_id,comanda_destino_id,
       abriu_comanda,liberou_origem,itens_count,pessoa_base_id,pessoas_json,funcionario_id,criado_em)
      SELECT ?,?,?,?,?,?,?,?, ?,?,COALESCE((SELECT MAX(id) FROM comanda_pessoas),0),
        (SELECT json_group_array(json_object('id',p.id,'nome',p.nome,'cor',p.cor)) FROM
          (SELECT p.id,p.nome,p.cor FROM comanda_pessoas p WHERE p.comanda_id=origem.id AND p.estabelecimento_id=origem.estabelecimento_id
            AND EXISTS (SELECT 1 FROM comanda_itens i WHERE i.comanda_id=origem.id AND i.estabelecimento_id=origem.estabelecimento_id
              AND i.pessoa_id=p.id AND i.status IN ${ACTIVE}) ORDER BY p.id) p),?,?
      FROM comandas origem JOIN mesas m ON m.id=? AND m.estabelecimento_id=origem.estabelecimento_id
      JOIN mesas mo ON mo.id=origem.mesa_id AND mo.estabelecimento_id=origem.estabelecimento_id
      WHERE origem.id=? AND origem.estabelecimento_id=? AND origem.status='aberta' AND origem.comanda_origem_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM cartao_atendimentos a WHERE a.comanda_id=origem.id AND a.estabelecimento_id=origem.estabelecimento_id AND a.encerrado_em IS NULL)
        AND mo.ativo=1 AND mo.tipo='normal' AND m.ativo=1 AND m.tipo='normal' AND m.id!=mo.id
        AND NOT EXISTS (SELECT 1 FROM comandas outra WHERE outra.mesa_id=mo.id AND outra.estabelecimento_id=?
          AND outra.id!=origem.id AND outra.status IN ('aberta','pre_fechamento'))
        AND (origem.fechamento_bloqueado_ate IS NULL OR origem.fechamento_bloqueado_ate<=?)
        AND NOT EXISTS (SELECT 1 FROM vendas v WHERE v.comanda_id=origem.id AND v.estabelecimento_id=? AND v.status='concluida')
        AND (SELECT COUNT(*) FROM comanda_itens i WHERE i.comanda_id=origem.id AND i.estabelecimento_id=? AND i.status IN ${ACTIVE})=?
        AND NOT EXISTS (SELECT 1 FROM json_each(?) j WHERE NOT EXISTS (SELECT 1 FROM comanda_itens i
          WHERE i.id=json_extract(j.value,'$.id') AND i.versao=json_extract(j.value,'$.versao')
            AND i.comanda_id=origem.id AND i.estabelecimento_id=? AND i.status IN ${ACTIVE}
            AND (i.pessoa_id IS NULL OR EXISTS (SELECT 1 FROM comanda_pessoas p WHERE p.id=i.pessoa_id
              AND p.comanda_id=origem.id AND p.estabelecimento_id=? AND p.status='pendente'))))
        AND (?=0 OR NOT EXISTS (SELECT 1 FROM comanda_itens i WHERE i.comanda_id=origem.id AND i.estabelecimento_id=?
          AND i.status!='cancelado' AND i.status NOT IN ${ACTIVE}))
        AND ((? IS NULL AND m.status='livre' AND NOT EXISTS (SELECT 1 FROM comandas d WHERE d.mesa_id=m.id
          AND d.estabelecimento_id=? AND d.status IN ('aberta','pre_fechamento')))
          OR (? IS NOT NULL AND EXISTS (SELECT 1 FROM comandas d WHERE d.id=? AND d.mesa_id=m.id AND d.estabelecimento_id=?
            AND d.status='aberta' AND d.comanda_origem_id IS NULL
            AND (d.fechamento_bloqueado_ate IS NULL OR d.fechamento_bloqueado_ate<=?)
            AND NOT EXISTS (SELECT 1 FROM vendas v WHERE v.comanda_id=d.id AND v.estabelecimento_id=? AND v.status='concluida'))
            AND NOT EXISTS (SELECT 1 FROM comandas d WHERE d.mesa_id=m.id AND d.estabelecimento_id=?
              AND d.id!=? AND d.status IN ('aberta','pre_fechamento'))))
      ON CONFLICT(estabelecimento_id,chave) DO NOTHING`)
      .bind(id, tenant, key, hash, sourceId, mesaId, destinoId, destinoId === null ? 1 : 0,
        b.liberar_origem ? 1 : 0, items.length, c.user.id, timestamp,
        mesaId, sourceId, tenant, tenant, timestamp, tenant, tenant, items.length, data, tenant, tenant,
        b.liberar_origem ? 1 : 0, tenant, destinoId, tenant, destinoId, destinoId, tenant, timestamp, tenant, tenant, destinoId),
    db.prepare(`INSERT INTO comandas (estabelecimento_id,mesa_id,cliente_nome,garcom_nome,status,taxa_garcom_pct,pessoas_count,criado_em)
      SELECT t.estabelecimento_id,t.mesa_destino_id,o.cliente_nome,o.garcom_nome,'aberta',o.taxa_garcom_pct,0,?
      FROM comanda_mesa_transferencias t JOIN comandas o ON o.id=t.comanda_origem_id AND o.estabelecimento_id=t.estabelecimento_id
      WHERE t.id=? AND t.abriu_comanda=1`).bind(timestamp, id),
    db.prepare(`UPDATE comanda_mesa_transferencias SET comanda_destino_id=(SELECT c.id FROM comandas c
      WHERE c.estabelecimento_id=? AND c.mesa_id=? AND c.status='aberta') WHERE id=? AND abriu_comanda=1`)
      .bind(tenant, mesaId, id),
    db.prepare(`INSERT INTO comanda_pessoas (estabelecimento_id,comanda_id,nome,cor,criado_em)
      SELECT t.estabelecimento_id,t.comanda_destino_id,json_extract(j.value,'$.nome'),json_extract(j.value,'$.cor'),?
      FROM comanda_mesa_transferencias t,json_each(t.pessoas_json) j WHERE t.id=? ORDER BY CAST(j.key AS INTEGER)`)
      .bind(timestamp, id),
    db.prepare(`INSERT INTO comanda_item_transferencias
      (id,estabelecimento_id,item_id,comanda_origem_id,pessoa_origem_id,mesa_destino_id,comanda_destino_id,
        pessoa_destino_id,abriu_comanda,quantidade,preco_unitario,status_item,funcionario_id,criado_em)
      WITH mapped AS (SELECT p.id,ROW_NUMBER() OVER (ORDER BY p.id)-1 AS position
        FROM comanda_pessoas p JOIN comanda_mesa_transferencias t ON t.id=?
        WHERE p.comanda_id=t.comanda_destino_id AND p.estabelecimento_id=t.estabelecimento_id AND p.id>t.pessoa_base_id)
      SELECT t.id||':'||i.id,t.estabelecimento_id,i.id,i.comanda_id,i.pessoa_id,t.mesa_destino_id,t.comanda_destino_id,
        mapped.id,t.abriu_comanda,i.quantidade,i.preco_unitario,i.status,t.funcionario_id,t.criado_em
      FROM comanda_mesa_transferencias t JOIN comanda_itens i ON i.comanda_id=t.comanda_origem_id AND i.estabelecimento_id=t.estabelecimento_id
      LEFT JOIN json_each(t.pessoas_json) j ON json_extract(j.value,'$.id')=i.pessoa_id
      LEFT JOIN mapped ON mapped.position=CAST(j.key AS INTEGER) WHERE t.id=? AND i.status IN ${ACTIVE}`)
      .bind(id, id),
    db.prepare(`UPDATE comanda_itens SET comanda_id=(SELECT comanda_destino_id FROM comanda_mesa_transferencias WHERE id=?),
      pessoa_id=(SELECT a.pessoa_destino_id FROM comanda_item_transferencias a WHERE a.id=?||':'||comanda_itens.id),versao=versao+1
      WHERE estabelecimento_id=? AND comanda_id=? AND status IN ${ACTIVE}
        AND EXISTS (SELECT 1 FROM comanda_mesa_transferencias WHERE id=?)`)
      .bind(id, id, tenant, sourceId, id),
    db.prepare(`INSERT INTO comanda_pessoas (estabelecimento_id,comanda_id,nome,cor,criado_em)
      SELECT estabelecimento_id,comanda_destino_id,'Pessoa 1','#6366f1',? FROM comanda_mesa_transferencias
      WHERE id=? AND abriu_comanda=1 AND json_array_length(pessoas_json)=0`).bind(timestamp, id),
    db.prepare(`UPDATE comandas SET pessoas_count=(SELECT COUNT(*) FROM comanda_pessoas p
      WHERE p.comanda_id=comandas.id AND p.estabelecimento_id=comandas.estabelecimento_id)
      WHERE estabelecimento_id=? AND id=(SELECT comanda_destino_id FROM comanda_mesa_transferencias WHERE id=?)`).bind(tenant, id),
    db.prepare(`UPDATE mesas SET status='ocupada',aberta_em=? WHERE estabelecimento_id=? AND id=?
      AND EXISTS (SELECT 1 FROM comanda_mesa_transferencias WHERE id=? AND abriu_comanda=1)`).bind(timestamp, tenant, mesaId, id),
    db.prepare(`UPDATE comandas SET status='fechada',fechada_em=?,baixada_em=? WHERE estabelecimento_id=? AND id=?
      AND EXISTS (SELECT 1 FROM comanda_mesa_transferencias WHERE id=? AND liberou_origem=1)`).bind(timestamp, timestamp, tenant, sourceId, id),
    db.prepare(`UPDATE mesas SET status='livre',aberta_em=NULL WHERE estabelecimento_id=? AND id=?
      AND EXISTS (SELECT 1 FROM comanda_mesa_transferencias WHERE id=? AND liberou_origem=1)
      AND NOT EXISTS (SELECT 1 FROM comandas c WHERE c.mesa_id=mesas.id AND c.estabelecimento_id=mesas.estabelecimento_id
        AND c.status IN ('aberta','pre_fechamento'))`).bind(tenant, source.mesa_id, id),
  ]);
  const transfer = await previous();
  if (!results[0].meta.changes && !transfer) return c.json({ error: CONFLICT }, 409);
  return reply(transfer, !results[0].meta.changes);
}
