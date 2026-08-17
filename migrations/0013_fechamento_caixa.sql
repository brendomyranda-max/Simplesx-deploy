CREATE TABLE IF NOT EXISTS fechamentos_caixa (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,
  vendas_mercado INTEGER NOT NULL DEFAULT 0,
  total_mercado REAL NOT NULL DEFAULT 0,
  vendas_restaurante INTEGER NOT NULL DEFAULT 0,
  total_restaurante REAL NOT NULL DEFAULT 0,
  vendas_canceladas INTEGER NOT NULL DEFAULT 0,
  entradas REAL NOT NULL DEFAULT 0,
  saidas REAL NOT NULL DEFAULT 0,
  total_esperado REAL NOT NULL DEFAULT 0,
  total_informado REAL NOT NULL DEFAULT 0,
  diferenca REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'conferido',
  justificativa TEXT,
  responsavel TEXT,
  criado_em TEXT NOT NULL DEFAULT '',
  estabelecimento_id INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS fechamento_caixa_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fechamento_id INTEGER NOT NULL,
  forma TEXT NOT NULL,
  esperado REAL NOT NULL DEFAULT 0,
  informado REAL NOT NULL DEFAULT 0,
  diferenca REAL NOT NULL DEFAULT 0,
  estabelecimento_id INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_fechamento_caixa_data ON fechamentos_caixa(estabelecimento_id, data);
CREATE INDEX IF NOT EXISTS idx_fechamento_caixa_itens ON fechamento_caixa_itens(estabelecimento_id, fechamento_id);
