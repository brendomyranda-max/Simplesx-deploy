-- Cada estabelecimento escolhe se aparece na vitrine DoixP Delivery
-- ou se usa somente o próprio link de cardápio digital.

ALTER TABLE lojas_online ADD COLUMN modo_publicacao TEXT NOT NULL DEFAULT 'marketplace'
  CHECK (modo_publicacao IN ('marketplace', 'cardapio'));

CREATE INDEX IF NOT EXISTS idx_lojas_online_publicacao
  ON lojas_online (ativo, modo_publicacao);
