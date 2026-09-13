-- Produtos vendidos por peso/volume variável, identificado pela etiqueta EAN-13 da balança.
-- Formato inicial: 2 + PLU (6 dígitos) + quantidade em g/ml (5 dígitos) + dígito verificador.
ALTER TABLE produtos ADD COLUMN produto_balanca INTEGER NOT NULL DEFAULT 0;
ALTER TABLE produtos ADD COLUMN balanca_plu TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_prod_balanca_plu
  ON produtos(estabelecimento_id, balanca_plu)
  WHERE produto_balanca = 1 AND balanca_plu IS NOT NULL;
