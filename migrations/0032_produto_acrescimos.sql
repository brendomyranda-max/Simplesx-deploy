-- Acréscimo opcional de um insumo, com valor, no produto composto.
-- No delivery o mesmo acréscimo fica na opção do cardápio, ligada ao insumo.

CREATE TABLE IF NOT EXISTS produto_acrescimos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER NOT NULL,
  insumo_id INTEGER NOT NULL,
  valor REAL NOT NULL,
  ordem INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT '',
  estabelecimento_id INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_produto_acrescimos
  ON produto_acrescimos(produto_id, ordem, id);

ALTER TABLE cardapio_online_opcoes ADD COLUMN insumo_id INTEGER;
