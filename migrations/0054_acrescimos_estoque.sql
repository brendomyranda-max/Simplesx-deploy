-- Preserva os produtos adicionais escolhidos até a baixa de estoque.
ALTER TABLE comanda_itens ADD COLUMN acrescimos_json TEXT;
ALTER TABLE pedidos_online_itens ADD COLUMN acrescimos_json TEXT;
