import { estabelecimentoId, httpError, now, num } from './util.js';

const soDigitos = (v) => String(v || '').replace(/\D/g, '');
const dinheiro = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
const texto = (v) => String(v ?? '').trim();

function configPublica(c) {
  if (!c) return { ativo: 0, ambiente: 'homologacao', provedor: 'simulador', regime_tributario: 1, serie: 1, proximo_numero: 1, emitir_automaticamente: 0 };
  return { ...c, ativo: num(c.ativo), emitir_automaticamente: num(c.emitir_automaticamente) };
}

function validarConfig(c) {
  const faltando = [];
  if (soDigitos(c.cnpj).length !== 14) faltando.push('CNPJ');
  if (!texto(c.razao_social)) faltando.push('razão social');
  if (!texto(c.inscricao_estadual)) faltando.push('inscrição estadual');
  if (!/^[A-Z]{2}$/.test(texto(c.uf).toUpperCase())) faltando.push('UF');
  if (soDigitos(c.codigo_municipio).length !== 7) faltando.push('código IBGE do município');
  if (!texto(c.logradouro) || !texto(c.numero_endereco) || !texto(c.bairro) || soDigitos(c.cep).length !== 8) faltando.push('endereço completo');
  if (!['homologacao', 'producao'].includes(c.ambiente)) faltando.push('ambiente');
  if (faltando.length) throw httpError(400, `Configuração fiscal incompleta: ${faltando.join(', ')}`);
  if (c.ambiente === 'producao' && c.provedor === 'simulador') throw httpError(400, 'O simulador não pode ser usado em produção');
  if (c.provedor !== 'simulador') throw httpError(501, `O adaptador ${c.provedor} precisa ser ativado no servidor antes de habilitar a emissão`);
}

function validarProduto(p) {
  const ncm = soDigitos(p.ncm);
  if (ncm.length !== 8) throw httpError(400, `${p.nome}: informe um NCM com 8 dígitos`);
  if (!/^\d{4}$/.test(texto(p.cfop))) throw httpError(400, `${p.nome}: CFOP inválido`);
  if (num(p.regime_tributario) === 1) {
    if (!texto(p.csosn)) throw httpError(400, `${p.nome}: informe o CSOSN`);
    if (!['102','103','300','400','500'].includes(texto(p.csosn))) {
      throw httpError(400, `${p.nome}: o simulador aceita CSOSN 102, 103, 300, 400 ou 500; outros códigos dependem do adaptador fiscal`);
    }
  } else {
    if (!texto(p.cst_icms)) throw httpError(400, `${p.nome}: informe o CST do ICMS`);
    if (!['00','40','41','50'].includes(texto(p.cst_icms))) {
      throw httpError(400, `${p.nome}: o simulador aceita CST ICMS 00, 40, 41 ou 50; outros códigos dependem do adaptador fiscal`);
    }
  }
}

function calcularItem(row, descontoRateio = 0) {
  const bruto = dinheiro(num(row.quantidade) * num(row.preco_unitario));
  const total = dinheiro(Math.max(0, bruto - descontoRateio));
  const tributaIcms = !row.csosn && texto(row.cst_icms) === '00';
  const baseIcms = tributaIcms ? total : 0;
  return {
    venda_item_id: row.id, produto_id: row.produto_id, nome: row.nome,
    quantidade: num(row.quantidade), valor_unitario: num(row.preco_unitario), valor_total: total,
    ncm: soDigitos(row.ncm), cest: soDigitos(row.cest) || null, cfop: texto(row.cfop), origem: num(row.origem),
    csosn: row.csosn || null, cst_icms: row.cst_icms || null,
    base_icms: baseIcms, aliquota_icms: num(row.aliquota_icms), valor_icms: dinheiro(baseIcms * num(row.aliquota_icms) / 100),
    cst_pis: row.cst_pis || '49', aliquota_pis: num(row.aliquota_pis), valor_pis: dinheiro(total * num(row.aliquota_pis) / 100),
    cst_cofins: row.cst_cofins || '49', aliquota_cofins: num(row.aliquota_cofins), valor_cofins: dinheiro(total * num(row.aliquota_cofins) / 100),
  };
}

