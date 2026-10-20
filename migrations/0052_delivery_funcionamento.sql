ALTER TABLE lojas_online ADD COLUMN aceitacao_automatica INTEGER NOT NULL DEFAULT 0 CHECK (aceitacao_automatica IN (0,1));
ALTER TABLE lojas_online ADD COLUMN horario_automatico INTEGER NOT NULL DEFAULT 0 CHECK (horario_automatico IN (0,1));
ALTER TABLE lojas_online ADD COLUMN horario_abertura TEXT NOT NULL DEFAULT '18:00';
ALTER TABLE lojas_online ADD COLUMN horario_fechamento TEXT NOT NULL DEFAULT '23:00';
ALTER TABLE lojas_online ADD COLUMN horario_dias TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]';
ALTER TABLE lojas_online ADD COLUMN horario_fuso TEXT NOT NULL DEFAULT 'America/Sao_Paulo';
ALTER TABLE impressora_agentes ADD COLUMN imprime_delivery INTEGER NOT NULL DEFAULT 0 CHECK (imprime_delivery IN (0,1));
