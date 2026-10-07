-- Sem vencimento na embalagem fechada; o prazo após abertura é independente.
ALTER TABLE produtos ADD COLUMN sem_vencimento INTEGER NOT NULL DEFAULT 0 CHECK (sem_vencimento IN (0, 1));
