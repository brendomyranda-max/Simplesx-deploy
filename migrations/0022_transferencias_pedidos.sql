-- Evita que duas telas movam o mesmo lançamento com dados desatualizados.
ALTER TABLE comanda_itens ADD COLUMN versao INTEGER NOT NULL DEFAULT 0;
ALTER TABLE comandas ADD COLUMN fechamento_bloqueado_ate TEXT;

CREATE TRIGGER comanda_itens_versao
AFTER UPDATE OF comanda_id, pessoa_id, quantidade, preco_unitario, observacao, status ON comanda_itens
WHEN NEW.versao = OLD.versao
BEGIN
  UPDATE comanda_itens SET versao=OLD.versao+1 WHERE id=NEW.id;
END;

CREATE TABLE comanda_item_transferencias (
  id TEXT PRIMARY KEY,
  estabelecimento_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  comanda_origem_id INTEGER NOT NULL,
  pessoa_origem_id INTEGER,
  mesa_destino_id INTEGER NOT NULL,
  comanda_destino_id INTEGER,
  pessoa_destino_id INTEGER,
  abriu_comanda INTEGER NOT NULL DEFAULT 0,
  quantidade REAL NOT NULL,
  preco_unitario REAL NOT NULL,
  status_item TEXT NOT NULL,
  funcionario_id INTEGER NOT NULL,
  criado_em TEXT NOT NULL
);

CREATE INDEX idx_item_transferencias ON comanda_item_transferencias(estabelecimento_id, item_id, criado_em);
