/** Contas dos compradores. Nunca usa a sessão ou as permissões de um lojista. */
import { gerarToken, hashSenha, verificarSenha, sha256, now, httpError } from './util.js';

const COOKIE = 'doixp_cliente';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const PUBLIC_FIELDS = 'id,nome,telefone,endereco,numero,complemento,latitude,longitude';

function resposta(c, data, status = 200, headers = {}) {
  return c.json(data, status, { 'cache-control': 'no-store', ...headers });
}

function cookie(c, token, age = SESSION_SECONDS) {
  const secure = c.req.header('x-forwarded-proto') === 'https' || !!c.req.header('cf-ray');
  return `${COOKIE}=${token}; Path=/api/public; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
}

function tokenDaRequisicao(c) {
  return String(c.req.header('cookie') || '').split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || '';
}

function validarOrigem(c) {
  // Impede autenticação ou alteração de perfil por formulários de outro site.
  if (c.req.header('sec-fetch-site') === 'cross-site') throw httpError(403, 'Origem não autorizada.');
  const origin = c.req.header('origin');
  const host = c.req.header('host');
  if (origin && host) {
    try { if (new URL(origin).host !== host) throw new Error(); }
    catch { throw httpError(403, 'Origem não autorizada.'); }
  }
  const contentType = c.req.header('content-type');
  if (contentType && !contentType.toLowerCase().startsWith('application/json')) throw httpError(415, 'Envie os dados em JSON.');
}

function texto(value, max, label, required = false) {
  if (value != null && typeof value !== 'string') throw httpError(400, `${label} inválido.`);
  const clean = String(value ?? '').trim();
  if ((required && !clean) || clean.length > max || /[\x00-\x1f]/.test(clean)) throw httpError(400, `${label} inválido.`);
  return clean;
}

function telefone(value) {
  let phone = texto(value, 30, 'Telefone').replace(/\D/g, '');
  if (phone.length >= 12 && phone.startsWith('55')) phone = phone.slice(2);
  if (!/^[1-9]\d{9,10}$/.test(phone)) throw httpError(400, 'Informe um telefone com DDD.');
  return phone;
}

function senha(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) throw httpError(400, 'A senha deve ter entre 8 e 128 caracteres.');
  return value;
}

function perfil(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, 'Dados do perfil inválidos.');
  const nome = texto(body.nome, 120, 'Nome', true);
  const endereco = texto(body.endereco, 400, 'Endereço');
  const numero = texto(body.numero, 30, 'Número');
  const complemento = texto(body.complemento, 100, 'Complemento');
  const hasPoint = body.latitude != null || body.longitude != null;
  const latitude = body.latitude, longitude = body.longitude;
  if (hasPoint && (!endereco || typeof latitude !== 'number' || !Number.isFinite(latitude) || Math.abs(latitude) > 90
    || typeof longitude !== 'number' || !Number.isFinite(longitude) || Math.abs(longitude) > 180)) throw httpError(400, 'Localização inválida.');
  return { nome, endereco, numero, complemento, latitude: hasPoint ? latitude : null, longitude: hasPoint ? longitude : null };
}

async function consumirTentativa(env, key, max) {
  const timestamp = Date.now();
  const row = await env.DB.prepare(`INSERT INTO clientes_login_tentativas(chave,tentativas,expira_em) VALUES (?,1,?)
    ON CONFLICT(chave) DO UPDATE SET tentativas=CASE WHEN expira_em<=? THEN 1 ELSE tentativas+1 END,
      expira_em=CASE WHEN expira_em<=? THEN excluded.expira_em ELSE expira_em END
    RETURNING tentativas`).bind(key, timestamp + 900000, timestamp, timestamp).first();
  if (row.tentativas > max) throw httpError(429, 'Muitas tentativas. Aguarde 15 minutos.');
}

async function limitar(c, env, tipo, phone = '') {
  if (phone.startsWith('55') && phone.length >= 12) phone = phone.slice(2);
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-real-ip') || 'local';
  await consumirTentativa(env, `${tipo}:ip:${await sha256(ip)}`, tipo === 'cadastro' ? 8 : 40);
  const key = `${tipo}:conta:${await sha256(`${ip}:${phone}`)}`;
  await consumirTentativa(env, key, 8);
  return key;
}

export async function clienteDaSessao(c, env, obrigatorio = false) {
  const token = tokenDaRequisicao(c);
  const row = /^[A-Fa-f0-9]{64}$/.test(token) ? await env.DB.prepare(`SELECT ${PUBLIC_FIELDS.split(',').map((field) => `c.${field}`).join(',')}
    FROM clientes_sessoes s JOIN clientes_marketplace c ON c.id=s.cliente_id WHERE s.token_hash=? AND s.expira_em>?`)
    .bind(await sha256(token), now()).first() : null;
  if (!row && obrigatorio) throw httpError(401, 'Entre na sua conta para continuar.');
  return row || null;
}

async function iniciarSessao(c, env, id, status = 200) {
  const token = gerarToken() + gerarToken();
  const timestamp = now();
  const previous = tokenDaRequisicao(c);
  const statements = [
    env.DB.prepare('DELETE FROM clientes_sessoes WHERE expira_em<=?').bind(timestamp),
    env.DB.prepare('DELETE FROM clientes_login_tentativas WHERE expira_em<=?').bind(Date.now()),
  ];
  if (/^[A-Fa-f0-9]{64}$/.test(previous)) statements.push(env.DB.prepare('DELETE FROM clientes_sessoes WHERE token_hash=?').bind(await sha256(previous)));
  statements.push(env.DB.prepare('INSERT INTO clientes_sessoes(token_hash,cliente_id,expira_em,criado_em) VALUES(?,?,?,?)')
    .bind(await sha256(token), id, new Date(Date.now() + SESSION_SECONDS * 1000).toISOString(), timestamp));
  await env.DB.batch(statements);
  const cliente = await env.DB.prepare(`SELECT ${PUBLIC_FIELDS} FROM clientes_marketplace WHERE id=?`).bind(id).first();
  return resposta(c, cliente, status, { 'set-cookie': cookie(c, token) });
}

export async function cadastrarClienteHandler(c, env) {
  validarOrigem(c);
  const body = await c.req.json();
  const key = await limitar(c, env, 'cadastro', String(body?.telefone || '').replace(/\D/g, ''));
  const phone = telefone(body?.telefone);
  const password = senha(body?.senha);
  const data = perfil(body);
  const result = await env.DB.prepare(`INSERT INTO clientes_marketplace(nome,telefone,senha_hash,endereco,numero,complemento,latitude,longitude,criado_em,atualizado_em)
    VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(telefone) DO NOTHING RETURNING id`)
    .bind(data.nome, phone, await hashSenha(password), data.endereco, data.numero, data.complemento, data.latitude, data.longitude, now(), now()).first();
  if (!result) return resposta(c, { error: 'Este telefone já possui uma conta. Entre com sua senha.' }, 409);
  await env.DB.prepare('DELETE FROM clientes_login_tentativas WHERE chave=?').bind(key).run();
  return iniciarSessao(c, env, result.id, 201);
}

export async function loginClienteHandler(c, env) {
  validarOrigem(c);
  const body = await c.req.json();
  const key = await limitar(c, env, 'login', String(body?.telefone || '').replace(/\D/g, ''));
  const phone = telefone(body?.telefone);
  const password = senha(body?.senha);
  const row = await env.DB.prepare('SELECT id,senha_hash FROM clientes_marketplace WHERE telefone=?').bind(phone).first();
  // Mesmo custo de derivação para telefones existentes e inexistentes.
  const hash = row?.senha_hash || `pbkdf2:${'0'.repeat(32)}:${'0'.repeat(64)}`;
  if (!(await verificarSenha(password, hash)) || !row) return resposta(c, { error: 'Telefone ou senha inválidos.' }, 401);
  await env.DB.prepare('DELETE FROM clientes_login_tentativas WHERE chave=?').bind(key).run();
  return iniciarSessao(c, env, row.id);
}

export async function perfilClienteHandler(c, env) {
  return resposta(c, await clienteDaSessao(c, env, true));
}

export async function atualizarClienteHandler(c, env) {
  validarOrigem(c);
  const cliente = await clienteDaSessao(c, env, true);
  const data = perfil(await c.req.json());
  await env.DB.prepare('UPDATE clientes_marketplace SET nome=?,endereco=?,numero=?,complemento=?,latitude=?,longitude=?,atualizado_em=? WHERE id=?')
    .bind(data.nome, data.endereco, data.numero, data.complemento, data.latitude, data.longitude, now(), cliente.id).run();
  return resposta(c, { ...cliente, ...data });
}

export async function logoutClienteHandler(c, env) {
  validarOrigem(c);
  const token = tokenDaRequisicao(c);
  if (/^[A-Fa-f0-9]{64}$/.test(token)) await env.DB.prepare('DELETE FROM clientes_sessoes WHERE token_hash=?').bind(await sha256(token)).run();
  return resposta(c, { ok: true }, 200, { 'set-cookie': cookie(c, '', 0) });
}

export async function pedidosClienteHandler(c, env) {
  const cliente = await clienteDaSessao(c, env, true);
  const rows = await env.DB.prepare(`SELECT p.id,p.chave,p.status,p.etapa,p.total,p.criado_em,l.nome AS loja_nome,l.slug AS loja_slug
    FROM pedidos_online p JOIN lojas_online l ON l.estabelecimento_id=p.estabelecimento_id
    WHERE p.cliente_id=? ORDER BY p.id DESC LIMIT 50`).bind(cliente.id).all();
  return resposta(c, rows.results);
}
