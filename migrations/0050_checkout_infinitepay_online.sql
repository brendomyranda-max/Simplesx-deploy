-- Dados de checkout online do pedido. A URL fica associada ao pedido; os
-- parâmetros de retorno são validados pela API InfinitePay no backend.
ALTER TABLE pedidos_online ADD COLUMN checkout_url TEXT;
ALTER TABLE pedidos_online ADD COLUMN checkout_slug TEXT;
ALTER TABLE pedidos_online ADD COLUMN checkout_transaction_nsu TEXT;
ALTER TABLE pedidos_online ADD COLUMN checkout_capture_method TEXT;
ALTER TABLE pedidos_online ADD COLUMN checkout_pago_em TEXT;
