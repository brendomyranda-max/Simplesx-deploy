import { now, num, fmtBRL, getConfig, getConfigValue, modulosFromString, modulosToString, MOD_RESTAURANTE, sha256, gerarToken, estabelecimentoId, hashSenha, verificarSenha, cnpjValido, soDigitos, kvGet, kvPut } from './util.js';
import { createDeviceTask } from './handlers-devices.js';

const LOGIN_LIMIT = 8;
const LOGIN_TTL = 15 * 60;

async function loginKey(c, tipo, identificador) {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-real-ip') || 'local';
  return `login:${tipo}:${await sha256(`${ip}:${String(identificador || '').toLowerCase()}`)}`;
}

async function loginBloqueado(env, key) {
  return num(await kvGet(env, key)) >= LOGIN_LIMIT;
}

async function registrarFalha(env, key) {
  const atual = num(await kvGet(env, key));
  await kvPut(env, key, String(atual + 1), { expirationTtl: LOGIN_TTL });
}

async function limparFalhas(env, key) {
  await kvPut(env, key, '0', { expirationTtl: LOGIN_TTL });
}

function cookieSessao(token, c, maxAge = 12 * 60 * 60) {
  const seguro = c.req.header('x-forwarded-proto') === 'https' || !!c.req.header('cf-ray');
  return `simplesx_session=${encodeURIComponent(token || '')}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${seguro ? '; Secure' : ''}`;
}

async function validarTurnstile(c, env, token) {
  if (!env.TURNSTILE_SECRET_KEY) return { indisponivel: true };
  if (!token || String(token).length > 2048) return { valido: false };
  const body = new URLSearchParams({
    secret: String(env.TURNSTILE_SECRET_KEY),
    response: String(token),
  });
  const ip = c.req.header('cf-connecting-ip');
  if (ip) body.set('remoteip', ip);
  try {
    const resposta = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const resultado = await resposta.json();
    return { valido: resposta.ok && resultado.success === true };
  } catch {
    return { indisponivel: true };
  }
}

export async function authConfigHandler(c, env) {
  if (!env.TURNSTILE_SITE_KEY) return c.json({ error: 'Proteção humana não configurada' }, 503);
  return c.json({ turnstile_site_key: String(env.TURNSTILE_SITE_KEY) });
}

export async function meHandler(c) {
  return c.json({ id: c.user.id, nome: c.user.nome, perfil: c.user.perfil, modulos: c.user.modulos });
}

// ============================ FUNCIONÁRIOS ============================

export async function listFuncionariosHandler(c, env) {
  const rows = await env.DB.prepare("SELECT id, nome, usuario, perfil, CASE WHEN pin IS NOT NULL AND pin <> '' THEN 1 ELSE 0 END AS pin_configurado, modulos, ativo, criado_em FROM funcionarios WHERE estabelecimento_id=? ORDER BY nome")
    .bind(estabelecimentoId(env)).all();
  return c.json(rows.results.map((f) => ({ ...f, modulos: modulosFromString(f.modulos) })));
}

export async function createFuncionarioHandler(c, env) {
  const b = await c.req.json();
  if (!b.nome || !b.usuario || !b.senha_hash) return c.json({ error: 'Nome, usuário e senha obrigatórios' }, 400);
  if (String(b.senha_hash).length < 8) return c.json({ error: 'A senha deve ter pelo menos 8 caracteres' }, 400);
  if (b.pin && !/^\d{4,6}$/.test(String(b.pin))) return c.json({ error: 'O PIN deve ter de 4 a 6 dígitos' }, 400);
  const modulos = modulosToString(b.modulos || MOD_RESTAURANTE);
  const r = await env.DB.prepare(
    'INSERT INTO funcionarios (estabelecimento_id, nome, usuario, senha_hash, perfil, pin, modulos, ativo, criado_em) VALUES (?,?,?,?,?,?,?,1,?)'
  )
    .bind(estabelecimentoId(env), b.nome, b.usuario, await hashSenha(b.senha_hash), b.perfil || 'caixa', b.pin ? await hashSenha(b.pin) : null, modulos, now())
    .run();
  return c.json({ id: r.meta.last_row_id, nome: b.nome, usuario: b.usuario, perfil: b.perfil || 'caixa', pin_configurado: b.pin ? 1 : 0, modulos: modulosFromString(modulos), ativo: 1 }, 201);
}

