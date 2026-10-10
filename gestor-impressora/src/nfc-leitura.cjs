/**
 * Arquivo: nfc-leitura.cjs
 * Responsabilidade: Separa a leitura do leitor USB do prefixo configurado no Gestor.
 */

const PREFIXO_PADRAO = 'NFC:'

function prefixoValido(prefixo) {
  return /^(?=.*[^0-9])[A-Za-z0-9:_.-]{1,12}$/.test(String(prefixo || ''))
}

function interpretarLeituraNfc(config, texto) {
  if (!config?.nfcAtivo) throw new Error('Ponte NFC desligada no Gestor')
  const prefixo = String(config.nfcPrefixo || PREFIXO_PADRAO)
  if (!prefixoValido(prefixo)) throw new Error('Prefixo NFC inválido')
  const bruto = String(texto || '').replace(/[\u0000-\u001F\u007F]/g, '').trim()
  if (!bruto.startsWith(prefixo)) throw new Error('Leitura sem o prefixo NFC configurado')
  const valor = bruto.slice(prefixo.length).trim()
  if (valor.length < 1 || valor.length > 128) throw new Error('Leitura NFC deve ter de 1 a 128 caracteres')
  if (!/^[\x20-\x7E]+$/.test(valor)) throw new Error('Leitura NFC contém caracteres não suportados')
  return { uid: valor, payload: valor }
}

module.exports = { interpretarLeituraNfc, prefixoValido, PREFIXO_PADRAO }
