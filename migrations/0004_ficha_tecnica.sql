-- ============================================================
-- Ficha técnica (receita): insumos + produtos compostos
-- ============================================================

-- tipo do produto: 'produto' (simples) | 'composto' (ficha técnica) | 'insumo' (matéria-prima)
ALTER TABLE produtos ADD COLUMN tipo TEXT NOT NULL DEFAULT 'produto';

-- Ingredientes de cada produto composto
CREATE TABLE IF NOT EXISTS ficha_tecnica (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER NOT NULL,
  insumo_id INTEGER NOT NULL,
  quantidade REAL NOT NULL DEFAULT 0,
  unidade TEXT NOT NULL DEFAULT 'UN',
  criado_em TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_ficha_produto ON ficha_tecnica(produto_id);
CREATE INDEX IF NOT EXISTS idx_ficha_insumo ON ficha_tecnica(insumo_id);
