-- Desconto opcional aplicado apenas aos pedidos do delivery.
ALTER TABLE cardapio_online_produtos
  ADD COLUMN preco_promocional REAL CHECK (preco_promocional IS NULL OR preco_promocional >= 0);