async function carregarVendaFiscal(env, vendaId, config) {
  const venda = await env.DB.prepare('SELECT * FROM vendas WHERE id=?').bind(vendaId).first();
  if (!venda) throw httpError(404, 'Venda não encontrada');
  if (venda.status === 'cancelada') throw httpError(409, 'Venda cancelada não pode emitir NFC-e');
  const rows = await env.DB.prepare(
    `SELECT vi.*, pf.ncm, pf.cest, pf.cfop, pf.origem, pf.csosn, pf.cst_icms, pf.aliquota_icms,
      pf.cst_pis, pf.aliquota_pis, pf.cst_cofins, pf.aliquota_cofins
     FROM venda_itens vi LEFT JOIN produto_fiscal pf ON pf.produto_id=vi.produto_id WHERE vi.venda_id=? ORDER BY vi.id`
  ).bind(vendaId).all();
  if (!rows.results.length) throw httpError(400, 'Venda sem itens');
  rows.results.forEach((p) => validarProduto({ ...p, regime_tributario: config.regime_tributario }));
  const subtotal = rows.results.reduce((s, r) => s + num(r.quantidade) * num(r.preco_unitario), 0);
  let restante = num(venda.desconto);
  const itens = rows.results.map((r, index) => {
    const rateio = index === rows.results.length - 1 ? restante : dinheiro(num(venda.desconto) * (num(r.quantidade) * num(r.preco_unitario)) / Math.max(subtotal, 0.01));
    restante = dinheiro(restante - rateio);
    return calcularItem(r, rateio);
  });
  const pagamentos = await env.DB.prepare('SELECT forma, valor FROM pagamentos WHERE venda_id=?').bind(vendaId).all();
  return { venda, itens, pagamentos: pagamentos.results };
}

function chaveSimulada(config, serie, numero) {
  const uf = ({ AC:12, AL:27, AP:16, AM:13, BA:29, CE:23, DF:53, ES:32, GO:52, MA:21, MT:51, MS:50, MG:31, PA:15, PB:25, PR:41, PE:26, PI:22, RJ:33, RN:24, RS:43, RO:11, RR:14, SC:42, SP:35, SE:28, TO:17 })[config.uf] || 99;
  return `${uf}0000${soDigitos(config.cnpj)}65${String(serie).padStart(3, '0')}${String(numero).padStart(9, '0')}9${String(numero).padStart(8, '0')}0`.slice(0, 44);
}

async function simularAutorizacao(config, doc) {
  const chave = chaveSimulada(config, doc.serie, doc.numero);
  return { status: 'simulada', chave_acesso: chave, protocolo: `SIM${Date.now()}`, mensagem: 'Documento simulado em homologação; sem validade fiscal.', autorizado_em: now() };
}

export async function getFiscalConfigHandler(c, env) {
  const row = await env.DB.prepare('SELECT * FROM fiscal_config WHERE estabelecimento_id=?').bind(estabelecimentoId(env)).first();
  return c.json(configPublica(row));
}

export async function putFiscalConfigHandler(c, env) {
  const b = await c.req.json();
  const ambiente = b.ambiente === 'producao' ? 'producao' : 'homologacao';
  const provedor = ['simulador', 'nuvem_fiscal', 'focus_nfe'].includes(b.provedor) ? b.provedor : 'simulador';
  if (b.ativo) validarConfig({ ...b, ambiente, provedor });
  await env.DB.prepare(
    `INSERT INTO fiscal_config (estabelecimento_id,ativo,ambiente,provedor,provedor_empresa_id,razao_social,nome_fantasia,cnpj,
      inscricao_estadual,regime_tributario,uf,codigo_municipio,municipio,cep,logradouro,numero_endereco,bairro,serie,
      proximo_numero,emitir_automaticamente,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(estabelecimento_id) DO UPDATE SET ativo=excluded.ativo,ambiente=excluded.ambiente,provedor=excluded.provedor,
      provedor_empresa_id=excluded.provedor_empresa_id,razao_social=excluded.razao_social,nome_fantasia=excluded.nome_fantasia,
      cnpj=excluded.cnpj,inscricao_estadual=excluded.inscricao_estadual,regime_tributario=excluded.regime_tributario,uf=excluded.uf,
      codigo_municipio=excluded.codigo_municipio,municipio=excluded.municipio,cep=excluded.cep,logradouro=excluded.logradouro,
      numero_endereco=excluded.numero_endereco,bairro=excluded.bairro,serie=excluded.serie,
      emitir_automaticamente=excluded.emitir_automaticamente,atualizado_em=excluded.atualizado_em`
  ).bind(estabelecimentoId(env), b.ativo ? 1 : 0, ambiente, provedor, texto(b.provedor_empresa_id) || null, texto(b.razao_social),
    texto(b.nome_fantasia), soDigitos(b.cnpj), texto(b.inscricao_estadual), num(b.regime_tributario) || 1, texto(b.uf).toUpperCase(),
    soDigitos(b.codigo_municipio), texto(b.municipio), soDigitos(b.cep), texto(b.logradouro), texto(b.numero_endereco), texto(b.bairro),
    Math.max(1, num(b.serie) || 1), Math.max(1, num(b.proximo_numero) || 1), b.emitir_automaticamente ? 1 : 0, now()).run();
  return getFiscalConfigHandler(c, env);
}

