-- Conteúdo líquido de cada unidade/embalagem de insumo.
-- O estoque e o custo permanecem por embalagem; a ficha técnica pode consumir G/ML.
ALTER TABLE produtos ADD COLUMN conteudo_quantidade REAL;
ALTER TABLE produtos ADD COLUMN conteudo_unidade TEXT;
