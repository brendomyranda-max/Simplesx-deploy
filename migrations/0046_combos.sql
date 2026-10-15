-- Um combo é um produto vendável cuja composição é escolhida em cada pedido.
ALTER TABLE produtos ADD COLUMN combo_grupos_json TEXT;
ALTER TABLE comanda_itens ADD COLUMN combo_escolhas_json TEXT;
ALTER TABLE pedidos_online_itens ADD COLUMN combo_escolhas_json TEXT;
ALTER TABLE venda_itens ADD COLUMN combo_escolhas_json TEXT;
