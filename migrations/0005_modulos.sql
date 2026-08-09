-- ============================================================
-- SimplesX - Módulos de acesso por funcionário
-- modulos: lista separada por vírgula. Valores possíveis:
--   gestor       -> aplicação completa
--   pdv_mercado  -> somente PDV Mercado
--   restaurante  -> somente Restaurante
-- ============================================================

ALTER TABLE funcionarios ADD COLUMN modulos TEXT NOT NULL DEFAULT 'gestor';

UPDATE funcionarios SET modulos = 'gestor' WHERE modulos IS NULL OR modulos = '';
