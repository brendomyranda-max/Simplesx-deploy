// Um fechamento antigo incompleto não pode impedir o pagamento de consumo
// realmente novo, mas tampouco autoriza cobrar novamente os itens anteriores.
function instante(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  return Date.parse(value);
}

export function somentePedidosPosteriores(itens, vendas) {
  if (!itens.length || !vendas.length) return false;
  const datas = vendas.map((venda) => instante(venda.criado_em));
  if (datas.some((data) => !Number.isFinite(data))) return false;
  const ultimaVenda = Math.max(...datas);
  return itens.every((item) => instante(item.criado_em) > ultimaVenda);
}

export function validarHistoricoFechamento(env, comandaId, itens, vendas) {
  const snapshotItens = JSON.stringify(itens.map((item) => ({ id: item.id, versao: item.versao, criado_em: item.criado_em })));
  const snapshotVendas = JSON.stringify(vendas.map((venda) => ({ id: venda.id, criado_em: venda.criado_em })));
  // Revalida os dois conjuntos DENTRO do lote de fechamento. Uma venda criada
  // ou um item reativado/alterado depois da leitura aborta todas as gravações.
  return env.DB.prepare(`SELECT CASE WHEN
    (SELECT COUNT(*) FROM comanda_itens WHERE comanda_id=? AND status!='cancelado')=json_array_length(?)
    AND NOT EXISTS (SELECT 1 FROM comanda_itens i WHERE i.comanda_id=? AND i.status!='cancelado'
      AND NOT EXISTS (SELECT 1 FROM json_each(?) j WHERE i.id=json_extract(j.value,'$.id')
        AND i.versao=json_extract(j.value,'$.versao') AND i.criado_em=json_extract(j.value,'$.criado_em')))
    AND (SELECT COUNT(*) FROM vendas WHERE comanda_id=? AND status='concluida')=json_array_length(?)
    AND NOT EXISTS (SELECT 1 FROM vendas v WHERE v.comanda_id=? AND v.status='concluida'
      AND NOT EXISTS (SELECT 1 FROM json_each(?) j WHERE v.id=json_extract(j.value,'$.id')
        AND v.criado_em=json_extract(j.value,'$.criado_em')))
    THEN 1 ELSE abs(-9223372036854775808) END`)
    .bind(comandaId, snapshotItens, comandaId, snapshotItens, comandaId, snapshotVendas, comandaId, snapshotVendas);
}
