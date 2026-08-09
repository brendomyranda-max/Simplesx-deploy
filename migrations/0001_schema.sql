-- ============================================================
-- SimplesX - Schema completo
-- Usado pelo Cloudflare D1 e pelo servidor local (node:sqlite)
-- ============================================================

CREATE TABLE IF NOT EXISTS auth_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS empresa_config (
  chave TEXT PRIMARY KEY,
  valor TEXT
);

CREATE TABLE IF NOT EXISTS categorias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL UNIQUE,
  cor TEXT NOT NULL DEFAULT '#6366f1',
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT '' DEFAULT ''
);

CREATE TABLE IF NOT EXISTS fornecedores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  contato TEXT,
  telefone TEXT,
  email TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS produtos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  codigo_interno TEXT,
  unidade TEXT NOT NULL DEFAULT 'UN',
  estoque_atual REAL NOT NULL DEFAULT 0,
  estoque_minimo REAL NOT NULL DEFAULT 0,
  custo REAL NOT NULL DEFAULT 0,
  preco REAL,
  fornecedor_id INTEGER,
  marca TEXT,
  validade_fabricacao_dias INTEGER,
  validade_aberto_dias INTEGER,
  temperatura TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  observacoes TEXT,
  criado_em TEXT NOT NULL DEFAULT '',
  atualizado_em TEXT
);

CREATE TABLE IF NOT EXISTS produto_categorias (
  produto_id INTEGER NOT NULL,
  categoria_id INTEGER NOT NULL,
  PRIMARY KEY (produto_id, categoria_id)
);

CREATE TABLE IF NOT EXISTS produto_codigos_barras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER NOT NULL,
  codigo TEXT NOT NULL UNIQUE,
  principal INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS estoque_movimentacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER NOT NULL,
  tipo TEXT NOT NULL,
  quantidade REAL NOT NULL,
  saldo_apos REAL NOT NULL,
  custo_unitario REAL,
  preco_unitario REAL,
  origem TEXT,
  ref_id INTEGER,
  responsavel TEXT,
  observacoes TEXT,
  criado_em TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS lotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER NOT NULL,
  quantidade REAL NOT NULL,
  custo_unitario REAL NOT NULL DEFAULT 0,
  data_fabricacao TEXT,
  data_validade TEXT,
  temperatura TEXT,
  fornecedor_id INTEGER,
  nota_fiscal TEXT,
  responsavel TEXT,
  criado_em TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS validade_controles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER NOT NULL,
  tipo TEXT NOT NULL,
  quantidade REAL NOT NULL DEFAULT 1,
  data_fabricacao TEXT,
  data_abertura TEXT,
  data_vencimento TEXT NOT NULL,
  temperatura TEXT,
  responsavel TEXT,
  observacoes TEXT,
  status TEXT NOT NULL DEFAULT 'ativo',
  criado_em TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS mesas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero INTEGER NOT NULL UNIQUE,
  nome TEXT,
  capacidade INTEGER NOT NULL DEFAULT 4,
  setor TEXT,
  status TEXT NOT NULL DEFAULT 'livre',
  ativo INTEGER NOT NULL DEFAULT 1,
  aberta_em TEXT,
  criado_em TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS comandas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mesa_id INTEGER NOT NULL,
  cliente_nome TEXT,
  garcom_nome TEXT,
  status TEXT NOT NULL DEFAULT 'aberta',
  taxa_garcom_pct REAL NOT NULL DEFAULT 0,
  fechamento_tipo TEXT,
  pessoas_count INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT '',
  fechada_em TEXT
);

