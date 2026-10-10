-- Etapa visível para o cliente. O status antigo (recebido, confirmado,
-- cancelado, finalizado) continua valendo para o caixa e para o painel.
-- SQLite não deixa ampliar o CHECK de status, então a etapa fica numa coluna nova.

ALTER TABLE pedidos_online ADD COLUMN etapa TEXT NOT NULL DEFAULT 'recebido';

UPDATE pedidos_online SET etapa = CASE
  WHEN status = 'confirmado' THEN 'preparando'
  WHEN status = 'cancelado' THEN 'cancelado'
  WHEN status = 'finalizado' THEN 'entregue'
  ELSE 'recebido'
END;
