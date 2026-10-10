-- Modo de cobrança da entrega. O valor nasce dos km vezes o preço da loja.
-- O cliente paga tudo, metade, ou nada quando a loja oferece entrega grátis.

ALTER TABLE lojas_online ADD COLUMN valor_por_km REAL;
ALTER TABLE lojas_online ADD COLUMN modo_entrega TEXT NOT NULL DEFAULT 'cliente';

ALTER TABLE pedidos_online ADD COLUMN valor_entrega REAL;
ALTER TABLE pedidos_online ADD COLUMN distancia_km REAL;
ALTER TABLE pedidos_online ADD COLUMN modo_entrega TEXT;
