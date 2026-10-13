-- Guarda endereços já compartilhados, inclusive os antigos loja-123.
CREATE TABLE lojas_online_links (
  slug TEXT NOT NULL COLLATE NOCASE PRIMARY KEY,
  estabelecimento_id INTEGER NOT NULL,
  criado_em TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_lojas_online_links_loja ON lojas_online_links(estabelecimento_id);
INSERT INTO lojas_online_links (slug, estabelecimento_id, criado_em)
  SELECT slug, estabelecimento_id, criado_em FROM lojas_online;
