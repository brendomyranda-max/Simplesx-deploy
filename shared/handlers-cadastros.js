import { now, num, fmtBRL, getConfig, getConfigValue, modulosFromString, modulosToString, MOD_RESTAURANTE } from './util.js';

// ============================ FUNCIONÁRIOS ============================

export async function listFuncionariosHandler(c, env) {
  const rows = await env.DB.prepare('SELECT id, nome, usuario, perfil, pin, modulos, ativo, criado_em FROM funcionarios ORDER BY nome').all();
  return c.json(rows.results.map((f) => ({ ...f, modulos: modulosFromString(f.modulos) })));
}

export async function createFuncionarioHandler(c, env) {
  const b = await c.req.json();
  if (!b.nome || !b.usuario || !b.senha_hash) return c.json({ error: 'Nome, usuário e senha obrigatórios' }, 400);
  const modulos = modulosToString(b.modulos || MOD_RESTAURANTE);
  const r = await env.DB.prepare(
    'INSERT INTO funcionarios (nome, usuario, senha_hash, perfil, pin, modulos, ativo, criado_em) VALUES (?,?,?,?,?,?,1,?)'
  )
    .bind(b.nome, b.usuario, b.senha_hash, b.perfil || 'caixa', b.pin || null, modulos, now())
    .run();
  return c.json({ id: r.meta.last_row_id, nome: b.nome, usuario: b.usuario, perfil: b.perfil || 'caixa', pin: b.pin || null, modulos: modulosFromString(modulos), ativo: 1 }, 201);
}

export async function updateFuncionarioHandler(c, env) {
  const b = await c.req.json();
  const atual = await env.DB.prepare('SELECT * FROM funcionarios WHERE id=?').bind(c.params.id).first();
  if (!atual) return c.json({ error: 'Funcionário não encontrado' }, 404);
  const modulos = b.modulos !== undefined && b.modulos !== null
    ? modulosToString(b.modulos)
    : modulosToString(atual.modulos);
  await env.DB.prepare('UPDATE funcionarios SET nome=?, usuario=?, perfil=?, pin=?, modulos=?, ativo=?, senha_hash=? WHERE id=?')
    .bind(
      b.nome,
      b.usuario,
      b.perfil || 'caixa',
      b.pin || null,
      modulos,
      b.ativo === false ? 0 : 1,
      b.senha_hash || atual.senha_hash,
      c.params.id
    )
    .run();
  return c.json({ ok: true });
}

export async function deleteFuncionarioHandler(c, env) {
  await env.DB.prepare('UPDATE funcionarios SET ativo=0 WHERE id=?').bind(c.params.id).run();
  return c.json({ ok: true });
}

export async function loginFuncionarioHandler(c, env) {
  const b = await c.req.json();
  const row = await env.DB.prepare(
    'SELECT id, nome, perfil, modulos FROM funcionarios WHERE LOWER(usuario)=LOWER(?) AND senha_hash=? AND ativo=1'
  )
    .bind(b.usuario || '', b.senha || '')
    .first();
  if (!row) return c.json({ error: 'Usuário ou senha inválidos' }, 401);
  return c.json({ ok: true, id: row.id, nome: row.nome, perfil: row.perfil, modulos: modulosFromString(row.modulos) });
}

export async function loginPinHandler(c, env) {
  const b = await c.req.json();
  const row = await env.DB.prepare('SELECT id, nome, perfil, modulos FROM funcionarios WHERE pin=? AND ativo=1')
    .bind(b.pin || '')
    .first();
  if (!row) return c.json({ error: 'PIN inválido' }, 401);
  return c.json({ ok: true, id: row.id, nome: row.nome, perfil: row.perfil, modulos: modulosFromString(row.modulos) });
}

// ============================ SETORES / IMPRESSORAS ============================

export async function listSetoresHandler(c, env) {
  const rows = await env.DB.prepare('SELECT * FROM setores_impressao ORDER BY id').all();
  return c.json(rows.results);
}

