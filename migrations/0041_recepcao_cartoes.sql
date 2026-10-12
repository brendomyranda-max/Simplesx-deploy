CREATE TABLE cartao_atendimentos (
  id TEXT PRIMARY KEY,
  estabelecimento_id INTEGER NOT NULL,
  chave TEXT NOT NULL,
  conteudo_hash TEXT NOT NULL,
  cartao TEXT NOT NULL,
  mesa_id INTEGER NOT NULL,
  comanda_id INTEGER NOT NULL,
  pessoa_id INTEGER NOT NULL,
  cliente_nome TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  encerrado_em TEXT,
  venda_id INTEGER,
  UNIQUE(estabelecimento_id,chave)
);
CREATE UNIQUE INDEX cartao_atendimento_ativo ON cartao_atendimentos(estabelecimento_id,cartao) WHERE encerrado_em IS NULL;
CREATE UNIQUE INDEX cartao_pessoa_ativa ON cartao_atendimentos(estabelecimento_id,pessoa_id) WHERE encerrado_em IS NULL;
CREATE INDEX cartao_comanda ON cartao_atendimentos(estabelecimento_id,comanda_id);

-- A recepção e a abertura manual compartilham uma única conta ativa por mesa.
CREATE TRIGGER comanda_salao_unica_insert BEFORE INSERT ON comandas
WHEN NEW.status IN ('aberta','pre_fechamento') AND NEW.comanda_origem_id IS NULL
  AND EXISTS (SELECT 1 FROM mesas WHERE id=NEW.mesa_id AND estabelecimento_id=NEW.estabelecimento_id AND tipo='normal')
  AND EXISTS (SELECT 1 FROM comandas WHERE mesa_id=NEW.mesa_id AND estabelecimento_id=NEW.estabelecimento_id
    AND status IN ('aberta','pre_fechamento') AND comanda_origem_id IS NULL)
BEGIN
  SELECT RAISE(ABORT,'mesa_ja_ocupada');
END;

-- Todas as formas de encerrar a conta liberam o cartão na mesma transação.
CREATE TRIGGER cartao_comanda_encerrada AFTER UPDATE OF status ON comandas
WHEN NEW.status='fechada'
BEGIN
  UPDATE cartao_atendimentos SET encerrado_em=COALESCE(NEW.fechada_em,NEW.baixada_em,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  WHERE comanda_id=NEW.id AND estabelecimento_id=NEW.estabelecimento_id AND encerrado_em IS NULL;
END;
CREATE TRIGGER cartao_pessoa_baixada AFTER UPDATE OF status ON comanda_pessoas
WHEN NEW.status='baixado'
BEGIN
  UPDATE cartao_atendimentos SET encerrado_em=COALESCE(NEW.baixada_em,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  WHERE pessoa_id=NEW.id AND estabelecimento_id=NEW.estabelecimento_id AND encerrado_em IS NULL;
END;
CREATE TRIGGER cartao_pessoa_protegida BEFORE DELETE ON comanda_pessoas
WHEN EXISTS (SELECT 1 FROM cartao_atendimentos WHERE pessoa_id=OLD.id AND estabelecimento_id=OLD.estabelecimento_id AND encerrado_em IS NULL)
BEGIN
  SELECT RAISE(ABORT,'cartao_em_atendimento');
END;
