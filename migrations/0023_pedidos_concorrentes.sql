-- O lançamento e sua fila são persistidos antes de confirmar ao dispositivo.
CREATE TABLE comanda_lancamentos (
  id TEXT PRIMARY KEY,
  estabelecimento_id INTEGER NOT NULL,
  chave TEXT NOT NULL,
  conteudo_hash TEXT NOT NULL,
  comanda_id INTEGER NOT NULL,
  funcionario_id INTEGER NOT NULL,
  criado_em TEXT NOT NULL,
  UNIQUE(estabelecimento_id, chave)
);
ALTER TABLE comanda_itens ADD COLUMN lancamento_id TEXT;
ALTER TABLE comanda_itens ADD COLUMN funcionario_id INTEGER;
CREATE INDEX idx_itens_lancamento ON comanda_itens(estabelecimento_id, lancamento_id);

CREATE TABLE pedido_impressoes (
  estabelecimento_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  impressora_id INTEGER NOT NULL,
  lote_id TEXT NOT NULL,
  conteudo_item TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  PRIMARY KEY(estabelecimento_id, item_id, impressora_id)
);
CREATE INDEX idx_pedido_impressao_lote ON pedido_impressoes(lote_id);
ALTER TABLE gestor_jobs ADD COLUMN pedido_lote_id TEXT;
ALTER TABLE gestor_jobs ADD COLUMN lease_id TEXT;
CREATE UNIQUE INDEX idx_gestor_pedido_lote ON gestor_jobs(pedido_lote_id) WHERE pedido_lote_id IS NOT NULL;
