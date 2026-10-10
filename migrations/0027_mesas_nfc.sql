ALTER TABLE mesas ADD COLUMN nfc_uid TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mesas_nfc_uid
  ON mesas (estabelecimento_id, nfc_uid)
  WHERE nfc_uid IS NOT NULL AND nfc_uid != '';
