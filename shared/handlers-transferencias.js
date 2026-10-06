import { estabelecimentoId, now } from './util.js';

const ACTIVE = "('novo','enviado','entregue')";
const conflict = 'O pedido ou a mesa mudou em outra tela. Atualize e tente novamente.';

export async function transferirItemHandler(c, env) {
  const b = await c.req.json();
  const mesaId = Number(b?.mesa_destino_id);
  const destinoId = b?.comanda_destino_id == null ? null : Number(b.comanda_destino_id);
  const pessoaId = b?.pessoa_destino_id == null ? null : Number(b.pessoa_destino_id);
  const versao = b?.versao;
  if (!Number.isInteger(mesaId) || mesaId <= 0 ||
      (destinoId !== null && (!Number.isInteger(destinoId) || destinoId <= 0)) ||
      (pessoaId !== null && (!Number.isInteger(pessoaId) || pessoaId <= 0)) ||
      !Number.isInteger(versao) || versao < 0) {
    return c.json({ error: 'Informe a mesa, a pessoa de destino e a versão atual do pedido' }, 400);
  }
  const item = await env.DB.prepare(`SELECT i.*, c.status AS comanda_status, c.garcom_nome
    FROM comanda_itens i JOIN comandas c ON c.id=i.comanda_id
    WHERE i.id=? AND i.comanda_id=?`).bind(c.params.item_id, c.params.id).first();
  if (!item) return c.json({ error: 'Pedido não encontrado nesta comanda' }, 404);
  if (item.comanda_status !== 'aberta' || !['novo', 'enviado', 'entregue'].includes(item.status)) {
    return c.json({ error: 'Somente pedidos ativos de uma comanda aberta podem ser transferidos' }, 409);
  }
  if (item.versao !== versao) return c.json({ error: conflict }, 409);
  const mesa = await env.DB.prepare("SELECT id FROM mesas WHERE id=? AND ativo=1 AND tipo!='pagamentos'").bind(mesaId).first();
  if (!mesa) return c.json({ error: 'Mesa de destino não encontrada' }, 404);
  const destinos = await env.DB.prepare("SELECT id, status FROM comandas WHERE mesa_id=? AND status IN ('aberta','pre_fechamento')")
    .bind(mesaId).all();
  const destino = destinos.results[0];
  if (destinos.results.length > 1 || (destino && (destino.status !== 'aberta' || destino.id !== destinoId)) || (!destino && destinoId !== null)) {
    return c.json({ error: 'A mesa de destino está em pagamento ou sua comanda mudou. Atualize e tente novamente.' }, 409);
  }
  if (pessoaId !== null) {
    const pessoa = await env.DB.prepare("SELECT id FROM comanda_pessoas WHERE id=? AND comanda_id=? AND status='pendente'")
      .bind(pessoaId, destinoId).first();
    if (!pessoa) return c.json({ error: 'Pessoa de destino não encontrada ou já paga' }, 400);
  }
  if (destinoId === item.comanda_id && pessoaId === item.pessoa_id) {
    return c.json({ error: 'Selecione outra pessoa ou outra mesa' }, 400);
  }

  const db = env.rawDB;
  const tenant = estabelecimentoId(env);
  const transferId = crypto.randomUUID();
  const timestamp = now();
  // O primeiro INSERT valida o estado dentro da mesma transação que move o
  // item e, se necessário, abre a mesa. Nenhuma etapa posterior roda se perder
  // a disputa pela versão do item. A auditoria também é o marcador do batch.
  const results = await db.batch([
    db.prepare(`INSERT INTO comanda_item_transferencias
        (id,estabelecimento_id,item_id,comanda_origem_id,pessoa_origem_id,mesa_destino_id,
         comanda_destino_id,pessoa_destino_id,abriu_comanda,quantidade,preco_unitario,status_item,funcionario_id,criado_em)
      SELECT ?,i.estabelecimento_id,i.id,i.comanda_id,i.pessoa_id,m.id,?,?,?,i.quantidade,i.preco_unitario,i.status,?,?
      FROM comanda_itens i JOIN comandas origem ON origem.id=i.comanda_id AND origem.estabelecimento_id=i.estabelecimento_id
      JOIN mesas m ON m.id=? AND m.estabelecimento_id=i.estabelecimento_id
      WHERE i.id=? AND i.comanda_id=? AND i.estabelecimento_id=? AND i.versao=?
        AND i.status IN ${ACTIVE} AND origem.status='aberta' AND origem.comanda_origem_id IS NULL
        AND (origem.fechamento_bloqueado_ate IS NULL OR origem.fechamento_bloqueado_ate<=?)
        AND (i.pessoa_id IS NULL OR EXISTS (SELECT 1 FROM comanda_pessoas p WHERE p.id=i.pessoa_id
          AND p.comanda_id=origem.id AND p.estabelecimento_id=? AND p.status='pendente'))
        AND m.ativo=1 AND m.tipo!='pagamentos'
        AND ((? IS NULL AND m.status='livre' AND NOT EXISTS (SELECT 1 FROM comandas c
          WHERE c.mesa_id=m.id AND c.estabelecimento_id=? AND c.status IN ('aberta','pre_fechamento')))
          OR (? IS NOT NULL AND EXISTS (SELECT 1 FROM comandas c WHERE c.id=? AND c.mesa_id=m.id
            AND c.estabelecimento_id=? AND c.status='aberta' AND c.comanda_origem_id IS NULL)
            AND EXISTS (SELECT 1 FROM comandas c WHERE c.id=? AND c.estabelecimento_id=?
              AND (c.fechamento_bloqueado_ate IS NULL OR c.fechamento_bloqueado_ate<=?))
            AND NOT EXISTS (SELECT 1 FROM comandas c WHERE c.mesa_id=m.id AND c.estabelecimento_id=?
              AND c.id!=? AND c.status IN ('aberta','pre_fechamento'))))
        AND (? IS NULL OR EXISTS (SELECT 1 FROM comanda_pessoas p WHERE p.id=? AND p.comanda_id=?
          AND p.estabelecimento_id=? AND p.status='pendente'))`)
      .bind(transferId, destinoId, pessoaId, destinoId === null ? 1 : 0, c.user.id, timestamp,
        mesaId, item.id, item.comanda_id, tenant, versao, timestamp, tenant,
        destinoId, tenant, destinoId, destinoId, tenant, destinoId, tenant, timestamp, tenant, destinoId, pessoaId, pessoaId, destinoId, tenant),
    db.prepare(`INSERT INTO comandas (estabelecimento_id,mesa_id,garcom_nome,status,taxa_garcom_pct,pessoas_count,criado_em)
      SELECT ?,? ,?,'aberta',COALESCE((SELECT valor FROM empresa_config WHERE estabelecimento_id=? AND chave='taxa_garcom_pct'),'0'),1,?
      WHERE EXISTS (SELECT 1 FROM comanda_item_transferencias WHERE id=? AND abriu_comanda=1)`)
      .bind(tenant, mesaId, item.garcom_nome, tenant, timestamp, transferId),
    db.prepare(`UPDATE comanda_item_transferencias SET comanda_destino_id=(SELECT id FROM comandas
      WHERE estabelecimento_id=? AND mesa_id=? AND status='aberta') WHERE id=? AND abriu_comanda=1`)
      .bind(tenant, mesaId, transferId),
    db.prepare(`INSERT INTO comanda_pessoas (estabelecimento_id,comanda_id,nome,cor,criado_em)
      SELECT estabelecimento_id,comanda_destino_id,'Pessoa 1','#6366f1',?
      FROM comanda_item_transferencias WHERE id=? AND abriu_comanda=1`).bind(timestamp, transferId),
    db.prepare(`UPDATE mesas SET status='ocupada',aberta_em=? WHERE id=? AND estabelecimento_id=?
      AND EXISTS (SELECT 1 FROM comanda_item_transferencias WHERE id=? AND abriu_comanda=1)`)
      .bind(timestamp, mesaId, tenant, transferId),
    db.prepare(`UPDATE comanda_itens SET
      comanda_id=(SELECT comanda_destino_id FROM comanda_item_transferencias WHERE id=?),
      pessoa_id=?,versao=versao+1 WHERE id=? AND estabelecimento_id=?
      AND EXISTS (SELECT 1 FROM comanda_item_transferencias WHERE id=?)`)
      .bind(transferId, pessoaId, item.id, tenant, transferId),
  ]);
  if (!results[0].meta.changes) return c.json({ error: conflict }, 409);
  const transfer = await env.DB.prepare('SELECT comanda_destino_id,abriu_comanda FROM comanda_item_transferencias WHERE id=?')
    .bind(transferId).first();
  return c.json({ ok: true, transferencia_id: transferId, ...transfer });
}
