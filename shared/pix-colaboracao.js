// BR Code estático: Manual de Padrões para Iniciação do Pix, Banco Central.
// https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Regulamento_Pix/II_ManualdePadroesparaIniciacaodoPix.pdf
function campo(id, valor) {
  if (valor.length > 99) throw new Error('Campo Pix excede o tamanho permitido');
  return id + String(valor.length).padStart(2, '0') + valor;
}

function texto(valor, limite) {
  return String(valor).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim().slice(0, limite).trim();
}

export function crc16(valor) {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(valor)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = ((crc << 1) ^ ((crc & 0x8000) ? 0x1021 : 0)) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function gerarPix({ chave, nome, cidade }, valor) {
  const quantia = String(valor ?? '').trim().replace(',', '.');
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(quantia) || Number(quantia) <= 0) {
    throw new Error('Informe um valor entre R$ 0,01 e R$ 999.999,99, com até duas casas decimais');
  }
  const recebedor = texto(nome, 25);
  const municipio = texto(cidade, 15);
  if (!chave || !recebedor || !municipio || !/^[\x21-\x7E]+$/.test(chave)) throw new Error('Recebedor Pix inválido');
  const payload = campo('00', '01') + campo('26', campo('00', 'br.gov.bcb.pix') + campo('01', chave))
    + campo('52', '0000') + campo('53', '986') + campo('54', Number(quantia).toFixed(2))
    + campo('58', 'BR') + campo('59', recebedor) + campo('60', municipio)
    + campo('62', campo('05', '***')) + '6304';
  return payload + crc16(payload);
}
