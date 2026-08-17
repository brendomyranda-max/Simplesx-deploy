-- Auditoria das alterações feitas depois do pré-fechamento do PDV Mercado.
CREATE TABLE IF NOT EXISTS venda_ajustes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venda_id INTEGER NOT NULL,
  produto_id INTEGER,
  item_id INTEGER,
  tipo TEXT NOT NULL,
  quantidade REAL NOT NULL DEFAULT 0,
  justificativa TEXT NOT NULL,
  responsavel TEXT,
  criado_em TEXT NOT NULL DEFAULT '',
  estabelecimento_id INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_venda_ajustes_venda ON venda_ajustes(estabelecimento_id, venda_id);
