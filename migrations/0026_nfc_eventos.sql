-- Leituras NFC publicadas pelo Gestor e consumidas por um terminal do mesmo estabelecimento.
CREATE TABLE IF NOT EXISTS nfc_eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estabelecimento_id INTEGER NOT NULL,
  origem TEXT NOT NULL,
  leitor TEXT NOT NULL DEFAULT '',
  uid TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL,
  consumido_em TEXT,
  consumido_por TEXT
);

CREATE INDEX IF NOT EXISTS idx_nfc_eventos_pendentes
  ON nfc_eventos (estabelecimento_id, consumido_em, criado_em, id);
