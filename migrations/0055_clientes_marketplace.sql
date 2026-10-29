-- A conta do comprador é global ao marketplace e independente dos lojistas.
CREATE TABLE clientes_marketplace (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  telefone TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  endereco TEXT NOT NULL DEFAULT '',
  numero TEXT NOT NULL DEFAULT '',
  complemento TEXT NOT NULL DEFAULT '',
  latitude REAL,
  longitude REAL,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE TABLE clientes_sessoes (
  token_hash TEXT PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes_marketplace(id) ON DELETE CASCADE,
  expira_em TEXT NOT NULL,
  criado_em TEXT NOT NULL
);
CREATE INDEX idx_clientes_sessoes_expira ON clientes_sessoes(expira_em);
CREATE TABLE clientes_login_tentativas (
  chave TEXT PRIMARY KEY,
  tentativas INTEGER NOT NULL DEFAULT 0,
  expira_em INTEGER NOT NULL
);
ALTER TABLE pedidos_online ADD COLUMN cliente_id INTEGER REFERENCES clientes_marketplace(id);
CREATE INDEX idx_pedidos_online_cliente ON pedidos_online(cliente_id, id DESC);
