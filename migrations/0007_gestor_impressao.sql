-- ============================================================
-- SimplesX - Fila de impressão via deploy (gestor local ↔ Cloudflare)
-- O gestor local se registra (token + nome + IP) e busca trabalhos
-- de impressão por polling. A fila fica aqui no D1.
-- ============================================================

CREATE TABLE IF NOT EXISTS gestores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  nome TEXT,
  ip TEXT,
  ultima_conexao TEXT,
  criado_em TEXT NOT NULL DEFAULT '',
  ativo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS gestor_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gestor_token TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'texto',
  conteudo TEXT NOT NULL,
  impressora TEXT,
  largura_mm INTEGER DEFAULT 80,
  copias INTEGER DEFAULT 1,
  cortar INTEGER DEFAULT 1,
  alimentar INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pendente',
  erro TEXT,
  criado_em TEXT NOT NULL DEFAULT '',
  enviado_em TEXT,
  executado_em TEXT
);

CREATE INDEX IF NOT EXISTS idx_gestor_jobs_pull ON gestor_jobs (gestor_token, status, id);
