-- Opt-in da loja e dados mínimos para encaminhar um pedido pago ao app de motoboys.
-- O código de entrega é cifrado pela aplicação antes de chegar a esta coluna.
ALTER TABLE lojas_online ADD COLUMN entrega_plataforma_ativo INTEGER NOT NULL DEFAULT 0 CHECK(entrega_plataforma_ativo IN (0,1));

ALTER TABLE pedidos_online ADD COLUMN entrega_plataforma INTEGER NOT NULL DEFAULT 0 CHECK(entrega_plataforma IN (0,1));
ALTER TABLE pedidos_online ADD COLUMN entrega_codigo_cifrado TEXT;
ALTER TABLE pedidos_online ADD COLUMN entrega_destino_lat REAL;
ALTER TABLE pedidos_online ADD COLUMN entrega_destino_lng REAL;
ALTER TABLE pedidos_online ADD COLUMN entrega_distancia_precisa REAL;
ALTER TABLE pedidos_online ADD COLUMN entrega_subsidio TEXT;
ALTER TABLE pedidos_online ADD COLUMN entrega_frete_centavos INTEGER;
ALTER TABLE pedidos_online ADD COLUMN entrega_despacho_status TEXT;
ALTER TABLE pedidos_online ADD COLUMN entrega_externa_id TEXT;
CREATE INDEX IF NOT EXISTS idx_pedidos_online_entrega_pendente
  ON pedidos_online(estabelecimento_id, entrega_despacho_status, id);
