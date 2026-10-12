-- Cancelar a ocupação não apaga nem estorna vendas já registradas.
-- Algumas instalações já receberam a estrutura antes do registro da migração.
CREATE TABLE IF NOT EXISTS comanda_cancelamentos (
  id TEXT PRIMARY KEY,
  estabelecimento_id INTEGER NOT NULL,
  chave TEXT NOT NULL,
  conteudo_hash TEXT NOT NULL,
  comanda_id INTEGER NOT NULL,
  mesa_id INTEGER NOT NULL,
  itens_json TEXT NOT NULL,
  vendas_json TEXT NOT NULL,
  motivo TEXT NOT NULL,
  funcionario_id INTEGER NOT NULL,
  criado_em TEXT NOT NULL,
  UNIQUE (estabelecimento_id, chave)
);
CREATE INDEX IF NOT EXISTS idx_cancelamentos_comanda ON comanda_cancelamentos(estabelecimento_id, comanda_id);
