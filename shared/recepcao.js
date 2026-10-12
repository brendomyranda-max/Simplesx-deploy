import { idDoCartao } from './cartao-id.js';
import { estabelecimentoId, getConfigValue, gerarNumeroVenda, httpError, now, num, sha256 } from './util.js';
import { criarVendaRestaurante } from './restaurant-sale.js';
import { somentePedidosPosteriores } from './restaurant-close-history.js';

export async function atendimentoDoCartao(env, cartao) {
  return env.DB.prepare(`SELECT a.*,m.numero AS mesa_numero,p.nome AS cliente_atual,c.status AS comanda_status,
    COALESCE((SELECT SUM(i.quantidade*i.preco_unitario) FROM comanda_itens i
      WHERE i.comanda_id=a.comanda_id AND i.pessoa_id=a.pessoa_id AND i.status!='cancelado'),0) AS subtotal,
    c.taxa_garcom_pct
    FROM cartao_atendimentos a JOIN mesas m ON m.id=a.mesa_id
    JOIN comanda_pessoas p ON p.id=a.pessoa_id JOIN comandas c ON c.id=a.comanda_id
    WHERE a.cartao=? AND a.encerrado_em IS NULL`).bind(cartao).first();
}

export async function listarCartoesHandler(c, env) {
  const rows = await env.DB.prepare(`SELECT a.*,m.numero AS mesa_numero,p.nome AS cliente_atual,c.status AS comanda_status,
    COALESCE((SELECT SUM(i.quantidade*i.preco_unitario) FROM comanda_itens i
      WHERE i.comanda_id=a.comanda_id AND i.pessoa_id=a.pessoa_id AND i.status!='cancelado'),0) AS subtotal,
    c.taxa_garcom_pct FROM cartao_atendimentos a JOIN mesas m ON m.id=a.mesa_id
    JOIN comanda_pessoas p ON p.id=a.pessoa_id JOIN comandas c ON c.id=a.comanda_id
    WHERE a.encerrado_em IS NULL ORDER BY m.numero,a.criado_em`).all();
  return c.json(rows.results);
}

export async function consultarCartaoHandler(c, env) {
  const cartao = idDoCartao(await c.req.json());
  return c.json({ cartao, atendimento: await atendimentoDoCartao(env, cartao) || null });
}

