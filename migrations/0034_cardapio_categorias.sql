-- Categorias do cardápio de delivery. Não são as categorias da rede
-- nem as categorias de impressão do estoque.
CREATE TABLE IF NOT EXISTS cardapio_online_categorias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estabelecimento_id INTEGER NOT NULL,
  nome TEXT NOT NULL,
  ordem INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  criado_em TEXT NOT NULL DEFAULT '',
  atualizado_em TEXT
);

CREATE INDEX IF NOT EXISTS idx_cardapio_online_categorias
  ON cardapio_online_categorias(estabelecimento_id, ativo, ordem, id);

ALTER TABLE cardapio_online_produtos ADD COLUMN cardapio_categoria_id INTEGER;
