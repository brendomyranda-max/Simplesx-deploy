import { estabelecimentoId, getConfigValue, now, num, sha256 } from './util.js';

export async function cancelarComandaHandler(c, env) {
  const b = await c.req.json();
  const comandaId = Number(c.params.id);
  const motivo = typeof b.motivo === 'string' ? b.motivo.trim() : '';
  if (!Number.isSafeInteger(comandaId) || comandaId <= 0 || b.confirmar !== true ||
      !/^[a-zA-Z0-9_-]{16,100}$/.test(b.chave || '') || motivo.length < 3 || motivo.length > 300 ||
      !Array.isArray(b.itens) || b.itens.length > 2000 ||
      b.itens.some((i) => !Number.isSafeInteger(i?.id) || i.id <= 0 || !Number.isSafeInteger(i?.versao) || i.versao < 0) ||
      new Set(b.itens.map((i) => i.id)).size !== b.itens.length) {
    return c.json({ error: 'Confirme o cancelamento, informe o motivo e a lista atual de pedidos.' }, 400);
  }
  const itens = b.itens.map(({ id, versao }) => ({ id, versao })).sort((a, z) => a.id - z.id);
  const hash = await sha256(JSON.stringify({ comandaId, motivo, itens, actor: c.user.id }));
  const previous = () => env.DB.prepare('SELECT * FROM comanda_cancelamentos WHERE chave=?').bind(b.chave).first();
  const reply = (saved, repetido) => saved.conteudo_hash !== hash
    ? c.json({ error: 'Este identificador já foi usado para outro cancelamento.' }, 409)
    : c.json({ ok: true, comanda_id: saved.comanda_id, mesa_liberada: true, repetido,
      itens_cancelados: JSON.parse(saved.itens_json).filter((i) => ['novo','enviado','entregue'].includes(i.status)).length,
      vendas_anteriores: JSON.parse(saved.vendas_json).map((v) => v.id) });
  const saved = await previous();
  if (saved) return reply(saved, true);
  const com = await env.DB.prepare('SELECT id,mesa_id FROM comandas WHERE id=?').bind(comandaId).first();
  if (!com) return c.json({ error: 'Comanda não encontrada' }, 404);
  const timeout = Math.max(0, num(await getConfigValue(env, 'perda_timeout_min', '2')));
  const db = env.rawDB, tenant = estabelecimentoId(env), id = crypto.randomUUID(), timestamp = now();
  const data = JSON.stringify(itens);
  // O marcador só nasce se a confirmação ainda corresponde à comanda inteira.
  // Todos os passos são condicionados ao UUID desta execução, no mesmo lote.
  const results = await db.batch([
    db.prepare(`INSERT INTO comanda_cancelamentos
      (id,estabelecimento_id,chave,conteudo_hash,comanda_id,mesa_id,itens_json,vendas_json,motivo,funcionario_id,criado_em)
      SELECT ?,?,?,?,?,c.mesa_id,
        (SELECT json_group_array(json_object('id',i.id,'versao',i.versao,'nome',i.nome,'produto_id',i.produto_id,
          'quantidade',i.quantidade,'preco_unitario',i.preco_unitario,'status',i.status,'pessoa_id',i.pessoa_id,
          'observacao',i.observacao,'criado_em',i.criado_em)) FROM comanda_itens i
          WHERE i.comanda_id=c.id AND i.estabelecimento_id=? AND i.status!='cancelado'),
        (SELECT json_group_array(json_object('id',v.id,'numero',v.numero,'status',v.status,'total',v.total))
          FROM vendas v WHERE v.comanda_id=c.id AND v.estabelecimento_id=?),?,?,?
      FROM comandas c JOIN mesas m ON m.id=c.mesa_id AND m.estabelecimento_id=c.estabelecimento_id
      WHERE c.id=? AND c.mesa_id=? AND c.estabelecimento_id=? AND c.status IN ('aberta','pre_fechamento')
        AND c.comanda_origem_id IS NULL AND m.ativo=1 AND m.tipo IN ('normal','cartao')
        AND (c.fechamento_bloqueado_ate IS NULL OR c.fechamento_bloqueado_ate<=?)
        AND NOT EXISTS (SELECT 1 FROM comandas filha WHERE filha.comanda_origem_id=c.id
          AND filha.estabelecimento_id=? AND filha.status IN ('aberta','pre_fechamento'))
        AND NOT EXISTS (SELECT 1 FROM comanda_pessoas p WHERE p.comanda_id=c.id AND p.estabelecimento_id=? AND p.status='baixado')
        AND NOT EXISTS (SELECT 1 FROM comandas outra WHERE outra.mesa_id=c.mesa_id AND outra.estabelecimento_id=?
          AND outra.id!=c.id AND outra.status IN ('aberta','pre_fechamento'))
        AND (SELECT COUNT(*) FROM comanda_itens i WHERE i.comanda_id=c.id AND i.estabelecimento_id=? AND i.status!='cancelado')=?
        AND NOT EXISTS (SELECT 1 FROM json_each(?) j WHERE NOT EXISTS (SELECT 1 FROM comanda_itens i
          WHERE i.id=json_extract(j.value,'$.id') AND i.versao=json_extract(j.value,'$.versao')
          AND i.comanda_id=c.id AND i.estabelecimento_id=? AND i.status!='cancelado'))
      ON CONFLICT(estabelecimento_id,chave) DO NOTHING`)
      .bind(id, tenant, b.chave, hash, comandaId, tenant, tenant, motivo, c.user.id, timestamp,
        comandaId, com.mesa_id, tenant, timestamp, tenant, tenant, tenant, tenant, itens.length, data, tenant),
    // Mesma regra do cancelamento unitário: após a tolerância, registra perda
    // sem movimentar estoque/financeiro. Itens possivelmente já vendidos não
    // recebem outra perda. Perdas anteriores nunca são apagadas ou duplicadas.
    db.prepare(`INSERT INTO perdas
      (estabelecimento_id,produto_id,quantidade,valor_unitario,motivo,origem,comanda_id,item_id,responsavel,criado_em)
      SELECT ?,i.produto_id,i.quantidade,i.preco_unitario,?,'cancelamento',i.comanda_id,i.id,?,?
      FROM comanda_itens i WHERE i.comanda_id=? AND i.estabelecimento_id=? AND i.status IN ('novo','enviado','entregue')
        AND (julianday(?)-julianday(i.criado_em))*1440>=?
        AND NOT EXISTS (SELECT 1 FROM perdas p WHERE p.item_id=i.id AND p.estabelecimento_id=?)
        AND NOT EXISTS (SELECT 1 FROM vendas v WHERE v.comanda_id=i.comanda_id AND v.estabelecimento_id=? AND v.status='concluida'
          AND (julianday(v.criado_em) IS NULL OR julianday(i.criado_em)<=julianday(v.criado_em)))
        AND EXISTS (SELECT 1 FROM comanda_cancelamentos WHERE id=?)`)
      .bind(tenant, `Cancelamento de comanda: ${motivo}`, c.user.nome || `Funcionário ${c.user.id}`, timestamp,
        comandaId, tenant, timestamp, timeout, tenant, tenant, id),
    db.prepare(`UPDATE comanda_itens SET status='cancelado' WHERE comanda_id=? AND estabelecimento_id=?
      AND status IN ('novo','enviado','entregue') AND EXISTS (SELECT 1 FROM comanda_cancelamentos WHERE id=?)`)
      .bind(comandaId, tenant, id),
    db.prepare(`UPDATE comandas SET status='fechada',fechamento_tipo='cancelada',fechada_em=?,baixada_em=NULL,fechamento_bloqueado_ate=NULL
      WHERE id=? AND estabelecimento_id=? AND EXISTS (SELECT 1 FROM comanda_cancelamentos WHERE id=?)`)
      .bind(timestamp, comandaId, tenant, id),
    db.prepare(`UPDATE mesas SET status='livre',aberta_em=NULL WHERE id=? AND estabelecimento_id=?
      AND EXISTS (SELECT 1 FROM comanda_cancelamentos WHERE id=?)`)
      .bind(com.mesa_id, tenant, id),
  ]);
  const result = await previous();
  if (!result) return c.json({ error: 'A comanda mudou, está em fechamento ou possui pagamentos individuais pendentes. Atualize antes de cancelar.' }, 409);
  return reply(result, !results[0].meta.changes);
}