export async function updateFuncionarioHandler(c, env) {
  const b = await c.req.json();
  if (b.senha_hash && String(b.senha_hash).length < 8) return c.json({ error: 'A senha deve ter pelo menos 8 caracteres' }, 400);
  if (b.pin && !/^\d{4,6}$/.test(String(b.pin))) return c.json({ error: 'O PIN deve ter de 4 a 6 dígitos' }, 400);
  const atual = await env.DB.prepare('SELECT * FROM funcionarios WHERE id=? AND estabelecimento_id=?').bind(c.params.id, estabelecimentoId(env)).first();
  if (!atual) return c.json({ error: 'Funcionário não encontrado' }, 404);
  const modulos = b.modulos !== undefined && b.modulos !== null
    ? modulosToString(b.modulos)
    : modulosToString(atual.modulos);
  await env.DB.prepare('UPDATE funcionarios SET nome=?, usuario=?, perfil=?, pin=?, modulos=?, ativo=?, senha_hash=? WHERE id=?')
    .bind(
      b.nome,
      b.usuario,
      b.perfil || 'caixa',
      b.pin ? await hashSenha(b.pin) : atual.pin,
      modulos,
      b.ativo === false ? 0 : 1,
      b.senha_hash ? await hashSenha(b.senha_hash) : atual.senha_hash,
      c.params.id
    )
    .run();
  return c.json({ ok: true });
}

export async function deleteFuncionarioHandler(c, env) {
  if (num(c.params.id) === num(c.user?.id)) return c.json({ error: 'O dono não pode desativar o próprio acesso' }, 400);
  await env.DB.prepare('UPDATE funcionarios SET ativo=0 WHERE id=? AND estabelecimento_id=?').bind(c.params.id, estabelecimentoId(env)).run();
  return c.json({ ok: true });
}

export async function loginFuncionarioHandler(c, env) {
  const b = await c.req.json();
  const cnpj = soDigitos(b.cnpj);
  const key = await loginKey(c, 'senha', `${cnpj}:${b.usuario || ''}`);
  if (await loginBloqueado(env, key)) return c.json({ error: 'Muitas tentativas. Aguarde 15 minutos.' }, 429);
  const humano = await validarTurnstile(c, env, b.turnstile_token);
  if (humano.indisponivel) return c.json({ error: 'Verificação de segurança temporariamente indisponível' }, 503);
  if (!humano.valido) {
    await registrarFalha(env, key);
    return c.json({ error: 'Confirme que você é humano' }, 400);
  }
  if (!cnpjValido(cnpj)) {
    await registrarFalha(env, key);
    return c.json({ error: 'CNPJ, usuário ou senha inválidos' }, 401);
  }
  const acesso = await env.DB.prepare('SELECT id AS estabelecimento_id FROM estabelecimentos WHERE cnpj=? AND ativo=1').bind(cnpj).first();
  if (!acesso) {
    await registrarFalha(env, key);
    return c.json({ error: 'CNPJ, usuário ou senha inválidos' }, 401);
  }
  const row = await env.DB.prepare(
    'SELECT id, nome, perfil, modulos, estabelecimento_id, senha_hash FROM funcionarios WHERE estabelecimento_id=? AND LOWER(usuario)=LOWER(?) AND ativo=1'
  )
    .bind(acesso.estabelecimento_id, b.usuario || '')
    .first();
  if (!row || !(await verificarSenha(b.senha || '', row.senha_hash))) {
    await registrarFalha(env, key);
    return c.json({ error: 'CNPJ, usuário ou senha inválidos' }, 401);
  }
  await limparFalhas(env, key);
  const sessao = gerarToken() + gerarToken();
  const expira = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare('INSERT INTO sessoes (estabelecimento_id, funcionario_id, token_hash, expira_em, criado_em) VALUES (?,?,?,?,?)')
    .bind(row.estabelecimento_id, row.id, await sha256(sessao), expira, now()).run();
  return c.json(
    { ok: true, id: row.id, nome: row.nome, perfil: row.perfil, modulos: modulosFromString(row.modulos) },
    200,
    { 'set-cookie': cookieSessao(sessao, c) }
  );
}