export async function createSetorHandler(c, env) {
  const b = await c.req.json();
  if (!b.nome) return c.json({ error: 'Nome obrigatório' }, 400);
  const r = await env.DB.prepare(
    'INSERT INTO setores_impressao (nome, padrao_impressora, ativo, criado_em) VALUES (?,?,1,?)'
  )
    .bind(b.nome, b.padrao_impressora || null, now())
    .run();
  return c.json({ id: r.meta.last_row_id, nome: b.nome, padrao_impressora: b.padrao_impressora || null, ativo: 1 }, 201);
}

export async function listAgentesHandler(c, env) {
  const rows = await env.DB.prepare('SELECT * FROM impressora_agentes ORDER BY id').all();
  return c.json(rows.results.map((a) => ({
    ...a,
    categorias: parseIds(a.categorias),
    imprime_pedidos: a.imprime_pedidos !== 0,
    imprime_conta: a.imprime_conta === 1,
  })));
}

export async function createAgenteHandler(c, env) {
  const b = await c.req.json();
  if (!b.nome) return c.json({ error: 'Nome da fila CUPS obrigatório' }, 400);
  const r = await env.DB.prepare(
    `INSERT INTO impressora_agentes
      (nome, ip, porta, tipo, protocolo, categorias, imprime_pedidos, imprime_conta, largura_mm, ativo, criado_em)
     VALUES (?,?,?,?,?,?,?,?,?,1,?)`
  )
    .bind(
      String(b.nome).trim(), b.ip || '', num(b.porta) || 9100, b.tipo || 'impressora', b.protocolo || 'cups',
      JSON.stringify(normalizeIds(b.categorias)), b.imprime_pedidos === false ? 0 : 1,
      b.imprime_conta ? 1 : 0, num(b.largura_mm) === 58 ? 58 : 80, now()
    )
    .run();
  return c.json({ id: r.meta.last_row_id, ...b, porta: num(b.porta) || 9100, ativo: 1 }, 201);
}

export async function updateAgenteHandler(c, env) {
  const b = await c.req.json();
  if (!b.nome) return c.json({ error: 'Nome da fila CUPS obrigatório' }, 400);
  const atual = await env.DB.prepare('SELECT id FROM impressora_agentes WHERE id=?').bind(c.params.id).first();
  if (!atual) return c.json({ error: 'Impressora não encontrada' }, 404);
  await env.DB.prepare(
    `UPDATE impressora_agentes SET nome=?, ip=?, porta=?, tipo=?, protocolo=?, categorias=?,
      imprime_pedidos=?, imprime_conta=?, largura_mm=?, ativo=? WHERE id=?`
  ).bind(
    String(b.nome).trim(), b.ip || '', num(b.porta) || 9100, b.tipo || 'impressora', b.protocolo || 'cups',
    JSON.stringify(normalizeIds(b.categorias)), b.imprime_pedidos === false ? 0 : 1,
    b.imprime_conta ? 1 : 0, num(b.largura_mm) === 58 ? 58 : 80, b.ativo === false ? 0 : 1, c.params.id
  ).run();
  return c.json({ ok: true });
}

export async function listEtiquetasHandler(c, env) {
  const rows = await env.DB.prepare('SELECT * FROM impressora_etiquetas ORDER BY id').all();
  return c.json(rows.results);
}

export async function createEtiquetaHandler(c, env) {
  const b = await c.req.json();
  if (!b.nome) return c.json({ error: 'Nome obrigatório' }, 400);
  const r = await env.DB.prepare(
    'INSERT INTO impressora_etiquetas (nome, largura_mm, altura_mm, margem_mm, ativo, criado_em) VALUES (?,?,?,?,1,?)'
  )
    .bind(b.nome, num(b.largura_mm) || 58, num(b.altura_mm) || 40, num(b.margem_mm) || 0, now())
    .run();
  return c.json({ id: r.meta.last_row_id, ...b, ativo: 1 }, 201);
}

// ============================ IMPRESSÃO (simulada) ============================

function linha(caracter = '=', n = 32) {
  return caracter.repeat(n);
}

function parseIds(value) {
  try {
    const parsed = Array.isArray(value) ? value : JSON.parse(value || '[]');
    return normalizeIds(parsed);
  } catch {
    return [];
  }
}

function normalizeIds(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(num).filter((id) => id > 0))];
}

