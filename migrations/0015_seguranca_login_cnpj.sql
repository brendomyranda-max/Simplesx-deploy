-- CNPJ identifica o estabelecimento; usuário/senha continuam sendo a prova de acesso.
ALTER TABLE estabelecimentos ADD COLUMN cnpj TEXT;

UPDATE estabelecimentos
SET cnpj = (
  SELECT REPLACE(REPLACE(REPLACE(REPLACE(TRIM(valor), '.', ''), '/', ''), '-', ''), ' ', '')
  FROM empresa_config
  WHERE empresa_config.estabelecimento_id = estabelecimentos.id
    AND chave = 'empresa_cnpj'
)
WHERE cnpj IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_estabelecimentos_cnpj
ON estabelecimentos(cnpj)
WHERE cnpj IS NOT NULL AND cnpj <> '';

-- PINs antigos estavam em texto puro. Eles são invalidados e devem ser
-- recadastrados; os novos passam a usar o mesmo hash forte das senhas.
UPDATE funcionarios SET pin = NULL WHERE pin IS NOT NULL AND pin <> '';
