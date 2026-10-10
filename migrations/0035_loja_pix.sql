-- Chave Pix de cada loja de delivery. O cliente paga direto essa chave.
-- Não é a cobrança da plataforma nem o caixa do salão.
ALTER TABLE lojas_online ADD COLUMN pix_chave TEXT;
ALTER TABLE lojas_online ADD COLUMN pix_cidade TEXT;
ALTER TABLE pedidos_online ADD COLUMN pix_copia_cola TEXT;
