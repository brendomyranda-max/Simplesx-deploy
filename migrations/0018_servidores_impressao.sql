-- Vincula cada rota lógica a um gestor/servidor e à impressora publicada por ele.
ALTER TABLE devices ADD COLUMN printers_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE gestores ADD COLUMN printers_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE impressora_agentes ADD COLUMN servidor_tipo TEXT;
ALTER TABLE impressora_agentes ADD COLUMN servidor_id TEXT;
ALTER TABLE impressora_agentes ADD COLUMN impressora_destino TEXT;

CREATE INDEX IF NOT EXISTS idx_impressora_agentes_servidor
  ON impressora_agentes (estabelecimento_id, servidor_tipo, servidor_id);
