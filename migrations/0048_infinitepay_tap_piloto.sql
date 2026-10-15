-- Tentativas do InfiniteTap na conta piloto. O retorno do deeplink não comprova
-- liquidação: a baixa financeira continua dependente da conferência do operador.
CREATE TABLE IF NOT EXISTS infinitepay_tap_tentativas (
  id TEXT PRIMARY KEY,
  estabelecimento_id INTEGER NOT NULL,
  comanda_id INTEGER NOT NULL,
  valor_centavos INTEGER NOT NULL,
  taxa_pct REAL NOT NULL,
  metodo TEXT NOT NULL CHECK (metodo IN ('credit','debit')),
  parcelas INTEGER NOT NULL,
  handle TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('iniciada','retornou','falhou','descartada')),
  nsu TEXT,
  autorizacao TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_infinitepay_tap_comanda
  ON infinitepay_tap_tentativas(estabelecimento_id, comanda_id, criado_em DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_infinitepay_tap_ativa
  ON infinitepay_tap_tentativas(estabelecimento_id, comanda_id)
  WHERE status IN ('iniciada','retornou');
