-- Categoria da loja na rede de pedidos. Cada estabelecimento cria a sua
-- (hambúrgueres, pizzaria, comida japonesa). O marketplace agrupa pelo nome.

CREATE TABLE IF NOT EXISTS lojas_categorias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estabelecimento_id INTEGER NOT NULL,
  nome TEXT NOT NULL,
  nome_busca TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT '',
  UNIQUE (estabelecimento_id, nome_busca)
);

CREATE INDEX IF NOT EXISTS idx_lojas_categorias_busca
  ON lojas_categorias(nome_busca, estabelecimento_id);
