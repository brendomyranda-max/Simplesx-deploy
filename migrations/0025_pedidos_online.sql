-- Cardápio público e pedidos de delivery criados pelo site.
-- Produtos continuam pertencendo ao cadastro central: o cardápio online apenas
-- guarda a apresentação e os preços específicos do canal de vendas.

CREATE TABLE IF NOT EXISTS lojas_online (
  estabelecimento_id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL COLLATE NOCASE UNIQUE,
  nome TEXT NOT NULL DEFAULT '',
  descricao TEXT,
  logo_url TEXT,
  capa_url TEXT,
  taxa_entrega REAL NOT NULL DEFAULT 0,
  tempo_min_entrega INTEGER,
  tempo_max_entrega INTEGER,
  aceita_entrega INTEGER NOT NULL DEFAULT 1 CHECK (aceita_entrega IN (0, 1)),
  aceita_retirada INTEGER NOT NULL DEFAULT 1 CHECK (aceita_retirada IN (0, 1)),
  ativo INTEGER NOT NULL DEFAULT 0 CHECK (ativo IN (0, 1)),
  criado_em TEXT NOT NULL DEFAULT '',
  atualizado_em TEXT
);

CREATE TABLE IF NOT EXISTS cardapio_online_produtos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estabelecimento_id INTEGER NOT NULL,
  produto_id INTEGER NOT NULL,
  categoria_id INTEGER,
  nome_exibicao TEXT,
  descricao TEXT,
  foto_url TEXT,
  preco REAL,
  ordem INTEGER NOT NULL DEFAULT 0,
  disponivel INTEGER NOT NULL DEFAULT 1 CHECK (disponivel IN (0, 1)),
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  criado_em TEXT NOT NULL DEFAULT '',
  atualizado_em TEXT,
  UNIQUE (estabelecimento_id, produto_id)
);

CREATE INDEX IF NOT EXISTS idx_cardapio_online_publico
  ON cardapio_online_produtos(estabelecimento_id, ativo, disponivel, ordem, id);

CREATE TABLE IF NOT EXISTS cardapio_online_opcoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estabelecimento_id INTEGER NOT NULL,
  cardapio_produto_id INTEGER NOT NULL,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('removivel', 'adicional')),
  preco_adicional REAL NOT NULL DEFAULT 0,
  ordem INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  criado_em TEXT NOT NULL DEFAULT '',
  atualizado_em TEXT
);

CREATE INDEX IF NOT EXISTS idx_cardapio_online_opcoes
  ON cardapio_online_opcoes(estabelecimento_id, cardapio_produto_id, ativo, ordem, id);

CREATE TABLE IF NOT EXISTS pedidos_online (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estabelecimento_id INTEGER NOT NULL,
  chave TEXT NOT NULL,
  comanda_id INTEGER,
  mesa_id INTEGER,
  cliente_nome TEXT NOT NULL,
  telefone TEXT NOT NULL,
  tipo_entrega TEXT NOT NULL CHECK (tipo_entrega IN ('entrega', 'retirada')),
  endereco TEXT,
  forma_pagamento TEXT NOT NULL,
  troco_para REAL,
  observacao TEXT,
  status TEXT NOT NULL DEFAULT 'recebido' CHECK (status IN ('recebido', 'confirmado', 'cancelado', 'finalizado')),
  subtotal REAL NOT NULL DEFAULT 0,
  taxa_entrega REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT '',
  atualizado_em TEXT,
  UNIQUE (estabelecimento_id, chave),
  UNIQUE (estabelecimento_id, comanda_id)
);

CREATE INDEX IF NOT EXISTS idx_pedidos_online_painel
  ON pedidos_online(estabelecimento_id, status, criado_em DESC);

CREATE TABLE IF NOT EXISTS pedidos_online_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estabelecimento_id INTEGER NOT NULL,
  pedido_online_id INTEGER NOT NULL,
  ordem INTEGER NOT NULL,
  produto_id INTEGER NOT NULL,
  cardapio_produto_id INTEGER NOT NULL,
  nome TEXT NOT NULL,
  quantidade INTEGER NOT NULL,
  preco_unitario REAL NOT NULL,
  observacao TEXT,
  opcoes_json TEXT NOT NULL DEFAULT '[]',
  total REAL NOT NULL,
  criado_em TEXT NOT NULL DEFAULT '',
  UNIQUE (pedido_online_id, ordem)
);

CREATE INDEX IF NOT EXISTS idx_pedidos_online_itens
  ON pedidos_online_itens(estabelecimento_id, pedido_online_id, ordem);
