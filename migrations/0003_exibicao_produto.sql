-- Produto pode ser exibido no lançamento do Restaurante e/ou do PDV (mercado).
-- Padrão: ambos ativos, para não alterar o comportamento dos produtos existentes.
ALTER TABLE produtos ADD COLUMN exibir_restaurante INTEGER NOT NULL DEFAULT 1;
ALTER TABLE produtos ADD COLUMN exibir_mercado INTEGER NOT NULL DEFAULT 1;
