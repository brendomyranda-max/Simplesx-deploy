-- A interface consulta só a revisão quando a comanda não mudou.
ALTER TABLE comandas ADD COLUMN revisao INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_pessoas_comanda_tenant ON comanda_pessoas(estabelecimento_id,comanda_id,id);
CREATE INDEX idx_comandas_origem_tenant ON comandas(estabelecimento_id,comanda_origem_id,fechamento_tipo,id);
CREATE INDEX idx_comandas_status_tenant ON comandas(estabelecimento_id,status,mesa_id);
CREATE INDEX idx_itens_comanda_tenant ON comanda_itens(estabelecimento_id,comanda_id,id);
CREATE INDEX idx_vendas_comanda_tenant ON vendas(estabelecimento_id,comanda_id,status,id);

CREATE TRIGGER comanda_revisao_update AFTER UPDATE ON comandas
WHEN NEW.revisao=OLD.revisao
BEGIN
  UPDATE comandas SET revisao=revisao+1 WHERE id=NEW.id AND estabelecimento_id=NEW.estabelecimento_id;
  UPDATE comandas SET revisao=revisao+1 WHERE id IN (OLD.comanda_origem_id,NEW.comanda_origem_id)
    AND estabelecimento_id=NEW.estabelecimento_id;
END;
CREATE TRIGGER comanda_revisao_insert AFTER INSERT ON comandas
BEGIN
  UPDATE comandas SET revisao=revisao+1 WHERE id=NEW.comanda_origem_id AND estabelecimento_id=NEW.estabelecimento_id;
END;
CREATE TRIGGER comanda_revisao_delete AFTER DELETE ON comandas
BEGIN
  UPDATE comandas SET revisao=revisao+1 WHERE id=OLD.comanda_origem_id AND estabelecimento_id=OLD.estabelecimento_id;
END;

CREATE TRIGGER itens_revisao_insert AFTER INSERT ON comanda_itens
BEGIN
  UPDATE comandas SET revisao=revisao+1 WHERE id IN (NEW.comanda_id)
    AND estabelecimento_id=NEW.estabelecimento_id;
END;

CREATE TRIGGER itens_revisao_update AFTER UPDATE OF comanda_id,pessoa_id,produto_id,nome,quantidade,preco_unitario,observacao,status,enviado_em,responsavel,combo_escolhas_json ON comanda_itens
BEGIN
  UPDATE comandas SET revisao=revisao+1 WHERE id IN (OLD.comanda_id,NEW.comanda_id)
    AND estabelecimento_id=NEW.estabelecimento_id;
END;

CREATE TRIGGER itens_revisao_delete AFTER DELETE ON comanda_itens
BEGIN
  UPDATE comandas SET revisao=revisao+1 WHERE id IN (OLD.comanda_id)
    AND estabelecimento_id=OLD.estabelecimento_id;
END;

CREATE TRIGGER pessoas_revisao_insert AFTER INSERT ON comanda_pessoas
BEGIN
  UPDATE comandas SET revisao=revisao+1 WHERE id IN (NEW.comanda_id)
    AND estabelecimento_id=NEW.estabelecimento_id;
END;

CREATE TRIGGER pessoas_revisao_update AFTER UPDATE ON comanda_pessoas
BEGIN
  UPDATE comandas SET revisao=revisao+1 WHERE id IN (OLD.comanda_id,NEW.comanda_id)
    AND estabelecimento_id=NEW.estabelecimento_id;
END;

CREATE TRIGGER pessoas_revisao_delete AFTER DELETE ON comanda_pessoas
BEGIN
  UPDATE comandas SET revisao=revisao+1 WHERE id IN (OLD.comanda_id)
    AND estabelecimento_id=OLD.estabelecimento_id;
END;

CREATE TRIGGER cartoes_revisao_insert AFTER INSERT ON cartao_atendimentos
BEGIN
  UPDATE comandas SET revisao=revisao+1 WHERE id IN (NEW.comanda_id)
    AND estabelecimento_id=NEW.estabelecimento_id;
END;

CREATE TRIGGER cartoes_revisao_update AFTER UPDATE ON cartao_atendimentos
BEGIN
  UPDATE comandas SET revisao=revisao+1 WHERE id IN (OLD.comanda_id,NEW.comanda_id)
    AND estabelecimento_id=NEW.estabelecimento_id;
END;

CREATE TRIGGER cartoes_revisao_delete AFTER DELETE ON cartao_atendimentos
BEGIN
  UPDATE comandas SET revisao=revisao+1 WHERE id IN (OLD.comanda_id)
    AND estabelecimento_id=OLD.estabelecimento_id;
END;

CREATE TRIGGER vendas_revisao_insert AFTER INSERT ON vendas
BEGIN
  UPDATE comandas SET revisao=revisao+1 WHERE id IN (NEW.comanda_id)
    AND estabelecimento_id=NEW.estabelecimento_id;
