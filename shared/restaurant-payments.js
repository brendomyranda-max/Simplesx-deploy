import { estabelecimentoId, httpError, now, num } from './util.js';

export async function transferirParaPagamentos(env, com, taxaPct, b) {
  const itens = (await env.DB.prepare("SELECT * FROM comanda_itens WHERE comanda_id=? AND status!='cancelado' ORDER BY id").bind(com.id).all()).results;
  const pessoas = (await env.DB.prepare('SELECT * FROM comanda_pessoas WHERE comanda_id=? ORDER BY id').bind(com.id).all()).results;
  if (!itens.length) return null;
  const mesa = await env.DB.prepare("SELECT * FROM mesas WHERE tipo='pagamentos' ORDER BY id LIMIT 1").first();
  if (!mesa) return null;
  const valores = Array.isArray(b.pessoas_valores) && b.pessoas_valores.length ? b.pessoas_valores : null;
  const grupos = new Map();
  for (const item of itens) {
    const id = item.pessoa_id || 0;
    grupos.set(id, (grupos.get(id) || 0) + num(item.quantidade) * num(item.preco_unitario));
  }
  const incluir = new Set(grupos.keys());
  for (const valor of valores || []) incluir.add(Number(valor.pessoa_id) || 0);
  const selecionadas = pessoas.filter((p) => incluir.has(p.id)).map((p) => ({ origem: p.id, nome: p.nome, cor: p.cor || '#6366f1' }));
  if (incluir.has(0)) selecionadas.push({ origem: 0, nome: 'Itens Gerais', cor: '#94a3b8' });
  let total = 0;
  for (const p of selecionadas) {
    const personalizado = valores?.find((v) => (Number(v.pessoa_id) || 0) === p.origem);
    const valor = valores ? num(personalizado?.valor) : Number(((grupos.get(p.origem) || 0) * (1 + taxaPct / 100)).toFixed(2));
    if (valor > 0 && Number.isFinite(valor)) {
      p.valor = valor;
      p.forma = personalizado?.forma || b.forma || 'dinheiro';
      total += valor;
    }
  }
  const timestamp = now(), tenant = estabelecimentoId(env), data = JSON.stringify(selecionadas);
  // A nova comanda, as pessoas, todos os itens e o bloqueio da origem são
  // gravados juntos. O número de instruções não cresce com o tamanho do pedido.
  const novaId = '(SELECT MAX(id) FROM comandas)';
  const pessoasNumeradas = `(SELECT id,ROW_NUMBER() OVER (ORDER BY id)-1 AS indice
    FROM comanda_pessoas WHERE comanda_id=${novaId})`;
  const statements = [...(env.fechamentoValidacoes || [])];
  if (env.fechamentoReserva) statements.push(env.DB.prepare(`SELECT CASE WHEN EXISTS
    (SELECT 1 FROM comandas WHERE id=? AND status='aberta' AND fechamento_bloqueado_ate=?)
    THEN 1 ELSE abs(-9223372036854775808) END`).bind(com.id, env.fechamentoReserva));
  const insertIndex = statements.length;
  statements.push(env.DB.prepare(`INSERT INTO comandas
    (mesa_id,cliente_nome,garcom_nome,status,taxa_garcom_pct,fechamento_tipo,pessoas_count,comanda_origem_id,pre_fechamento_em,criado_em)
    VALUES (?,?,?,'pre_fechamento',?,'individual',?,?,?,?)`)
    .bind(mesa.id, com.cliente_nome, com.garcom_nome, taxaPct, selecionadas.length, com.id, timestamp, timestamp));
  statements.push(env.DB.prepare(`INSERT INTO comanda_pessoas (estabelecimento_id,comanda_id,nome,cor,criado_em)
    SELECT ?,${novaId},json_extract(value,'$.nome'),json_extract(value,'$.cor'),? FROM json_each(?) ORDER BY CAST(key AS INTEGER)`)
    .bind(tenant, timestamp, data));
  statements.push(env.DB.prepare(`INSERT INTO comanda_itens
    (estabelecimento_id,comanda_id,pessoa_id,produto_id,nome,quantidade,preco_unitario,observacao,acrescimos_json,combo_escolhas_json,status,responsavel,criado_em,funcionario_id,enviado_em)
    SELECT ?,${novaId},p.id,i.produto_id,i.nome,i.quantidade,i.preco_unitario,i.observacao,i.acrescimos_json,i.combo_escolhas_json,i.status,i.responsavel,?,i.funcionario_id,i.enviado_em
    FROM comanda_itens i JOIN json_each(?) j ON json_extract(j.value,'$.origem')=COALESCE(i.pessoa_id,0)
    JOIN ${pessoasNumeradas} p ON p.indice=CAST(j.key AS INTEGER)
    WHERE i.comanda_id=? AND i.status!='cancelado'`).bind(tenant, timestamp, data, com.id));
  statements.push(env.DB.prepare(`UPDATE comandas SET individual_valores=(SELECT json_object(
    'valores',json_group_object(p.id,json_extract(j.value,'$.valor')),
    'formas',json_group_object(p.id,json_extract(j.value,'$.forma')))
    FROM ${pessoasNumeradas} p JOIN json_each(?) j ON p.indice=CAST(j.key AS INTEGER)
    WHERE json_type(j.value,'$.valor') IS NOT NULL) WHERE id=${novaId}`).bind(data));
  statements.push(env.DB.prepare(`UPDATE comandas SET status='pre_fechamento',fechamento_tipo='individual',taxa_garcom_pct=?,pre_fechamento_em=? WHERE id=?`)
    .bind(taxaPct, timestamp, com.id));
  let result;
  try { result = await env.DB.batch(statements); }
  catch (error) {
    if (/integer overflow/i.test(error.message)) throw httpError(409, 'A reserva do fechamento mudou. Atualize a comanda antes de tentar novamente.');
    throw error;
  }
  return { id: result[insertIndex].meta.last_row_id, pessoas: selecionadas.length, total: Number(total.toFixed(2)) };
}
