import { randomBytes, scryptSync, timingSafeEqual, createHash, randomUUID } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest('hex');
const safeUser = row => row && ({ id: row.id, name: row.name, username: row.username, role: row.role });
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

export class Auth {
  constructor(service, { now = () => new Date(), secureCookie = false } = {}) {
    this.service = service;
    this.db = service.db;
    this.now = now;
    this.secureCookie = secureCookie;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL CHECK(role IN ('support','merchant','driver')),
        password_hash TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS login_attempts (
        key TEXT PRIMARY KEY, count INTEGER NOT NULL, resets_at INTEGER NOT NULL
      );
    `);
    // Equal work for nonexistent usernames and incorrect passwords.
    this.dummyHash = this.hashPassword(randomBytes(24).toString('hex'));
  }

  needsSetup() { return !this.db.prepare('SELECT id FROM users LIMIT 1').get(); }

  hashPassword(password) {
    const salt = randomBytes(16).toString('hex');
    return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
  }

  verifyPassword(password, stored) {
    const [salt, hash] = stored.split(':');
    return timingSafeEqual(Buffer.from(hash, 'hex'), scryptSync(password, salt, 64));
  }

  createAccount(actor, body, setup = false, selfRegistration = false) {
    if (!setup && !selfRegistration && actor?.role !== 'support') fail('Acesso exclusivo do suporte.', 403);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    const password = body.password;
    const role = setup ? 'support' : selfRegistration ? 'driver' : body.role;
    if (!name || name.length > 100) fail('Informe um nome de até 100 caracteres.');
    if (!/^[a-z0-9._@+-]{3,80}$/.test(username)) fail('Usuário deve ter de 3 a 80 caracteres, sem espaços ou acentos.');
    if (typeof password !== 'string' || password.length < 10 || password.length > 128) fail('Use uma senha de 10 a 128 caracteres.');
    if (!setup && !['merchant', 'driver'].includes(role)) fail('Escolha estabelecimento ou entregador.');
    const user = { id: randomUUID(), name, username, role };
    const hash = this.hashPassword(password);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (setup && !this.needsSetup()) fail('A configuração inicial já foi concluída.', 409);
      if (this.db.prepare('SELECT id FROM users WHERE username=?').get(username)) fail('Este usuário já existe.', 409);
      this.db.prepare('INSERT INTO users (id,name,username,role,password_hash,created_at) VALUES (?,?,?,?,?,?)')
        .run(user.id, name, username, role, hash, this.now().toISOString());
      if (role !== 'support') this.service.registerProfile(user, body);
      if (selfRegistration) this.db.prepare('UPDATE delivery_profiles SET approved=0,online=0 WHERE user_id=?').run(user.id);
      this.db.exec('COMMIT');
      return user;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  registerDriver(body, ip) {
    if (this.needsSetup()) fail('A operação ainda não foi configurada pelo suporte.', 503);
    const key = `register:${ip}`;
    const time = this.now().getTime();
    this.db.prepare('DELETE FROM login_attempts WHERE resets_at<=?').run(time);
    if ((this.db.prepare('SELECT count FROM login_attempts WHERE key=?').get(key)?.count || 0) >= 8) fail('Muitos cadastros deste acesso. Tente novamente mais tarde.', 429);
    this.db.prepare(`INSERT INTO login_attempts(key,count,resets_at) VALUES(?,1,?)
      ON CONFLICT(key) DO UPDATE SET count=count+1`).run(key, time + 60 * 60_000);
    return this.createAccount(null, body, false, true);
  }

  accounts(actor) {
    if (actor.role !== 'support') fail('Acesso exclusivo do suporte.', 403);
    return this.db.prepare(`SELECT u.id,u.name,u.username,u.role,p.phone,p.address,p.lat,p.lng,p.online_establishment_id AS onlineEstablishmentId
      FROM users u LEFT JOIN delivery_profiles p ON p.user_id=u.id ORDER BY u.name`).all()
      .map(row => row.role === 'support' ? safeUser(row) : row);
  }

  login(body, ip) {
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase().slice(0, 80) : '';
    const password = body.password;
    const time = this.now().getTime();
    this.db.prepare('DELETE FROM login_attempts WHERE resets_at<=?').run(time);
    const keys = [`ip:${ip}`, `user:${username}`];
    for (const key of keys) {
      const attempt = this.db.prepare('SELECT count FROM login_attempts WHERE key=?').get(key);
      if (attempt?.count >= 15) fail('Muitas tentativas. Aguarde 15 minutos antes de tentar novamente.', 429);
    }
    const user = this.db.prepare('SELECT * FROM users WHERE username=?').get(username);
    const validPassword = typeof password === 'string' && password.length <= 128;
    const valid = this.verifyPassword(validPassword ? password : '', user?.password_hash || this.dummyHash);
    if (!valid || !user || !validPassword) {
      for (const key of keys) this.db.prepare(`INSERT INTO login_attempts (key,count,resets_at) VALUES (?,1,?)
        ON CONFLICT(key) DO UPDATE SET count=count+1`).run(key, time + 15 * 60_000);
      fail('Usuário ou senha incorretos.', 401);
    }
    this.db.prepare('DELETE FROM login_attempts WHERE key=?').run(`user:${username}`);
    return safeUser(user);
  }

  issue(user, res) {
    const token = randomBytes(32).toString('base64url');
    const time = this.now().getTime();
    this.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(time);
    this.db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)')
      .run(digest(token), user.id, time + 8 * 60 * 60_000);
    res.cookie('doixp_entregas', token, { httpOnly: true, sameSite: 'strict', secure: this.secureCookie, path: '/', maxAge: 8 * 60 * 60_000 });
  }

  token(req) {
    const cookie = req.headers.cookie || '';
    return cookie.split(';').map(part => part.trim()).find(part => part.startsWith('doixp_entregas='))?.slice(15) || '';
  }

  authenticate(req) {
    const token = this.token(req);
    if (!/^[\w-]{43}$/.test(token)) return null;
    return safeUser(this.db.prepare(`SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id
      WHERE s.token_hash=? AND s.expires_at>?`).get(digest(token), this.now().getTime()));
  }

  logout(req, res) {
    this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(this.token(req)));
    res.clearCookie('doixp_entregas', { httpOnly: true, sameSite: 'strict', secure: this.secureCookie, path: '/' });
  }
}