END;

CREATE TRIGGER vendas_revisao_update AFTER UPDATE ON vendas
BEGIN
  UPDATE comandas SET revisao=revisao+1 WHERE id IN (OLD.comanda_id,NEW.comanda_id)
    AND estabelecimento_id=NEW.estabelecimento_id;
END;

CREATE TRIGGER vendas_revisao_delete AFTER DELETE ON vendas
BEGIN
  UPDATE comandas SET revisao=revisao+1 WHERE id IN (OLD.comanda_id)
    AND estabelecimento_id=OLD.estabelecimento_id;
END;

CREATE TRIGGER impressoes_revisao_insert AFTER INSERT ON pedido_impressoes
BEGIN
  UPDATE comandas SET revisao=revisao+1 WHERE estabelecimento_id=NEW.estabelecimento_id
    AND id IN (SELECT comanda_id FROM comanda_itens WHERE id IN (NEW.item_id)
      AND estabelecimento_id=NEW.estabelecimento_id);
END;

CREATE TRIGGER impressoes_revisao_update AFTER UPDATE ON pedido_impressoes
BEGIN
  UPDATE comandas SET revisao=revisao+1 WHERE estabelecimento_id=NEW.estabelecimento_id
    AND id IN (SELECT comanda_id FROM comanda_itens WHERE id IN (OLD.item_id,NEW.item_id)
      AND estabelecimento_id=NEW.estabelecimento_id);
END;

CREATE TRIGGER impressoes_revisao_delete AFTER DELETE ON pedido_impressoes
BEGIN
  UPDATE comandas SET revisao=revisao+1 WHERE estabelecimento_id=OLD.estabelecimento_id
    AND id IN (SELECT comanda_id FROM comanda_itens WHERE id IN (OLD.item_id)
      AND estabelecimento_id=OLD.estabelecimento_id);
END;

CREATE TRIGGER fila_desktop_revisao_update AFTER UPDATE OF status,erro ON gestor_jobs
BEGIN
  UPDATE comandas SET revisao=revisao+1 WHERE estabelecimento_id=NEW.estabelecimento_id
    AND id IN (SELECT i.comanda_id FROM pedido_impressoes p JOIN comanda_itens i ON i.id=p.item_id
      AND i.estabelecimento_id=p.estabelecimento_id WHERE p.lote_id=NEW.pedido_lote_id AND p.estabelecimento_id=NEW.estabelecimento_id);
END;

CREATE TRIGGER fila_desktop_revisao_delete AFTER DELETE ON gestor_jobs
BEGIN
  UPDATE comandas SET revisao=revisao+1 WHERE estabelecimento_id=OLD.estabelecimento_id
    AND id IN (SELECT i.comanda_id FROM pedido_impressoes p JOIN comanda_itens i ON i.id=p.item_id
      AND i.estabelecimento_id=p.estabelecimento_id WHERE p.lote_id=OLD.pedido_lote_id AND p.estabelecimento_id=OLD.estabelecimento_id);
END;

CREATE TRIGGER fila_android_revisao_update AFTER UPDATE OF status,erro_mensagem ON device_tasks
BEGIN
  UPDATE comandas SET revisao=revisao+1 WHERE estabelecimento_id=NEW.estabelecimento_id
    AND id IN (SELECT i.comanda_id FROM pedido_impressoes p JOIN comanda_itens i ON i.id=p.item_id
      AND i.estabelecimento_id=p.estabelecimento_id WHERE p.lote_id=NEW.id AND p.estabelecimento_id=NEW.estabelecimento_id);
END;

CREATE TRIGGER fila_android_revisao_delete AFTER DELETE ON device_tasks
BEGIN
  UPDATE comandas SET revisao=revisao+1 WHERE estabelecimento_id=OLD.estabelecimento_id
    AND id IN (SELECT i.comanda_id FROM pedido_impressoes p JOIN comanda_itens i ON i.id=p.item_id
      AND i.estabelecimento_id=p.estabelecimento_id WHERE p.lote_id=OLD.id AND p.estabelecimento_id=OLD.estabelecimento_id);
END;

CREATE TRIGGER mesa_revisao_update AFTER UPDATE ON mesas
BEGIN
  UPDATE comandas SET revisao=revisao+1 WHERE mesa_id=NEW.id AND estabelecimento_id=NEW.estabelecimento_id;
END;
CREATE TRIGGER produto_comanda_revisao_update AFTER UPDATE OF nome,unidade ON produtos
WHEN NEW.nome IS NOT OLD.nome OR NEW.unidade IS NOT OLD.unidade
BEGIN
  UPDATE comandas SET revisao=revisao+1 WHERE estabelecimento_id=NEW.estabelecimento_id
    AND id IN (SELECT comanda_id FROM comanda_itens WHERE produto_id=NEW.id AND estabelecimento_id=NEW.estabelecimento_id);
END;

