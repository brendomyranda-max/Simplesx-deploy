-- Um comprovante do InfiniteTap não pode ser associado a duas comandas.
CREATE UNIQUE INDEX IF NOT EXISTS idx_infinitepay_tap_nsu_unico
  ON infinitepay_tap_tentativas(estabelecimento_id, nsu)
  WHERE nsu IS NOT NULL;
