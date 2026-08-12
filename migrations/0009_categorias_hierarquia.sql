-- Categorias principais podem conter subcategorias. A rota de impressão fica
-- na categoria principal e é herdada automaticamente pelas subcategorias.
ALTER TABLE categorias ADD COLUMN categoria_pai_id INTEGER;
ALTER TABLE categorias ADD COLUMN impressora_agente_id INTEGER;

-- Preserva as rotas já configuradas na tela de impressoras.
UPDATE categorias
SET impressora_agente_id = (
  SELECT ia.id
  FROM impressora_agentes ia, json_each(ia.categorias) jc
  WHERE CAST(jc.value AS INTEGER) = categorias.id
    AND ia.ativo = 1
  ORDER BY ia.id
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1
  FROM impressora_agentes ia, json_each(ia.categorias) jc
  WHERE CAST(jc.value AS INTEGER) = categorias.id
    AND ia.ativo = 1
);

CREATE INDEX IF NOT EXISTS idx_categorias_pai ON categorias(categoria_pai_id);
CREATE INDEX IF NOT EXISTS idx_categorias_impressora ON categorias(impressora_agente_id);
