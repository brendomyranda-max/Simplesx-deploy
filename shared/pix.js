/**
 * Pix estático com valor, no padrão do Banco Central.
 * O código leva a chave da própria loja. O SimplexS.A não recebe o pagamento.
 */

import { httpError } from './util.js';

function campo(id, valor) {
  const texto = String(valor);
  if (texto.length > 99) throw httpError(400, 'Dados do Pix excedem o limite.');
  return `${id}${String(texto.length).padStart(2, '0')}${texto}`;
}

function crc16(texto) {
  let crc = 0xffff;
  for (let i = 0; i < texto.length; i += 1) {
    crc ^= texto.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      if (crc & 0x8000) crc = ((crc << 1) ^ 0x1021) & 0xffff;
      else crc = (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function digitosIguais(valor) {
  return /^(\d)\1+$/.test(valor);
}

function validarCpf(cpf) {
  if (!/^\d{11}$/.test(cpf) || digitosIguais(cpf)) return false;
  const digito = (tamanho) => {
    let soma = 0;
    for (let i = 0; i < tamanho; i += 1) soma += Number(cpf[i]) * (tamanho + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(9) === Number(cpf[9]) && digito(10) === Number(cpf[10]);
}

function validarCnpj(cnpj) {
  if (!/^\d{14}$/.test(cnpj) || digitosIguais(cnpj)) return false;
  const digito = (base, pesos) => {
    let soma = 0;
    for (let i = 0; i < pesos.length; i += 1) soma += Number(base[i]) * pesos[i];
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const primeiro = digito(cnpj, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const segundo = digito(cnpj, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return primeiro === Number(cnpj[12]) && segundo === Number(cnpj[13]);
}

const MENSAGEM_CHAVE = 'Informe uma chave Pix válida: CPF, CNPJ, e-mail, celular ou chave aleatória.';

export function normalizarChavePix(valor) {
  const bruto = String(valor || '').trim();
  if (!bruto) throw httpError(400, MENSAGEM_CHAVE);
  const semEspaco = bruto.replace(/\s/g, '');
  if (semEspaco.includes('@')) {
    const email = semEspaco.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 77) throw httpError(400, MENSAGEM_CHAVE);
    return email;
  }
  const uuid = semEspaco.toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)) return uuid;
  const digitos = semEspaco.replace(/\D/g, '');
  const pareceTelefone = semEspaco.startsWith('+') || (digitos.startsWith('55') && digitos.length >= 12 && digitos.length <= 13);
  if (pareceTelefone) {
    const tel = digitos.startsWith('55') ? digitos : `55${digitos}`;
    if (!/^55\d{10,11}$/.test(tel)) throw httpError(400, MENSAGEM_CHAVE);
    return `+${tel}`;
  }
  if (digitos.length === 11 && validarCpf(digitos)) return digitos;
  if (digitos.length === 14 && validarCnpj(digitos)) return digitos;
  if (/[./]/.test(semEspaco)) throw httpError(400, MENSAGEM_CHAVE);
  if (digitos.length === 10 || digitos.length === 11) return `+55${digitos}`;
  throw httpError(400, MENSAGEM_CHAVE);
}

export function textoPix(valor, max, fallback = '') {
  const limpo = String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  return (limpo || fallback).slice(0, max);
}

function valorPix(valor) {
  const cents = Math.round(Number(valor) * 100);
  if (!Number.isInteger(cents) || cents <= 0 || cents > 100000000) throw httpError(400, 'O Pix precisa de um valor maior que zero.');
  return (cents / 100).toFixed(2);
}

export function copiaColaPix({ chave, nome, cidade, valor, txid }) {
  const chaveNorm = normalizarChavePix(chave);
  const recebedor = textoPix(nome, 25, 'LOJA');
  const cidadeNorm = textoPix(cidade, 15, '');
  if (!recebedor) throw httpError(400, 'Informe o nome da loja para gerar o Pix.');
  if (cidadeNorm.length < 2) throw httpError(400, 'Informe a cidade do recebedor para gerar o Pix.');
  const quantia = valorPix(valor);
  const referencia = String(txid || 'PEDIDO').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || 'PEDIDO';
  const conta = campo('00', 'br.gov.bcb.pix') + campo('01', chaveNorm);
  const semCrc = [
    campo('00', '01'),
    campo('01', '11'),
    campo('26', conta),
    campo('52', '0000'),
    campo('53', '986'),
    campo('54', quantia),
    campo('58', 'BR'),
    campo('59', recebedor),
    campo('60', cidadeNorm),
    campo('62', campo('05', referencia)),
    '6304',
  ].join('');
  return semCrc + crc16(semCrc);
}
