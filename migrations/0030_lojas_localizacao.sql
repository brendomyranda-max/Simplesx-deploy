-- Ponto da loja e o limite de entrega. O cliente só vê a loja na região
-- quando a distância até esse ponto cabe no raio escolhido pelo estabelecimento.

ALTER TABLE lojas_online ADD COLUMN endereco TEXT;
ALTER TABLE lojas_online ADD COLUMN latitude REAL;
ALTER TABLE lojas_online ADD COLUMN longitude REAL;
ALTER TABLE lojas_online ADD COLUMN raio_entrega_km REAL;
