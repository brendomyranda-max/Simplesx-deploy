-- NFC-e multiempresa. Segredos do provedor ficam em secrets do Worker;
-- no D1 guardamos somente o identificador da empresa no provedor.
CREATE TABLE IF NOT EXISTS fiscal_config (
  estabelecimento_id INTEGER PRIMARY KEY,
  ativo INTEGER NOT NULL DEFAULT 0,
  ambiente TEXT NOT NULL DEFAULT 'homologacao',
  provedor TEXT NOT NULL DEFAULT 'simulador',
  provedor_empresa_id TEXT,
  razao_social TEXT,
  nome_fantasia TEXT,
  cnpj TEXT,
  inscricao_estadual TEXT,
  regime_tributario INTEGER NOT NULL DEFAULT 1,
  uf TEXT,
  codigo_municipio TEXT,
  municipio TEXT,
  cep TEXT,
  logradouro TEXT,
  numero_endereco TEXT,
  bairro TEXT,
  serie INTEGER NOT NULL DEFAULT 1,
  proximo_numero INTEGER NOT NULL DEFAULT 1,
  emitir_automaticamente INTEGER NOT NULL DEFAULT 0,
  consumidor_final_padrao INTEGER NOT NULL DEFAULT 1,
  atualizado_em TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS produto_fiscal (
  estabelecimento_id INTEGER NOT NULL,
  produto_id INTEGER NOT NULL,
  ncm TEXT NOT NULL DEFAULT '',
  cest TEXT,
  cfop TEXT NOT NULL DEFAULT '5102',
  origem INTEGER NOT NULL DEFAULT 0,
  csosn TEXT,
  cst_icms TEXT,
  aliquota_icms REAL NOT NULL DEFAULT 0,
  cst_pis TEXT NOT NULL DEFAULT '49',
  aliquota_pis REAL NOT NULL DEFAULT 0,
  cst_cofins TEXT NOT NULL DEFAULT '49',
  aliquota_cofins REAL NOT NULL DEFAULT 0,
  codigo_beneficio TEXT,
  atualizado_em TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (estabelecimento_id, produto_id)
);

CREATE TABLE IF NOT EXISTS documentos_fiscais (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estabelecimento_id INTEGER NOT NULL,
  venda_id INTEGER NOT NULL,
  modelo INTEGER NOT NULL DEFAULT 65,
  serie INTEGER NOT NULL,
  numero INTEGER NOT NULL,
  ambiente TEXT NOT NULL,
  provedor TEXT NOT NULL,
  referencia TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processando',
  chave_acesso TEXT,
  protocolo TEXT,
  xml TEXT,
  danfe_url TEXT,
  qr_code_url TEXT,
  valor_produtos REAL NOT NULL DEFAULT 0,
  valor_desconto REAL NOT NULL DEFAULT 0,
  valor_total REAL NOT NULL DEFAULT 0,
  valor_icms REAL NOT NULL DEFAULT 0,
  valor_pis REAL NOT NULL DEFAULT 0,
  valor_cofins REAL NOT NULL DEFAULT 0,
  mensagem TEXT,
  autorizado_em TEXT,
  cancelado_em TEXT,
  criado_em TEXT NOT NULL DEFAULT '',
  atualizado_em TEXT NOT NULL DEFAULT '',
  UNIQUE (estabelecimento_id, venda_id),
  UNIQUE (estabelecimento_id, serie, numero)
);

CREATE TABLE IF NOT EXISTS documento_fiscal_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estabelecimento_id INTEGER NOT NULL,
  documento_id INTEGER NOT NULL,
  venda_item_id INTEGER,
  produto_id INTEGER,
  nome TEXT NOT NULL,
  quantidade REAL NOT NULL,
  valor_unitario REAL NOT NULL,
  valor_total REAL NOT NULL,
  ncm TEXT NOT NULL,
  cest TEXT,
  cfop TEXT NOT NULL,
  origem INTEGER NOT NULL DEFAULT 0,
  csosn TEXT,
  cst_icms TEXT,
  base_icms REAL NOT NULL DEFAULT 0,
  aliquota_icms REAL NOT NULL DEFAULT 0,
  valor_icms REAL NOT NULL DEFAULT 0,
  cst_pis TEXT,
  aliquota_pis REAL NOT NULL DEFAULT 0,
  valor_pis REAL NOT NULL DEFAULT 0,
  cst_cofins TEXT,
  aliquota_cofins REAL NOT NULL DEFAULT 0,
  valor_cofins REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS documento_fiscal_eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estabelecimento_id INTEGER NOT NULL,
  documento_id INTEGER NOT NULL,
  tipo TEXT NOT NULL,
  status TEXT NOT NULL,
  protocolo TEXT,
  justificativa TEXT,
  resposta TEXT,
  criado_em TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_doc_fiscal_venda ON documentos_fiscais(estabelecimento_id, venda_id);
CREATE INDEX IF NOT EXISTS idx_doc_fiscal_status ON documentos_fiscais(estabelecimento_id, status, criado_em);
CREATE INDEX IF NOT EXISTS idx_doc_fiscal_itens ON documento_fiscal_itens(estabelecimento_id, documento_id);
CREATE INDEX IF NOT EXISTS idx_doc_fiscal_eventos ON documento_fiscal_eventos(estabelecimento_id, documento_id);