export async function listProdutosFiscaisHandler(c, env) {
  const rows = await env.DB.prepare(
    `SELECT p.id, p.nome, p.codigo_interno, p.unidade, p.preco, pf.ncm, pf.cest, COALESCE(pf.cfop,'5102') cfop,
      COALESCE(pf.origem,0) origem, pf.csosn, pf.cst_icms, COALESCE(pf.aliquota_icms,0) aliquota_icms,
      COALESCE(pf.cst_pis,'49') cst_pis, COALESCE(pf.aliquota_pis,0) aliquota_pis,
      COALESCE(pf.cst_cofins,'49') cst_cofins, COALESCE(pf.aliquota_cofins,0) aliquota_cofins
     FROM produtos p LEFT JOIN produto_fiscal pf ON pf.produto_id=p.id WHERE p.ativo=1 AND p.tipo!='insumo' ORDER BY p.nome`
  ).all();
  return c.json(rows.results);
}

export async function putProdutoFiscalHandler(c, env) {
  const b = await c.req.json();
  const p = await env.DB.prepare('SELECT id,nome FROM produtos WHERE id=?').bind(c.params.id).first();
  if (!p) throw httpError(404, 'Produto não encontrado');
  const cfg = await env.DB.prepare('SELECT regime_tributario FROM fiscal_config WHERE estabelecimento_id=?').bind(estabelecimentoId(env)).first();
  validarProduto({ ...b, nome: p.nome, regime_tributario: cfg?.regime_tributario || 1 });
  await env.DB.prepare(
    `INSERT INTO produto_fiscal (estabelecimento_id,produto_id,ncm,cest,cfop,origem,csosn,cst_icms,aliquota_icms,cst_pis,
      aliquota_pis,cst_cofins,aliquota_cofins,codigo_beneficio,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(estabelecimento_id,produto_id) DO UPDATE SET ncm=excluded.ncm,cest=excluded.cest,cfop=excluded.cfop,
      origem=excluded.origem,csosn=excluded.csosn,cst_icms=excluded.cst_icms,aliquota_icms=excluded.aliquota_icms,
      cst_pis=excluded.cst_pis,aliquota_pis=excluded.aliquota_pis,cst_cofins=excluded.cst_cofins,
      aliquota_cofins=excluded.aliquota_cofins,codigo_beneficio=excluded.codigo_beneficio,atualizado_em=excluded.atualizado_em`
  ).bind(estabelecimentoId(env), p.id, soDigitos(b.ncm), soDigitos(b.cest) || null, texto(b.cfop), num(b.origem), texto(b.csosn) || null,
    texto(b.cst_icms) || null, num(b.aliquota_icms), texto(b.cst_pis) || '49', num(b.aliquota_pis), texto(b.cst_cofins) || '49',
    num(b.aliquota_cofins), texto(b.codigo_beneficio) || null, now()).run();
  return c.json({ ok: true });
}

