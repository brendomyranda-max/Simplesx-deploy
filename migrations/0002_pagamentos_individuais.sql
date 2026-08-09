-- ============================================================
-- SimplesX - Pagamentos Individuais (pré-fechamento)
-- Fluxo: fechar individual -> comanda vai para pré-fechamento
-- e os itens são transferidos para a mesa "Pagamentos Individuais",
-- onde cada pessoa é baixada e impressa separadamente.
-- ============================================================

ALTER TABLE mesas ADD COLUMN tipo TEXT NOT NULL DEFAULT 'normal';

ALTER TABLE comandas ADD COLUMN comanda_origem_id INTEGER;
ALTER TABLE comandas ADD COLUMN pre_fechamento_em TEXT;
ALTER TABLE comandas ADD COLUMN baixada_em TEXT;
ALTER TABLE comandas ADD COLUMN individual_valores TEXT;

ALTER TABLE comanda_pessoas ADD COLUMN status TEXT NOT NULL DEFAULT 'pendente';
ALTER TABLE comanda_pessoas ADD COLUMN baixada_em TEXT;

-- Mesa especial onde os pré-fechamentos individuais são recebidos
INSERT OR IGNORE INTO mesas (numero, nome, capacidade, setor, status, tipo)
VALUES (9999, 'Pagamentos Individuais', 99, 'Pagamentos', 'livre', 'pagamentos');
