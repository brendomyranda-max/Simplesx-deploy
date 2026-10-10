-- Aparência do delivery. A logo é independente.
-- A apresentação é uma capa ou uma cor, nunca as duas ao mesmo tempo.

ALTER TABLE lojas_online ADD COLUMN cor_capa TEXT;