export async function emitirNfceVenda(env, vendaId, { automatico = false } = {}) {
  const existente = await env.DB.prepare('SELECT * FROM documentos_fiscais WHERE venda_id=?').bind(vendaId).first();
  if (existente) return existente;
  const config = await env.DB.prepare('SELECT * FROM fiscal_config WHERE estabelecimento_id=?').bind(estabelecimentoId(env)).first();
  if (!config?.ativo) {
    if (automatico) return null;
    throw httpError(400, 'Emissão de NFC-e não está ativada');
  }
  if (automatico && !config.emitir_automaticamente) return null;
  validarConfig(config);
  const { venda, itens } = await carregarVendaFiscal(env, vendaId, config);
  // rawDB é usado apenas nesta operação atômica; o estabelecimento continua explícito.
  // O adaptador tenant acrescentaria o filtro depois do RETURNING, gerando SQL inválido.
  const nr = await env.rawDB.prepare('UPDATE fiscal_config SET proximo_numero=proximo_numero+1 WHERE estabelecimento_id=? RETURNING proximo_numero-1 AS numero')
    .bind(estabelecimentoId(env)).first();
  const numero = num(nr?.numero);
  const referencia = `nfce-${estabelecimentoId(env)}-${vendaId}`;
  const totais = itens.reduce((a, i) => ({ icms: dinheiro(a.icms+i.valor_icms), pis: dinheiro(a.pis+i.valor_pis), cofins: dinheiro(a.cofins+i.valor_cofins) }), { icms:0,pis:0,cofins:0 });
  const ins = await env.DB.prepare(
    `INSERT INTO documentos_fiscais (venda_id,modelo,serie,numero,ambiente,provedor,referencia,status,valor_produtos,valor_desconto,
      valor_total,valor_icms,valor_pis,valor_cofins,criado_em,atualizado_em) VALUES (?,65,?,?,?,?,?,'processando',?,?,?,?,?,?,?,?)`
  ).bind(vendaId, config.serie, numero, config.ambiente, config.provedor, referencia, num(venda.subtotal), num(venda.desconto), num(venda.total),
    totais.icms, totais.pis, totais.cofins, now(), now()).run();
  const documentoId = ins.meta.last_row_id;
  await env.DB.batch(itens.map((i) => env.DB.prepare(
    `INSERT INTO documento_fiscal_itens (documento_id,venda_item_id,produto_id,nome,quantidade,valor_unitario,valor_total,ncm,cest,cfop,
      origem,csosn,cst_icms,base_icms,aliquota_icms,valor_icms,cst_pis,aliquota_pis,valor_pis,cst_cofins,aliquota_cofins,valor_cofins)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(documentoId,i.venda_item_id,i.produto_id,i.nome,i.quantidade,i.valor_unitario,i.valor_total,i.ncm,i.cest,i.cfop,i.origem,
    i.csosn,i.cst_icms,i.base_icms,i.aliquota_icms,i.valor_icms,i.cst_pis,i.aliquota_pis,i.valor_pis,i.cst_cofins,i.aliquota_cofins,i.valor_cofins)));
  let retorno;
  if (config.provedor === 'simulador') retorno = await simularAutorizacao(config, { serie: config.serie, numero });
  else throw httpError(501, `Adaptador ${config.provedor} ainda não possui credencial configurada no servidor`);
  await env.DB.prepare('UPDATE documentos_fiscais SET status=?,chave_acesso=?,protocolo=?,mensagem=?,autorizado_em=?,atualizado_em=? WHERE id=?')
    .bind(retorno.status,retorno.chave_acesso,retorno.protocolo,retorno.mensagem,retorno.autorizado_em,now(),documentoId).run();
  await env.DB.prepare('INSERT INTO documento_fiscal_eventos (documento_id,tipo,status,protocolo,resposta,criado_em) VALUES (?,?,?,?,?,?)')
    .bind(documentoId,'emissao',retorno.status,retorno.protocolo,retorno.mensagem,now()).run();
  return env.DB.prepare('SELECT * FROM documentos_fiscais WHERE id=?').bind(documentoId).first();
}

export async function emitirNfceHandler(c, env) { return c.json(await emitirNfceVenda(env, c.params.id), 201); }

export async function listDocumentosFiscaisHandler(c, env) {
  const rows = await env.DB.prepare(`SELECT d.*,v.numero venda_numero FROM documentos_fiscais d JOIN vendas v ON v.id=d.venda_id ORDER BY d.id DESC LIMIT 200`).all();
  return c.json(rows.results);
}

export async function getDocumentoFiscalHandler(c, env) {
  const d = await env.DB.prepare('SELECT * FROM documentos_fiscais WHERE id=?').bind(c.params.id).first();
  if (!d) throw httpError(404, 'Documento fiscal não encontrado');
  const itens = await env.DB.prepare('SELECT * FROM documento_fiscal_itens WHERE documento_id=? ORDER BY id').bind(d.id).all();
  const eventos = await env.DB.prepare('SELECT * FROM documento_fiscal_eventos WHERE documento_id=? ORDER BY id DESC').bind(d.id).all();
  return c.json({ ...d, itens: itens.results, eventos: eventos.results });
}

export async function cancelarDocumentoFiscalHandler(c, env) {
  const b = await c.req.json();
  const justificativa = texto(b.justificativa);
  if (justificativa.length < 15 || justificativa.length > 255) throw httpError(400, 'A justificativa deve ter entre 15 e 255 caracteres');
  const d = await env.DB.prepare('SELECT * FROM documentos_fiscais WHERE id=?').bind(c.params.id).first();
  if (!d) throw httpError(404, 'Documento fiscal não encontrado');
  if (!['simulada','autorizada'].includes(d.status)) throw httpError(409, 'Documento não pode ser cancelado neste status');
  if (d.provedor !== 'simulador') throw httpError(501, 'O cancelamento real depende do adaptador do provedor');
  const protocolo = `CANSIM${Date.now()}`;
  await env.DB.prepare("UPDATE documentos_fiscais SET status='cancelada',cancelado_em=?,mensagem=?,atualizado_em=? WHERE id=?")
    .bind(now(),`Cancelada: ${justificativa}`,now(),d.id).run();
  await env.DB.prepare("INSERT INTO documento_fiscal_eventos (documento_id,tipo,status,protocolo,justificativa,resposta,criado_em) VALUES (?,'cancelamento','cancelada',?,?,?,?)")
    .bind(d.id,protocolo,justificativa,'Cancelamento simulado',now()).run();
  return c.json({ ok: true, status: 'cancelada', protocolo });
}
