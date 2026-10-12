-- Uma espera pertence a um servidor e a uma tela. Não disputa a fila geral.
ALTER TABLE nfc_solicitacoes ADD COLUMN servidor_tipo TEXT;
ALTER TABLE nfc_solicitacoes ADD COLUMN servidor_id TEXT;
ALTER TABLE nfc_solicitacoes ADD COLUMN payload TEXT NOT NULL DEFAULT '';
ALTER TABLE nfc_solicitacoes ADD COLUMN evento_id INTEGER;
ALTER TABLE nfc_solicitacoes ADD COLUMN entregue_em TEXT;
CREATE INDEX idx_nfc_solicitacoes_servidor ON nfc_solicitacoes(estabelecimento_id, servidor_tipo, servidor_id, expira_em);
ALTER TABLE nfc_eventos ADD COLUMN servidor_tipo TEXT;
ALTER TABLE nfc_eventos ADD COLUMN servidor_id TEXT;