export async function loginPinHandler(c, env) {
  const b = await c.req.json();
  const cnpj = soDigitos(b.cnpj);
  const key = await loginKey(c, 'pin', cnpj);
  if (await loginBloqueado(env, key)) return c.json({ error: 'Muitas tentativas. Aguarde 15 minutos.' }, 429);
  const humano = await validarTurnstile(c, env, b.turnstile_token);
  if (humano.indisponivel) return c.json({ error: 'Verificação de segurança temporariamente indisponível' }, 503);
  if (!humano.valido) {
    await registrarFalha(env, key);
    return c.json({ error: 'Confirme que você é humano' }, 400);
  }
  const acesso = cnpjValido(cnpj)
    ? await env.DB.prepare('SELECT id AS estabelecimento_id FROM estabelecimentos WHERE cnpj=? AND ativo=1').bind(cnpj).first()
    : null;
  const rows = acesso
    ? await env.DB.prepare("SELECT id, nome, perfil, modulos, estabelecimento_id, pin FROM funcionarios WHERE estabelecimento_id=? AND pin IS NOT NULL AND pin <> '' AND ativo=1")
      .bind(acesso.estabelecimento_id).all()
    : { results: [] };
  let row = null;
  for (const candidato of rows.results) {
    if (await verificarSenha(b.pin || '', candidato.pin)) {
      row = candidato;
      break;
    }
  }
  if (!row) {
    await registrarFalha(env, key);
    return c.json({ error: 'CNPJ ou PIN inválido' }, 401);
  }
  await limparFalhas(env, key);
  const sessao = gerarToken() + gerarToken();
  const expira = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare('INSERT INTO sessoes (estabelecimento_id, funcionario_id, token_hash, expira_em, criado_em) VALUES (?,?,?,?,?)')
    .bind(row.estabelecimento_id, row.id, await sha256(sessao), expira, now()).run();
  return c.json(
    { ok: true, id: row.id, nome: row.nome, perfil: row.perfil, modulos: modulosFromString(row.modulos) },
    200,
    { 'set-cookie': cookieSessao(sessao, c) }
  );
}

export async function logoutHandler(c, env) {
  const header = c.req.header('authorization') || '';
  const cookie = String(c.req.header('cookie') || '').split(';').map((item) => item.trim()).find((item) => item.startsWith('simplesx_session='));
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : (cookie ? decodeURIComponent(cookie.slice('simplesx_session='.length)) : '');
  if (token) await env.rawDB.prepare('DELETE FROM sessoes WHERE token_hash=?').bind(await sha256(token)).run();
  return c.json({ ok: true }, 200, { 'set-cookie': cookieSessao('', c, 0) });
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
  if (!b.nome) return c.json({ error: 'Nome da rota de impressão obrigatório' }, 400);
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
  await sincronizarCategoriasDaImpressora(env, r.meta.last_row_id, b.categorias);
  return c.json({ id: r.meta.last_row_id, ...b, porta: num(b.porta) || 9100, ativo: 1 }, 201);
}

