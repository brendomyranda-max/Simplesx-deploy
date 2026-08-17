ALTER TABLE produtos ADD COLUMN data_fabricacao TEXT;
ALTER TABLE produtos ADD COLUMN data_vencimento TEXT;

CREATE INDEX IF NOT EXISTS idx_produtos_vencimento ON produtos(estabelecimento_id, data_vencimento);
