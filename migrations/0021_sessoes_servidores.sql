-- Uma sessão por servidor; nomes editados no painel sobrevivem à sincronização.
ALTER TABLE gestores ADD COLUMN sessao_id TEXT;
ALTER TABLE gestores ADD COLUMN nome_personalizado TEXT;

