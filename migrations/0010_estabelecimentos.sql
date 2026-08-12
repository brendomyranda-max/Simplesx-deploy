-- Reinicialização multiestabelecimento. Os dados anteriores eram de teste.
DELETE FROM gestor_jobs;
DELETE FROM gestores;
DELETE FROM pagamentos;
DELETE FROM venda_itens;
DELETE FROM vendas;
DELETE FROM comanda_itens;
DELETE FROM comanda_pessoas;
DELETE FROM comandas;
DELETE FROM mesas;
DELETE FROM perdas;
DELETE FROM validade_controles;
DELETE FROM estoque_movimentacoes;
DELETE FROM lotes;
DELETE FROM ficha_tecnica;
DELETE FROM produto_comentarios;
DELETE FROM produto_codigos_barras;
DELETE FROM produto_categorias;
DELETE FROM produtos;
DELETE FROM categorias;
DELETE FROM fornecedores;
DELETE FROM despesas;
DELETE FROM contas_pagar;
DELETE FROM contas_receber;
DELETE FROM lancamentos;
DELETE FROM caixa;
DELETE FROM funcionario_permissoes;
DELETE FROM funcionarios;
DELETE FROM setores_impressao;
DELETE FROM impressora_agentes;
DELETE FROM impressora_etiquetas;
DELETE FROM auth_tokens;

CREATE TABLE IF NOT EXISTS estabelecimentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT ''
);

DROP TABLE empresa_config;
CREATE TABLE empresa_config (
  estabelecimento_id INTEGER NOT NULL,
  chave TEXT NOT NULL,
  valor TEXT,
  PRIMARY KEY (estabelecimento_id, chave)
);

DROP TABLE auth_tokens;
CREATE TABLE auth_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estabelecimento_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sessoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estabelecimento_id INTEGER NOT NULL,
  funcionario_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expira_em TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT ''
);

DROP TABLE categorias;
CREATE TABLE categorias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estabelecimento_id INTEGER NOT NULL,
  nome TEXT NOT NULL,
  cor TEXT NOT NULL DEFAULT '#6366f1',
  ativo INTEGER NOT NULL DEFAULT 1,
  categoria_pai_id INTEGER,
  impressora_agente_id INTEGER,
  criado_em TEXT NOT NULL DEFAULT '',
  UNIQUE (estabelecimento_id, nome)
);
ALTER TABLE fornecedores ADD COLUMN estabelecimento_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE produtos ADD COLUMN estabelecimento_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE produto_categorias ADD COLUMN estabelecimento_id INTEGER NOT NULL DEFAULT 0;
DROP TABLE produto_codigos_barras;
CREATE TABLE produto_codigos_barras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estabelecimento_id INTEGER NOT NULL,
  produto_id INTEGER NOT NULL,
  codigo TEXT NOT NULL,
  principal INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT '',
  UNIQUE (estabelecimento_id, codigo)
);
ALTER TABLE produto_comentarios ADD COLUMN estabelecimento_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ficha_tecnica ADD COLUMN estabelecimento_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE estoque_movimentacoes ADD COLUMN estabelecimento_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lotes ADD COLUMN estabelecimento_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE validade_controles ADD COLUMN estabelecimento_id INTEGER NOT NULL DEFAULT 0;
DROP TABLE mesas;
CREATE TABLE mesas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estabelecimento_id INTEGER NOT NULL,
  numero INTEGER NOT NULL,
  nome TEXT,
  capacidade INTEGER NOT NULL DEFAULT 4,
  setor TEXT,
  status TEXT NOT NULL DEFAULT 'livre',
  ativo INTEGER NOT NULL DEFAULT 1,
  aberta_em TEXT,
  criado_em TEXT NOT NULL DEFAULT '',
  tipo TEXT NOT NULL DEFAULT 'normal',
  UNIQUE (estabelecimento_id, numero)
);
ALTER TABLE comandas ADD COLUMN estabelecimento_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE comanda_pessoas ADD COLUMN estabelecimento_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE comanda_itens ADD COLUMN estabelecimento_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vendas ADD COLUMN estabelecimento_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE venda_itens ADD COLUMN estabelecimento_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pagamentos ADD COLUMN estabelecimento_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE perdas ADD COLUMN estabelecimento_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE despesas ADD COLUMN estabelecimento_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contas_pagar ADD COLUMN estabelecimento_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contas_receber ADD COLUMN estabelecimento_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lancamentos ADD COLUMN estabelecimento_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE caixa ADD COLUMN estabelecimento_id INTEGER NOT NULL DEFAULT 0;
DROP TABLE funcionarios;
CREATE TABLE funcionarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estabelecimento_id INTEGER NOT NULL,
  nome TEXT NOT NULL,
  usuario TEXT NOT NULL,
  senha_hash TEXT NOT NULL,
  perfil TEXT NOT NULL DEFAULT 'caixa',
  pin TEXT,
  modulos TEXT NOT NULL DEFAULT 'restaurante',
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT '',
  UNIQUE (estabelecimento_id, usuario)
);
ALTER TABLE setores_impressao ADD COLUMN estabelecimento_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE impressora_agentes ADD COLUMN estabelecimento_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE impressora_etiquetas ADD COLUMN estabelecimento_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gestores ADD COLUMN estabelecimento_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gestor_jobs ADD COLUMN estabelecimento_id INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_funcionario_usuario_estabelecimento ON funcionarios(estabelecimento_id, usuario);
CREATE INDEX IF NOT EXISTS idx_sessoes_hash ON sessoes(token_hash, expira_em);
CREATE INDEX IF NOT EXISTS idx_produtos_estabelecimento ON produtos(estabelecimento_id);
CREATE INDEX IF NOT EXISTS idx_vendas_estabelecimento ON vendas(estabelecimento_id);
CREATE INDEX IF NOT EXISTS idx_categorias_pai ON categorias(estabelecimento_id, categoria_pai_id);
CREATE INDEX IF NOT EXISTS idx_prod_barcode ON produto_codigos_barras(estabelecimento_id, codigo);
CREATE INDEX IF NOT EXISTS idx_comanda_mesa ON comandas(mesa_id, status);
