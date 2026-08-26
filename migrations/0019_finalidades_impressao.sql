-- Destinos independentes para cupons do PDV e etiquetas de validade.
ALTER TABLE impressora_agentes ADD COLUMN imprime_venda INTEGER NOT NULL DEFAULT 0;
ALTER TABLE impressora_agentes ADD COLUMN imprime_validade INTEGER NOT NULL DEFAULT 0;
