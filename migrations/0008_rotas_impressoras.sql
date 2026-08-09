-- Roteamento de pedidos do restaurante por categoria e fila CUPS.
ALTER TABLE impressora_agentes ADD COLUMN categorias TEXT NOT NULL DEFAULT '[]';
ALTER TABLE impressora_agentes ADD COLUMN imprime_pedidos INTEGER NOT NULL DEFAULT 1;
ALTER TABLE impressora_agentes ADD COLUMN imprime_conta INTEGER NOT NULL DEFAULT 0;
ALTER TABLE impressora_agentes ADD COLUMN largura_mm INTEGER NOT NULL DEFAULT 80;