async function enqueueGestorJob(env, { conteudo, impressora, larguraMm = 80 }) {
  const gestorToken = await getConfigValue(env, 'gestor_token', '');
  if (!gestorToken) return { ok: false, error: 'Nenhum gestor configurado' };
  const gestor = await env.DB.prepare('SELECT id FROM gestores WHERE token=? AND ativo=1').bind(gestorToken).first();
  if (!gestor) return { ok: false, error: 'Gestor configurado não está cadastrado ou está inativo' };
  // Filas RAW/ESC-POS interpretam texto conforme a pagina de codigos configurada
  // na impressora e frequentemente descartam caracteres como c-cedilha e acentos.
  // O gestor ja suporta HTML, que e renderizado em Unicode antes de chegar ao CUPS.
  const larguraImprimivel = larguraMm === 58 ? 48 : 72;
  const conteudoCompativel = textoCompativelComEscPos(conteudo);
  const conteudoHtml = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    @page { size: ${larguraImprimivel}mm auto; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; width: ${larguraImprimivel}mm; }
    body { color: #000; background: #fff; font-family: "DejaVu Sans Mono", "Liberation Mono", monospace; font-size: 11px; line-height: 1.35; }
    pre { width: 100%; margin: 0; padding: 2mm; color: #000; font: inherit; white-space: pre-wrap; overflow-wrap: anywhere; }
  </style>
</head>
<body><pre>${escapePrintHtml(conteudoCompativel)}</pre></body>
</html>`;
  const r = await env.DB.prepare(
    `INSERT INTO gestor_jobs
      (gestor_token, tipo, conteudo, impressora, largura_mm, copias, cortar, alimentar, status, criado_em)
     VALUES (?, 'html', ?, ?, ?, 1, 1, ?, 'pendente', ?)`
  ).bind(gestorToken, conteudoHtml, impressora, larguraMm, larguraMm === 58 ? 3 : 0, now()).run();
  return { ok: true, job_id: r.meta.last_row_id };
}

function textoCompativelComEscPos(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replaceAll('º', 'o')
    .replaceAll('ª', 'a')
    .replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
}

function escapePrintHtml(value) {
  return String(value).normalize('NFC')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function textoPedido({ empresa, cnpj, mesa, com, destino, itens }) {
  return [
    linha(),
    '    ' + String(empresa).toUpperCase(),
    ...(cnpj ? [`CNPJ: ${cnpj}`] : []),
    linha(),
    `MESA: ${mesa?.numero || '-'}  GARÇOM: ${com.garcom_nome || '-'}`,
    `CLIENTE: ${com.cliente_nome || '-'}   DESTINO: ${destino}`,
    linha('-'),
    ...itens.map((i) => `${num(i.quantidade)}x ${i.nome}${i.observacao ? '  *' + i.observacao : ''}`),
    linha(),
    `Emitida: ${new Date().toLocaleString('pt-BR')}`,
    linha(),
  ].join('\n');
}

export async function imprimirComandaHandler(c, env) {
  const b = await c.req.json();
  const com = await env.DB.prepare('SELECT * FROM comandas WHERE id=?').bind(b.comanda_id).first();
  if (!com) return c.json({ error: 'Comanda não encontrada' }, 404);
  const mesa = await env.DB.prepare('SELECT numero, nome FROM mesas WHERE id=?').bind(com.mesa_id).first();
  const config = await getConfig(env);
  const empresa = config.empresa_nome || String(c.req.query('empresa') || 'MEU NEGÓCIO');
  const cnpj = config.empresa_cnpj || '';

  const setor = b.setor || 'Cozinha';
  const tipo = b.tipo || 'cozinha';

  const itens = tipo === 'conta'
    ? await env.DB.prepare(
      `SELECT i.*,
        (SELECT GROUP_CONCAT(pc.categoria_id) FROM produto_categorias pc WHERE pc.produto_id=i.produto_id) AS categoria_ids
       FROM comanda_itens i WHERE i.comanda_id=? AND i.status!='cancelado' ORDER BY i.id`
    ).bind(b.comanda_id).all()
    : await env.DB.prepare(
      `SELECT i.*,
        (SELECT GROUP_CONCAT(pc.categoria_id) FROM produto_categorias pc WHERE pc.produto_id=i.produto_id) AS categoria_ids
       FROM comanda_itens i WHERE i.comanda_id=? AND i.status='novo' ORDER BY i.id`
    ).bind(b.comanda_id).all();

  if (tipo === 'conta') {
    const taxaPct = num(com.taxa_garcom_pct);
    const sub = itens.results.reduce((s, i) => s + num(i.quantidade) * num(i.preco_unitario), 0);
    const garcom = sub * (taxaPct / 100);
    const total = sub + garcom;
    const txt = [
      linha(),
      '    ' + String(empresa).toUpperCase(),
      ...(cnpj ? [`CNPJ: ${cnpj}`] : []),
      linha(),
      `MESA: ${mesa?.numero || '-'}    GARÇOM: ${com.garcom_nome || '-'}`,
      linha('-'),
      ...itens.results.map(
        (i) => `${num(i.quantidade)}x ${i.nome}  ${fmtBRL(num(i.quantidade) * num(i.preco_unitario))}`
      ),
      linha('-'),
      `Subtotal: ${fmtBRL(sub)}`,
      taxaPct > 0 ? `Garçom (${taxaPct}%): ${fmtBRL(garcom)}` : '',
      `TOTAL: ${fmtBRL(total)}`,
      linha(),
      `Emitida: ${new Date().toLocaleString('pt-BR')}`,
      linha(),
    ]
      .filter((l) => l !== '')
      .join('\n');
    const destinos = await env.DB.prepare(
      'SELECT nome, largura_mm FROM impressora_agentes WHERE ativo=1 AND imprime_conta=1 ORDER BY id'
    ).all();
    const jobs = [];
    for (const destino of destinos.results) {
      const job = await enqueueGestorJob(env, { conteudo: txt, impressora: destino.nome, larguraMm: num(destino.largura_mm) || 80 });
      jobs.push({ impressora: destino.nome, ...job });
    }
    return c.json({ impressao: txt, itens: itens.results.length, setor, tipo, agente: b.agente || null, jobs });
  }
  const rotas = await env.DB.prepare(
    'SELECT id, nome, categorias, largura_mm FROM impressora_agentes WHERE ativo=1 AND imprime_pedidos=1 ORDER BY id'
  ).all();
  const jobs = [];
  const enviados = new Set();
  let preview = '';
  for (const rota of rotas.results) {
    const categorias = new Set(parseIds(rota.categorias));
    const selecionados = itens.results.filter((item) => {
      const ids = String(item.categoria_ids || '').split(',').map(num).filter(Boolean);
      return ids.some((id) => categorias.has(id));
    });
    if (!selecionados.length) continue;
    const txt = textoPedido({ empresa, cnpj, mesa, com, destino: rota.nome, itens: selecionados });
    if (!preview) preview = txt;
    const job = await enqueueGestorJob(env, { conteudo: txt, impressora: rota.nome, larguraMm: num(rota.largura_mm) || 80 });
    jobs.push({ impressora: rota.nome, itens: selecionados.length, ...job });
    if (job.ok) selecionados.forEach((item) => enviados.add(item.id));
  }
  if (enviados.size) {
    const ids = [...enviados];
    const placeholders = ids.map(() => '?').join(',');
    await env.DB.prepare(`UPDATE comanda_itens SET status='enviado', enviado_em=? WHERE id IN (${placeholders}) AND status='novo'`)
      .bind(now(), ...ids).run();
  }
  const semRota = itens.results.filter((item) => !enviados.has(item.id)).map((item) => item.nome);
  if (!preview) preview = textoPedido({ empresa, cnpj, mesa, com, destino: setor, itens: itens.results });
  return c.json({ impressao: preview, itens: enviados.size, setor, tipo, agente: b.agente || null, jobs, sem_rota: semRota });
}

export async function imprimirPessoaComandaHandler(c, env) {
  const b = await c.req.json();
  const com = await env.DB.prepare('SELECT * FROM comandas WHERE id=?').bind(b.comanda_id).first();
  if (!com) return c.json({ error: 'Comanda não encontrada' }, 404);
  const pessoa = await env.DB.prepare('SELECT * FROM comanda_pessoas WHERE id=? AND comanda_id=?')
    .bind(b.pessoa_id, com.id)
    .first();
  if (!pessoa) return c.json({ error: 'Pessoa não encontrada' }, 404);
  const mesa = await env.DB.prepare('SELECT numero, nome FROM mesas WHERE id=?').bind(com.mesa_id).first();
  let mesaOrigem = mesa?.nome || mesa?.numero || '-';
  if (com.comanda_origem_id) {
    const orig = await env.DB.prepare('SELECT mesa_id FROM comandas WHERE id=?').bind(com.comanda_origem_id).first();
    if (orig) {
      const m = await env.DB.prepare('SELECT numero, nome FROM mesas WHERE id=?').bind(orig.mesa_id).first();
      if (m) mesaOrigem = m.nome || m.numero;
    }
  }
  const itens = await env.DB.prepare(
    "SELECT * FROM comanda_itens WHERE comanda_id=? AND pessoa_id=? AND status!='cancelado' ORDER BY id"
  )
    .bind(com.id, pessoa.id)
    .all();
  const individual = com.individual_valores ? JSON.parse(com.individual_valores) : null;
  const sub = itens.results.reduce((s, i) => s + num(i.quantidade) * num(i.preco_unitario), 0);
  const taxa = num(com.taxa_garcom_pct);
  const valor =
    individual?.valores?.[pessoa.id] !== undefined
      ? num(individual.valores[pessoa.id])
      : num((sub * (1 + taxa / 100)).toFixed(2));
  const config = await getConfig(env);
  const empresa = config.empresa_nome || String(c.req.query('empresa') || 'MEU NEGÓCIO');
  const cnpj = config.empresa_cnpj || '';

  const txt = [
    linha(),
    '    ' + String(empresa).toUpperCase(),
    ...(cnpj ? [`CNPJ: ${cnpj}`] : []),
    linha(),
    `CONTA INDIVIDUAL  Nº ${com.id}`,
    `PESSOA: ${pessoa.nome || '-'}`,
    `MESA ORIGEM: ${mesaOrigem}`,
    `GARÇOM: ${com.garcom_nome || '-'}`,
    linha('-'),
    ...itens.results.map(
      (i) => `${num(i.quantidade)}x ${i.nome}  ${fmtBRL(num(i.quantidade) * num(i.preco_unitario))}`
    ),
    linha('-'),
    taxa > 0 ? `GARÇOM (${taxa}%): ${fmtBRL(sub * (taxa / 100))}` : '',
    `TOTAL: ${fmtBRL(valor)}`,
    `STATUS: ${pessoa.status === 'baixado' ? 'PAGO' : 'PENDENTE'}`,
    linha(),
    `Emitida: ${new Date().toLocaleString('pt-BR')}`,
    linha(),
  ]
    .filter((l) => l !== '')
    .join('\n');

  return c.json({ impressao: txt, pessoa, total: valor });
}

export async function imprimirEtiquetaHandler(c, env) {
  const v = await env.DB.prepare(
    `SELECT v.*, p.nome AS produto_nome, p.unidade, p.marca,
     (SELECT codigo FROM produto_codigos_barras WHERE produto_id=v.produto_id AND principal=1 LIMIT 1) AS codigo_barras
     FROM validade_controles v JOIN produtos p ON p.id=v.produto_id WHERE v.id=?`
  )
    .bind(c.params.id)
    .first();
  if (!v) return c.json({ error: 'Controle não encontrado' }, 404);
  const txt = [
    linha(),
    v.produto_nome,
    v.marca ? `MARCA: ${v.marca}` : '',
    `ABERTO: ${v.data_abertura || '-'}`,
    `VENCE: ${v.data_vencimento}`,
    `TEMP: ${v.temperatura || 'Ambiente'}`,
    `RESP: ${v.responsavel || '-'}`,
    v.codigo_barras || '',
    linha(),
  ]
    .filter((l) => l !== '')
    .join('\n');
  return c.json({ impressao: txt, etiqueta: v });
}