export async function updateAgenteHandler(c, env) {
  const b = await c.req.json();
  if (!b.nome) return c.json({ error: 'Nome da rota de impressão obrigatório' }, 400);
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
  await sincronizarCategoriasDaImpressora(env, c.params.id, b.categorias);
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

async function sincronizarCategoriasDaImpressora(env, impressoraId, categorias) {
  const id = num(impressoraId);
  const ids = normalizeIds(categorias);
  await env.DB.prepare('UPDATE categorias SET impressora_agente_id=NULL WHERE impressora_agente_id=?').bind(id).run();
  for (const categoriaId of ids) {
    await env.DB.prepare('UPDATE categorias SET impressora_agente_id=? WHERE id=?').bind(id, categoriaId).run();
  }
}

async function enqueueGestorJob(env, user, { conteudo, impressora, larguraMm = 80 }) {
  const deviceId = await getConfigValue(env, 'gestor_device_id', '');
  if (deviceId) {
    const result = await createDeviceTask(env, user, {
      device_id: deviceId,
      type: 'PRINT_ORDER',
      payload: { content: textoCompativelComEscPos(conteudo), printer: impressora, width_mm: larguraMm, copies: 1, cut: true, feed: larguraMm === 58 ? 3 : 0 },
      idempotency_key: `order-print-${crypto.randomUUID()}`,
      source_type: 'comanda',
    });
    return { ok: true, task_id: result.task.id };
  }
  const gestorToken = await getConfigValue(env, 'gestor_token', '');
  if (!gestorToken) return { ok: false, error: 'Nenhum gestor configurado' };
  const gestor = await env.DB.prepare('SELECT id FROM gestores WHERE token=? AND ativo=1').bind(gestorToken).first();
  if (!gestor) return { ok: false, error: 'Gestor configurado não está cadastrado ou está inativo' };
  const conteudoCompativel = textoCompativelComEscPos(conteudo);
  const r = await env.DB.prepare(
    `INSERT INTO gestor_jobs
      (gestor_token, tipo, conteudo, impressora, largura_mm, copias, cortar, alimentar, status, criado_em)
     VALUES (?, 'texto', ?, ?, ?, 1, 1, ?, 'pendente', ?)`
  ).bind(gestorToken, conteudoCompativel, impressora, larguraMm, larguraMm === 58 ? 3 : 0, now()).run();
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
        (SELECT GROUP_CONCAT(DISTINCT COALESCE(c.impressora_agente_id, pai.impressora_agente_id))
         FROM produto_categorias pc
         JOIN categorias c ON c.id=pc.categoria_id
         LEFT JOIN categorias pai ON pai.id=c.categoria_pai_id
         WHERE pc.produto_id=i.produto_id) AS impressora_ids
       FROM comanda_itens i WHERE i.comanda_id=? AND i.status!='cancelado' ORDER BY i.id`
    ).bind(b.comanda_id).all()
    : await env.DB.prepare(
      `SELECT i.*,
        (SELECT GROUP_CONCAT(DISTINCT COALESCE(c.impressora_agente_id, pai.impressora_agente_id))
         FROM produto_categorias pc
         JOIN categorias c ON c.id=pc.categoria_id
         LEFT JOIN categorias pai ON pai.id=c.categoria_pai_id
         WHERE pc.produto_id=i.produto_id) AS impressora_ids
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
      const job = await enqueueGestorJob(env, c.user, { conteudo: txt, impressora: destino.nome, larguraMm: num(destino.largura_mm) || 80 });
      jobs.push({ impressora: destino.nome, ...job });
    }
    return c.json({ impressao: txt, itens: itens.results.length, setor, tipo, agente: b.agente || null, jobs });
  }
  const rotas = await env.DB.prepare(
    'SELECT id, nome, largura_mm FROM impressora_agentes WHERE ativo=1 AND imprime_pedidos=1 ORDER BY id'
  ).all();
  const jobs = [];
  const enviados = new Set();
  const comRota = new Set();
  let preview = '';
  for (const rota of rotas.results) {
    const selecionados = itens.results.filter((item) => {
      const ids = String(item.impressora_ids || '').split(',').map(num).filter(Boolean);
      return ids.includes(num(rota.id));
    });
    if (!selecionados.length) continue;
    selecionados.forEach((item) => comRota.add(item.id));
    const txt = textoPedido({ empresa, cnpj, mesa, com, destino: rota.nome, itens: selecionados });
    if (!preview) preview = txt;
    const job = await enqueueGestorJob(env, c.user, { conteudo: txt, impressora: rota.nome, larguraMm: num(rota.largura_mm) || 80 });
    jobs.push({ impressora: rota.nome, itens: selecionados.length, ...job });
    if (job.ok) selecionados.forEach((item) => enviados.add(item.id));
  }
  if (enviados.size) {
    const ids = [...enviados];
    const placeholders = ids.map(() => '?').join(',');
    await env.DB.prepare(`UPDATE comanda_itens SET status='enviado', enviado_em=? WHERE id IN (${placeholders}) AND status='novo'`)
      .bind(now(), ...ids).run();
  }
  const semRota = itens.results.filter((item) => !comRota.has(item.id)).map((item) => item.nome);
  const falhas = jobs
    .filter((job) => !job.ok)
    .map((job) => ({ impressora: job.impressora, erro: job.error || 'Falha ao enviar para o gestor' }));
  if (!preview) preview = textoPedido({ empresa, cnpj, mesa, com, destino: setor, itens: itens.results });
  return c.json({ impressao: preview, itens: enviados.size, setor, tipo, agente: b.agente || null, jobs, sem_rota: semRota, falhas });
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
