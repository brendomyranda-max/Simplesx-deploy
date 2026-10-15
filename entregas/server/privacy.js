import { randomUUID } from 'node:crypto';

const columns = `id,user_id AS userId,username,name,role,note,status,created_at AS createdAt`;
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

export function installPrivacyRoutes(app, auth, service) {
  const db = service.db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_deletion_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      username TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS account_deletion_one_pending_per_user
      ON account_deletion_requests(user_id) WHERE status='pending';
  `);

  const route = handler => (req, res, next) => {
    try { res.json(handler(req, res)); } catch (error) { next(error); }
  };
  const actor = req => {
    const user = auth.authenticate(req);
    if (!user) fail(401, 'Entre na sua conta para continuar.');
    return user;
  };

  app.get('/api/privacy-public', route(() => {
    const contact = (process.env.ENTREGAS_PRIVACY_CONTACT || '').trim();
    const operator = (process.env.ENTREGAS_OPERATOR_NAME || '').trim() || 'DoixP Entregas';
    return { contact, operator, configured: Boolean(contact) };
  }));

  app.get('/api/account-deletion', route(req => {
    const user = actor(req);
    return { requests: db.prepare(`SELECT ${columns} FROM account_deletion_requests
      WHERE user_id=? ORDER BY created_at DESC,rowid DESC`).all(user.id) };
  }));

  app.post('/api/account-deletion', route((req, res) => {
    const user = actor(req);
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Envie os dados da solicitação.');
    if (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 1000)) {
      fail(400, 'A observação deve conter até 1.000 caracteres.');
    }
    const note = (body.note || '').trim();
    const id = randomUUID();
    const createdAt = new Date(service.now()).toISOString();
    // The partial unique index makes simultaneous retries idempotent too.
    const result = db.prepare(`INSERT INTO account_deletion_requests
      (id,user_id,username,name,role,note,status,created_at) VALUES (?,?,?,?,?,?,'pending',?)
      ON CONFLICT(user_id) WHERE status='pending' DO NOTHING`)
      .run(id, user.id, user.username, user.name, user.role, note, createdAt);
    const request = db.prepare(`SELECT ${columns} FROM account_deletion_requests
      WHERE user_id=? AND status='pending'`).get(user.id);
    const created = result.changes > 0;
    res.status(created ? 201 : 200);
    return { request, created };
  }));

  app.get('/api/deletion-requests', route(req => {
    const user = actor(req);
    if (user.role !== 'support') fail(403, 'Acesso exclusivo do suporte.');
    return { requests: db.prepare(`SELECT ${columns} FROM account_deletion_requests
      ORDER BY created_at DESC,rowid DESC`).all() };
  }));
}
