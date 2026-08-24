-- Gestor Local v2: pareamento seguro, dispositivos, fila idempotente e auditoria.
-- Estrutura aditiva: as tabelas gestores/gestor_jobs permanecem disponíveis
-- durante a migração do aplicativo desktop legado.

CREATE TABLE IF NOT EXISTS device_pairing_codes (
  id TEXT PRIMARY KEY,
  estabelecimento_id INTEGER NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  criado_por INTEGER NOT NULL,
  expira_em TEXT NOT NULL,
  usado_em TEXT,
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  estabelecimento_id INTEGER NOT NULL,
  nome TEXT NOT NULL,
  plataforma TEXT NOT NULL,
  versao TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  token_versao INTEGER NOT NULL DEFAULT 1,
  token_expira_em TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'offline',
  ultima_conexao TEXT,
  ultimo_erro TEXT,
  revogado_em TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_tasks (
  id TEXT PRIMARY KEY,
  estabelecimento_id INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  tipo TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_versao INTEGER NOT NULL DEFAULT 1,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  tentativas INTEGER NOT NULL DEFAULT 0,
  max_tentativas INTEGER NOT NULL DEFAULT 5,
  disponivel_em TEXT NOT NULL,
  lease_id TEXT,
  lease_expira_em TEXT,
  origem_tipo TEXT,
  origem_id TEXT,
  reimpressao INTEGER NOT NULL DEFAULT 0,
  tarefa_original_id TEXT,
  erro_codigo TEXT,
  erro_mensagem TEXT,
  resultado_json TEXT,
  criado_por INTEGER NOT NULL,
  criado_em TEXT NOT NULL,
  enviado_em TEXT,
  processando_em TEXT,
  concluido_em TEXT,
  cancelado_em TEXT,
  atualizado_em TEXT NOT NULL,
  UNIQUE (estabelecimento_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS device_task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estabelecimento_id INTEGER NOT NULL,
  task_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  evento TEXT NOT NULL,
  status_anterior TEXT,
  status_novo TEXT,
  detalhes_json TEXT,
  ator_tipo TEXT NOT NULL,
  ator_id TEXT,
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estabelecimento_id INTEGER NOT NULL,
  device_id TEXT,
  evento TEXT NOT NULL,
  detalhes_json TEXT,
  ator_tipo TEXT NOT NULL,
  ator_id TEXT,
  criado_em TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pairing_codes_expiracao
  ON device_pairing_codes (code_hash, usado_em, expira_em);
CREATE INDEX IF NOT EXISTS idx_devices_estabelecimento
  ON devices (estabelecimento_id, revogado_em, nome);
CREATE INDEX IF NOT EXISTS idx_devices_token
  ON devices (token_hash, token_expira_em, revogado_em);
CREATE INDEX IF NOT EXISTS idx_device_tasks_pull
  ON device_tasks (device_id, status, disponivel_em, criado_em);
CREATE INDEX IF NOT EXISTS idx_device_tasks_estabelecimento
  ON device_tasks (estabelecimento_id, criado_em);
CREATE INDEX IF NOT EXISTS idx_device_task_events_task
  ON device_task_events (estabelecimento_id, task_id, criado_em);
CREATE INDEX IF NOT EXISTS idx_device_audit_estabelecimento
  ON device_audit_events (estabelecimento_id, criado_em);
