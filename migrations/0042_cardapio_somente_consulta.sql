-- O cardápio pode continuar publicado sem receber pedidos pelo site.
-- Lojas existentes mantêm o recebimento de pedidos e a visibilidade escolhida.
ALTER TABLE lojas_online ADD COLUMN aceita_pedidos_online INTEGER NOT NULL DEFAULT 1
  CHECK (aceita_pedidos_online IN (0, 1));