export async function cadastrarCartaoHandler(c, env) {
  const b = await c.req.json();
  const cartao = idDoCartao(b);
  const nome = typeof b.cliente_nome === 'string' ? b.cliente_nome.trim() : '';
  const mesaId = Number(b.mesa_id);
  const chave = String(b.chave || '');
  if (!nome || nome.length > 100 || !Number.isSafeInteger(mesaId) || mesaId < 1 || !/^[a-zA-Z0-9_-]{16,100}$/.test(chave)) {
    return c.json({ error: 'Informe o nome do cliente (até 100 caracteres), a mesa e uma identificação válida do cadastro' }, 400);
  }
  const hash = await sha256(JSON.stringify({ cartao, nome, mesaId }));
  const previous = () => env.DB.prepare('SELECT * FROM cartao_atendimentos WHERE chave=?').bind(chave).first();
  const replay = (a) => a.conteudo_hash === hash ? c.json(a) : c.json({ error: 'Este cadastro já foi usado com outros dados' }, 409);
  const anterior = await previous();
  if (anterior) return replay(anterior);
  if (await atendimentoDoCartao(env, cartao)) return c.json({ error: 'Este cartão já está em atendimento. Feche a conta antes de cadastrar outro cliente.' }, 409);
  const legado = await env.DB.prepare(`SELECT c.id FROM mesas m JOIN comandas c ON c.mesa_id=m.id
    WHERE m.nfc_uid IN (?,?) AND c.status IN ('aberta','pre_fechamento')`).bind(cartao, String(b.payload || '').replace(/\s+/g, '').toUpperCase()).first();
  if (legado) return c.json({ error: 'Este cartão tem uma conta antiga. Feche essa conta pela tela Mesas antes de cadastrar o cliente.' }, 409);
  const mesa = await env.DB.prepare("SELECT id FROM mesas WHERE id=? AND ativo=1 AND tipo='normal'").bind(mesaId).first();
  if (!mesa) return c.json({ error: 'Selecione uma mesa ativa do salão' }, 400);
  const tenant = estabelecimentoId(env), db = env.rawDB, timestamp = now(), id = crypto.randomUUID();
  const taxa = num(await getConfigValue(env, 'taxa_garcom_pct', '0'));
  const comandaId = `(SELECT id FROM comandas WHERE mesa_id=${mesaId} AND estabelecimento_id=${tenant} AND status='aberta' AND comanda_origem_id IS NULL ORDER BY id DESC LIMIT 1)`;
  try {
    await db.batch([
      db.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM mesas WHERE id=? AND estabelecimento_id=? AND ativo=1 AND tipo='normal')
        AND NOT EXISTS (SELECT 1 FROM comandas WHERE mesa_id=? AND estabelecimento_id=? AND status IN ('aberta','pre_fechamento')
          AND (status!='aberta' OR comanda_origem_id IS NOT NULL OR fechamento_bloqueado_ate>?))
        AND (SELECT COUNT(*) FROM comandas WHERE mesa_id=? AND estabelecimento_id=? AND status IN ('aberta','pre_fechamento'))<=1
        THEN 1 ELSE abs(-9223372036854775808) END`).bind(mesaId, tenant, mesaId, tenant, timestamp, mesaId, tenant),
      db.prepare(`INSERT INTO comandas (estabelecimento_id,mesa_id,garcom_nome,status,taxa_garcom_pct,pessoas_count,criado_em)
        SELECT ?,?,?,'aberta',?,0,? WHERE NOT EXISTS (SELECT 1 FROM comandas WHERE mesa_id=? AND estabelecimento_id=? AND status IN ('aberta','pre_fechamento'))`)
        .bind(tenant, mesaId, String(b.garcom_nome || '').trim().slice(0,80) || null, taxa, timestamp, mesaId, tenant),
      db.prepare(`INSERT INTO comanda_pessoas (estabelecimento_id,comanda_id,nome,cor,criado_em) VALUES (?,${comandaId},?,'#6366f1',?)`).bind(tenant, nome, timestamp),
      db.prepare(`INSERT INTO cartao_atendimentos (id,estabelecimento_id,chave,conteudo_hash,cartao,mesa_id,comanda_id,pessoa_id,cliente_nome,criado_em)
        VALUES (?,?,?,?,?,?,${comandaId},(SELECT MAX(id) FROM comanda_pessoas WHERE estabelecimento_id=? AND comanda_id=${comandaId}),?,?)`)
        .bind(id, tenant, chave, hash, cartao, mesaId, tenant, nome, timestamp),
      db.prepare(`UPDATE comandas SET pessoas_count=(SELECT COUNT(*) FROM comanda_pessoas WHERE comanda_id=${comandaId} AND estabelecimento_id=? AND status='pendente') WHERE id=${comandaId} AND estabelecimento_id=?`).bind(tenant, tenant),
      db.prepare("UPDATE mesas SET status='ocupada',aberta_em=COALESCE(aberta_em,?) WHERE id=? AND estabelecimento_id=?").bind(timestamp, mesaId, tenant),
    ]);
  } catch (error) {
    if (/unique|integer overflow|mesa_inativa/i.test(error.message)) {
      const saved = await previous();
      if (saved) return replay(saved);
      return c.json({ error: 'O cartão ou a mesa mudou em outra tela. Confira o atendimento e tente novamente.' }, 409);
    }
    throw error;
  }
  return c.json(await atendimentoDoCartao(env, cartao), 201);
}

// O ID do atendimento impede que uma tela antiga feche o próximo cliente que usar o mesmo cartão.
export async function fecharCartaoHandler(c, env) {
  const a = await env.DB.prepare('SELECT * FROM cartao_atendimentos WHERE id=?').bind(c.params.id).first();
  if (!a) return c.json({ error: 'Atendimento não encontrado' }, 404);
  if (a.encerrado_em) return c.json({ ok: true, repetido: true, venda_id: a.venda_id });
  const b = await c.req.json();
  if (!['dinheiro','pix','credito','debito','vale'].includes(b.forma) || !Number.isFinite(b.total) || b.total<0) return c.json({ error: 'Selecione uma forma de pagamento válida e confira o total' }, 400);
  const reserva = new Date(Date.now()+5*60_000).toISOString();
  const acquired = await env.DB.prepare(`UPDATE comandas SET fechamento_bloqueado_ate=? WHERE id=? AND status IN ('aberta','pre_fechamento')
    AND (fechamento_bloqueado_ate IS NULL OR fechamento_bloqueado_ate<=?)`).bind(reserva, a.comanda_id, now()).run();
  if (!acquired.meta.changes) return c.json({ error: 'Existe um fechamento em andamento. Atualize e tente novamente.' }, 409);
  try {
    const atual = await env.DB.prepare('SELECT * FROM cartao_atendimentos WHERE id=?').bind(a.id).first();
    if (atual.encerrado_em) return c.json({ ok: true, repetido: true, venda_id: atual.venda_id });
    const com = await env.DB.prepare('SELECT * FROM comandas WHERE id=?').bind(a.comanda_id).first();
    const itens = (await env.DB.prepare("SELECT * FROM comanda_itens WHERE comanda_id=? AND pessoa_id=? AND status!='cancelado' ORDER BY id").bind(com.id,a.pessoa_id).all()).results;
    const antigas = (await env.DB.prepare("SELECT id,criado_em FROM vendas WHERE comanda_id=? AND status='concluida'").bind(com.id).all()).results;
    if (itens.length && antigas.length && !somentePedidosPosteriores(itens, antigas)) return c.json({ error: 'Há vendas anteriores nesta mesa. Confira o histórico antes de cobrar estes pedidos.' }, 409);
    const timestamp = now();
    const pessoa = await env.DB.prepare('SELECT nome FROM comanda_pessoas WHERE id=? AND comanda_id=?').bind(a.pessoa_id,a.comanda_id).first();
    const clienteNome = pessoa?.nome || a.cliente_nome;
    const subtotal = Number(itens.reduce((s,i)=>s+num(i.quantidade)*num(i.preco_unitario),0).toFixed(2));
    const taxa = Number((subtotal*num(com.taxa_garcom_pct)/100).toFixed(2));
    const total = Number((subtotal+taxa).toFixed(2));
    if (Math.abs(b.total-total)>0.005) return c.json({ error: 'O consumo mudou. Confira o novo total antes de confirmar o pagamento.' }, 409);
    // Guarda o consumo quitado numa comanda de histórico. Os IDs dos pedidos e
    // suas impressões são preservados; a mesa mantém somente o saldo pendente.
    const arquivo = '(SELECT MAX(id) FROM comandas)';
    const validar = env.DB.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM cartao_atendimentos a
      JOIN comanda_pessoas p ON p.id=a.pessoa_id AND p.estabelecimento_id=a.estabelecimento_id
      JOIN comandas c ON c.id=a.comanda_id AND c.estabelecimento_id=a.estabelecimento_id
      WHERE a.id=? AND a.encerrado_em IS NULL AND p.status='pendente' AND p.comanda_id=c.id AND c.fechamento_bloqueado_ate=?)
      AND (SELECT COUNT(*) FROM comanda_itens WHERE comanda_id=? AND pessoa_id=? AND status!='cancelado')=?
      AND NOT EXISTS (SELECT 1 FROM json_each(?) j WHERE NOT EXISTS (SELECT 1 FROM comanda_itens i
        WHERE i.id=json_extract(j.value,'$.id') AND i.versao=json_extract(j.value,'$.versao') AND i.comanda_id=? AND i.pessoa_id=? AND i.status!='cancelado'))
      THEN 1 ELSE abs(-9223372036854775808) END`).bind(a.id,reserva,com.id,a.pessoa_id,itens.length,JSON.stringify(itens.map(i=>({id:i.id,versao:i.versao}))),com.id,a.pessoa_id);
    const concluir = [
      env.DB.prepare(`INSERT INTO comandas (mesa_id,cliente_nome,garcom_nome,status,taxa_garcom_pct,fechamento_tipo,pessoas_count,comanda_origem_id,criado_em,fechada_em,baixada_em)
        VALUES (?,?,?,'fechada',?,'cartao_individual',1,?,?,?,?)`).bind(a.mesa_id,clienteNome,com.garcom_nome,com.taxa_garcom_pct,com.id,a.criado_em,timestamp,timestamp),
      env.DB.prepare(`UPDATE comanda_itens SET comanda_id=${arquivo} WHERE comanda_id=? AND pessoa_id=?`).bind(com.id,a.pessoa_id),
      env.DB.prepare(`UPDATE comanda_pessoas SET status='baixado',baixada_em=?,comanda_id=${arquivo} WHERE id=?`).bind(timestamp,a.pessoa_id),
      env.DB.prepare(`UPDATE cartao_atendimentos SET encerrado_em=?,venda_id=? WHERE id=?`).bind(timestamp,null,a.id),
      env.DB.prepare(`UPDATE comandas SET pessoas_count=(SELECT COUNT(*) FROM comanda_pessoas WHERE comanda_id=? AND status='pendente') WHERE id=?`).bind(com.id,com.id),
      env.DB.prepare(`UPDATE comandas SET status='fechada',fechada_em=?,fechamento_tipo='individual',baixada_em=? WHERE id=?
        AND NOT EXISTS (SELECT 1 FROM comanda_pessoas WHERE comanda_id=? AND status='pendente')
        AND NOT EXISTS (SELECT 1 FROM comanda_itens WHERE comanda_id=? AND status!='cancelado')`).bind(timestamp,timestamp,com.id,com.id,com.id),
      env.DB.prepare(`UPDATE mesas SET status='livre',aberta_em=NULL WHERE id=? AND NOT EXISTS
        (SELECT 1 FROM comandas WHERE mesa_id=? AND status IN ('aberta','pre_fechamento'))`).bind(a.mesa_id,a.mesa_id),
    ];
    let venda = null;
    if (itens.length) {
      // A venda e o arquivo pertencem ao mesmo batch, inclusive estoque e caixa.
      concluir.push(env.DB.prepare(`UPDATE vendas SET comanda_id=${arquivo},observacoes=? WHERE id=(SELECT MAX(id) FROM vendas)`).bind(`Cliente: ${clienteNome} · Cartão: ${a.cartao}`));
      concluir.push(env.DB.prepare('UPDATE cartao_atendimentos SET venda_id=(SELECT MAX(id) FROM vendas) WHERE id=?').bind(a.id));
      venda = await criarVendaRestaurante({ ...env, fechamentoReserva:reserva, fechamentoValidacoes:[validar] },{
        numero:await gerarNumeroVenda(env,'rest'),tipo:'restaurante',comanda_id:com.id,mesa_id:a.mesa_id,subtotal,desconto:0,taxa_servico:taxa,total,
        responsavel:c.user.nome || com.garcom_nome,itens:itens.map(i=>({...i,total:num(i.quantidade)*num(i.preco_unitario)})),pagamentos:[{forma:b.forma,valor:total}],
      },concluir);
    } else await env.DB.batch([validar,...concluir]);
    return c.json({ ok:true,venda_id:venda?.id || null,total,sem_consumo:!itens.length });
  } catch (error) {
    if (/integer overflow/i.test(error.message)) throw httpError(409, 'O atendimento mudou. Atualize os pedidos antes de confirmar o fechamento.');
    throw error;
  } finally {
    await env.DB.prepare('UPDATE comandas SET fechamento_bloqueado_ate=NULL WHERE id=? AND fechamento_bloqueado_ate=?').bind(a.comanda_id,reserva).run();
  }
}
