-- Uma aproximação solicitada pela tela web, autorizada por segredo temporário.
CREATE TABLE IF NOT EXISTS nfc_solicitacoes (
  id TEXT PRIMARY KEY,
  estabelecimento_id INTEGER NOT NULL,
  funcionario_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  expira_em TEXT NOT NULL,
  uid TEXT,
  recebido_em TEXT,
  cancelado_em TEXT
);
CREATE INDEX IF NOT EXISTS idx_nfc_solicitacoes_expira ON nfc_solicitacoes(expira_em);