CREATE TABLE IF NOT EXISTS comanda_pessoas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comanda_id INTEGER NOT NULL,
  nome TEXT,
  cor TEXT NOT NULL DEFAULT '#6366f1',
  criado_em TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS comanda_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comanda_id INTEGER NOT NULL,
  pessoa_id INTEGER,
  produto_id INTEGER,
  nome TEXT NOT NULL,
  quantidade REAL NOT NULL DEFAULT 1,
  preco_unitario REAL NOT NULL DEFAULT 0,
  observacao TEXT,
  status TEXT NOT NULL DEFAULT 'novo',
  enviado_em TEXT,
  responsavel TEXT,
  criado_em TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS vendas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero TEXT NOT NULL,
  tipo TEXT NOT NULL,
  comanda_id INTEGER,
  mesa_id INTEGER,
  subtotal REAL NOT NULL DEFAULT 0,
  desconto REAL NOT NULL DEFAULT 0,
  taxa_servico REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'concluida',
  funcionario TEXT,
  responsavel TEXT,
  observacoes TEXT,
  criado_em TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS venda_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venda_id INTEGER NOT NULL,
  produto_id INTEGER,
  nome TEXT NOT NULL,
  quantidade REAL NOT NULL DEFAULT 1,
  custo_unitario REAL NOT NULL DEFAULT 0,
  preco_unitario REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pagamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venda_id INTEGER NOT NULL,
  forma TEXT NOT NULL,
  valor REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS perdas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER,
  quantidade REAL NOT NULL,
  valor_unitario REAL NOT NULL DEFAULT 0,
  motivo TEXT NOT NULL,
  origem TEXT NOT NULL DEFAULT 'outro',
  comanda_id INTEGER,
  item_id INTEGER,
  responsavel TEXT,
  criado_em TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS despesas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  descricao TEXT NOT NULL,
  categoria TEXT,
  valor REAL NOT NULL,
  data TEXT NOT NULL,
  forma_pagamento TEXT,
  funcionario TEXT,
  criado_em TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS contas_pagar (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  descricao TEXT NOT NULL,
  fornecedor TEXT,
  valor REAL NOT NULL,
  data_vencimento TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  paga_em TEXT,
  criado_em TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS contas_receber (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  descricao TEXT NOT NULL,
  cliente TEXT,
  valor REAL NOT NULL,
  data_vencimento TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  recebido_em TEXT,
  criado_em TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS lancamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,
  tipo TEXT NOT NULL,
  categoria TEXT,
  descricao TEXT NOT NULL,
  valor REAL NOT NULL,
  metodo TEXT,
  ref_tipo TEXT,
  ref_id INTEGER,
  criado_em TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS caixa (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,
  tipo TEXT NOT NULL,
  valor REAL NOT NULL,
  metodo TEXT,
  observacao TEXT,
  funcionario TEXT,
  criado_em TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS funcionarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  usuario TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  perfil TEXT NOT NULL DEFAULT 'caixa',
  pin TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS funcionario_permissoes (
  funcionario_id INTEGER NOT NULL,
  modulo TEXT NOT NULL,
  acao TEXT NOT NULL DEFAULT 'visualizar',
  PRIMARY KEY (funcionario_id, modulo, acao)
);

CREATE TABLE IF NOT EXISTS setores_impressao (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  padrao_impressora TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS impressora_agentes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  ip TEXT NOT NULL,
  porta INTEGER NOT NULL DEFAULT 9100,
  tipo TEXT NOT NULL DEFAULT 'impressora',
  protocolo TEXT NOT NULL DEFAULT 'raw',
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS impressora_etiquetas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  largura_mm REAL NOT NULL DEFAULT 58,
  altura_mm REAL NOT NULL DEFAULT 40,
  margem_mm REAL NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS produto_comentarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER NOT NULL,
  texto TEXT NOT NULL,
  ordem INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_prod_barcode ON produto_codigos_barras(codigo);
CREATE INDEX IF NOT EXISTS idx_prod_interno ON produtos(codigo_interno);
CREATE INDEX IF NOT EXISTS idx_prod_comentarios ON produto_comentarios(produto_id);
CREATE INDEX IF NOT EXISTS idx_mov_produto ON estoque_movimentacoes(produto_id, criado_em);
CREATE INDEX IF NOT EXISTS idx_lotes_validade ON lotes(data_validade);
CREATE INDEX IF NOT EXISTS idx_validade_venc ON validade_controles(data_vencimento);
CREATE INDEX IF NOT EXISTS idx_comanda_mesa ON comandas(mesa_id, status);
CREATE INDEX IF NOT EXISTS idx_item_comanda ON comanda_itens(comanda_id, status);
CREATE INDEX IF NOT EXISTS idx_venda_data ON vendas(criado_em);
CREATE INDEX IF NOT EXISTS idx_lancamento_data ON lancamentos(data);
CREATE INDEX IF NOT EXISTS idx_perda_data ON perdas(criado_em);

-- ============================================================
-- Dados iniciais
-- ============================================================

INSERT OR IGNORE INTO empresa_config (chave, valor) VALUES
  ('modo_operacao', 'mercado'),
  ('taxa_garcom_pct', '10'),
  ('perda_timeout_min', '2'),
  ('empresa_nome', 'Meu Negócio'),
  ('impressora_etiqueta_id', '1'),
  ('dias_vencimento_aviso', '7');

INSERT OR IGNORE INTO mesas (numero, nome, capacidade, setor, status) VALUES
  (1, 'Mesa 1', 4, 'Salão', 'livre'),
  (2, 'Mesa 2', 4, 'Salão', 'livre'),
  (3, 'Mesa 3', 2, 'Salão', 'livre'),
  (4, 'Mesa 4', 6, 'Salão', 'livre'),
  (5, 'Mesa 5', 4, 'Terraço', 'livre'),
  (6, 'Mesa 6', 8, 'Terraço', 'livre'),
  (7, 'Balcão 1', 1, 'Balcão', 'livre'),
  (8, 'Balcão 2', 1, 'Balcão', 'livre'),
  (9, 'Balcão 3', 1, 'Balcão', 'livre'),
  (10, 'Balcão 4', 1, 'Balcão', 'livre');

INSERT OR IGNORE INTO categorias (nome, cor) VALUES
  ('Bebidas', '#0ea5e9'),
  ('Mercearia', '#f59e0b'),
  ('Hortifruti', '#22c55e'),
  ('Frios e Laticínios', '#8b5cf6'),
  ('Açougue', '#ef4444'),
  ('Padaria', '#d97706'),
  ('Limpeza', '#06b6d4'),
  ('Higiene', '#ec4899');

INSERT OR IGNORE INTO setores_impressao (nome) VALUES
  ('Cozinha'),
  ('Bar'),
  ('Salão'),
  ('Padaria'),
  ('Etiquetas');

INSERT OR IGNORE INTO impressora_etiquetas (nome, largura_mm, altura_mm) VALUES
  ('Etiqueta 58x40', 58, 40),
  ('Etiqueta 50x30', 50, 30),
  ('Etiqueta 62x52', 62, 52);

INSERT OR IGNORE INTO impressora_agentes (nome, ip, porta, tipo, protocolo) VALUES
  ('Impressora Cozinha', '192.168.0.10', 9100, 'impressora', 'raw'),
  ('Impressora Bar', '192.168.0.11', 9100, 'impressora', 'raw'),
  ('Agente Salão', '192.168.0.20', 7000, 'agente', 'http');

INSERT OR IGNORE INTO funcionarios (nome, usuario, senha_hash, perfil) VALUES
  ('Administrador', 'admin', 'admin', 'admin');
