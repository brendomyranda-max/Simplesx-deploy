-- Uma intenção corresponde a uma única transferência, mesmo após timeout.
CREATE TABLE comanda_mesa_transferencias (
  id TEXT PRIMARY KEY,
  estabelecimento_id INTEGER NOT NULL,
  chave TEXT NOT NULL,
  conteudo_hash TEXT NOT NULL,
  comanda_origem_id INTEGER NOT NULL,
  mesa_destino_id INTEGER NOT NULL,
  comanda_destino_id INTEGER,
  abriu_comanda INTEGER NOT NULL DEFAULT 0,
  liberou_origem INTEGER NOT NULL DEFAULT 0,
  itens_count INTEGER NOT NULL,
  pessoa_base_id INTEGER NOT NULL,
  pessoas_json TEXT NOT NULL,
  funcionario_id INTEGER NOT NULL,
  criado_em TEXT NOT NULL,
  UNIQUE (estabelecimento_id, chave)
);
CREATE INDEX idx_mesa_transferencias_origem ON comanda_mesa_transferencias(estabelecimento_id, comanda_origem_id);

-- A exclusão lógica e uma abertura concorrente não podem ocultar uma conta.
CREATE TRIGGER comandas_mesa_ativa_insert BEFORE INSERT ON comandas
WHEN NEW.status IN ('aberta','pre_fechamento') AND EXISTS (
  SELECT 1 FROM mesas WHERE id=NEW.mesa_id AND estabelecimento_id=NEW.estabelecimento_id AND ativo=0
)
BEGIN
  SELECT RAISE(ABORT, 'mesa_inativa');
END;
CREATE TRIGGER comandas_mesa_ativa_update BEFORE UPDATE OF status, mesa_id ON comandas
WHEN NEW.status IN ('aberta','pre_fechamento') AND EXISTS (
  SELECT 1 FROM mesas WHERE id=NEW.mesa_id AND estabelecimento_id=NEW.estabelecimento_id AND ativo=0
)
BEGIN
  SELECT RAISE(ABORT, 'mesa_inativa');
END;
