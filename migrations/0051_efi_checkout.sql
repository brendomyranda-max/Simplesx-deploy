-- Referência da cobrança Efí associada ao checkout online do pedido.
ALTER TABLE pedidos_online ADD COLUMN checkout_charge_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_online_efi_charge
  ON pedidos_online(checkout_charge_id)
  WHERE checkout_charge_id IS NOT NULL;

-- Remove a InfiniteTag e a ativação do checkout antigo das configurações.
DELETE FROM empresa_config
  WHERE chave IN ('infinitepay_handle', 'infinitepay_checkout_ativo');
