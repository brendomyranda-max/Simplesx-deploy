/**
 * Arquivo: main.cjs
 * Responsabilidade: Controla o processo Electron, a bandeja, a configuração e a impressão.
 */

const { app, BrowserWindow, dialog, ipcMain, shell, Tray, Menu, nativeImage } = require('electron')
const crypto = require('node:crypto')
const { execFile } = require('node:child_process')
const fs = require('node:fs/promises')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')
const { JobJournal } = require('./job-journal.cjs')
const { resolveDataDirectory } = require('./data-directory.cjs')
const { createPrinterDiscovery, selectPrinter } = require('./printer-discovery.cjs')
const { externalFilePath } = require('./native-files.cjs')
const { interpretarLeituraNfc, prefixoValido, PREFIXO_PADRAO } = require('./nfc-leitura.cjs')
const { autoUpdater } = require('electron-updater')
const { createUpdates } = require('./updates.cjs')
const { printWithTypography } = require('./print-typography.cjs')

const executarArquivo = promisify(execFile)

const PORTA_LOCAL = 8410
const INTERVALO_POLL = 3000
const DEPLOY_PADRAO = 'https://doixp.com'

let janela
let tray
let encerrando = false
let config
let timer
let heartbeatTimer
let sincronizando = false
let sincronizacaoAtual = null
let sessaoId = crypto.randomUUID()
let fechando = false
let servidorLocal
let ultimoErro = ''
let ultimoContato = null
let ultimoJob = null
let ultimoNfc = null
let instalandoAtualizacao = false
let reconectarAposAtualizacao
const filasImpressao = new Map()
const descobrirImpressoras = createPrinterDiscovery({
  execute: executarArquivo,
  electronPrinters: () => {
    if (!janela || janela.isDestroyed()) return []
    return janela.webContents.getPrintersAsync()
  },
})

const dataDirectory = resolveDataDirectory(app.getPath('appData'))
require('node:fs').mkdirSync(dataDirectory, { recursive: true })
app.setPath('userData', dataDirectory)
const instanciaUnica = app.requestSingleInstanceLock()
if (!instanciaUnica) app.quit()
else {
  app.on('second-instance', () => {
    if (!janela) return
    if (janela.isMinimized()) janela.restore()
    janela.show()
    janela.focus()
  })
}

const arquivoConfig = () => path.join(app.getPath('userData'), 'config.json')

function configPadrao() {
  return {
    deployUrl: DEPLOY_PADRAO,
    token: crypto.randomBytes(16).toString('hex'),
    nome: `Servidor DoixP ${os.hostname()}`,
    impressoraPadrao: '',
    largurasImpressoras: {},
    alturasImpressoras: {},
    dpisImpressoras: {},
    fontesImpressoras: {},
    tipografiasImpressoras: {},
    colunasImpressoras: {},
    protocolosImpressoras: {},
    acabamentosImpressoras: {},
    iniciarComSistema: true,
    conectado: true,
    nfcAtivo: false,
    nfcPrefixo: PREFIXO_PADRAO,
  }
}

async function carregarConfig() {
  try {
    config = { ...configPadrao(), ...JSON.parse(await fs.readFile(arquivoConfig(), 'utf8')) }
  } catch {
    config = configPadrao()
    await salvarConfig(config)
  }
}

async function salvarConfig(novaConfig) {
  const deployUrl = String(novaConfig.deployUrl || DEPLOY_PADRAO).trim().replace(/\/$/, '')
  let deploy
  try {
    deploy = new URL(deployUrl)
  } catch {
    throw new Error('Endereço do deploy inválido')
  }
  const local = ['localhost', '127.0.0.1', '::1'].includes(deploy.hostname)
  if (deploy.protocol !== 'https:' && !(local && deploy.protocol === 'http:')) {
    throw new Error('O deploy deve usar HTTPS (HTTP é aceito apenas em localhost)')
  }
  const nfcPrefixo = String(novaConfig.nfcPrefixo || config?.nfcPrefixo || PREFIXO_PADRAO).trim()
  const nfcAtivo = novaConfig.nfcAtivo === true
  if (nfcAtivo && !prefixoValido(nfcPrefixo)) throw new Error('Prefixo NFC inválido. Use letras, como NFC:')
  config = {
    ...config,
    deployUrl,
    token: String(novaConfig.token || config?.token || '').trim(),
    nome: String(novaConfig.nome || `Servidor DoixP ${os.hostname()}`).trim(),
    impressoraPadrao: String(novaConfig.impressoraPadrao || ''),
    largurasImpressoras: normalizarLarguras(novaConfig.largurasImpressoras || config?.largurasImpressoras),
    alturasImpressoras: normalizarAlturas(novaConfig.alturasImpressoras || config?.alturasImpressoras),
    dpisImpressoras: normalizarDpis(novaConfig.dpisImpressoras || config?.dpisImpressoras),
    fontesImpressoras: normalizarFontes(novaConfig.fontesImpressoras || config?.fontesImpressoras),
    tipografiasImpressoras: normalizarTipografias(novaConfig.tipografiasImpressoras || config?.tipografiasImpressoras),
    colunasImpressoras: normalizarColunas(novaConfig.colunasImpressoras || config?.colunasImpressoras),
    acabamentosImpressoras: Object.fromEntries(Object.entries(novaConfig.acabamentosImpressoras || config?.acabamentosImpressoras || {}).map(([name, value]) => [name, normalizarAcabamento(value)])),
    protocolosImpressoras: normalizarProtocolos(novaConfig.protocolosImpressoras || config?.protocolosImpressoras),
    iniciarComSistema: novaConfig.iniciarComSistema !== false,
    conectado: novaConfig.conectado ?? config?.conectado ?? true,
    nfcAtivo,
    nfcPrefixo,
  }
  await fs.mkdir(path.dirname(arquivoConfig()), { recursive: true })
  await fs.writeFile(arquivoConfig(), JSON.stringify(config, null, 2), 'utf8')
  app.setLoginItemSettings({ openAtLogin: config.iniciarComSistema, openAsHidden: true })
  ultimoErro = ''
  notificarStatus()
  return statusAtual()
}

function normalizarLarguras(value) {
  const result = {}
  if (!value || typeof value !== 'object') return result
  for (const [nome, largura] of Object.entries(value)) {
    const numero = Number(largura)
    if (nome && Number.isFinite(numero) && numero >= 20 && numero <= 320) result[nome] = numero
  }
  return result
}

function normalizarAlturas(value) {
  const result = {}
  if (!value || typeof value !== 'object') return result
  for (const [nome, altura] of Object.entries(value)) {
    const numero = Number(altura)
    if (nome && Number.isFinite(numero) && numero >= 10 && numero <= 500) result[nome] = numero
  }
  return result
}

function normalizarProtocolos(value) {
  const permitidos = new Set(['DRIVER', 'ESC_POS', 'DIEBOLD', 'ESC_BEMA', 'STAR_LINE', 'TSPL', 'ZPL', 'CPCL', 'EPL'])
  const result = {}
  if (!value || typeof value !== 'object') return result
  for (const [nome, protocolo] of Object.entries(value)) {
    const normalizado = String(protocolo || '').toUpperCase()
    if (nome && permitidos.has(normalizado)) result[nome] = normalizado
  }
  return result
}

function normalizarAcabamento(value = {}) {
  const cutMode = value.cutMode ?? 'FULL'
  const feedLines = Number(value.feedLines ?? 3)
  const paperMode = value.paperMode ?? 'CONTINUOUS'
  const gapMm = Number(value.gapMm ?? 2)
  if (!['FULL', 'PARTIAL', 'FEED_FULL', 'FEED_PARTIAL', 'NONE'].includes(cutMode)) throw new Error('Corte inválido')
  if (!Number.isInteger(feedLines) || feedLines < 0 || feedLines > 255) throw new Error('Avanço deve estar entre 0 e 255 linhas')
  if (!['CONTINUOUS', 'GAP', 'BLACK_MARK'].includes(paperMode)) throw new Error('Tipo de papel inválido')
  if (!Number.isInteger(gapMm) || gapMm < 1 || gapMm > 20) throw new Error('Espaço/marca deve estar entre 1 e 20 mm')
  return { cutMode, feedLines, paperMode, gapMm }
}

function normalizarFontes(value) {
  const result = {}
  if (!value || typeof value !== 'object') return result
  for (const [nome, fonte] of Object.entries(value)) {
    if (nome && ['small', 'normal', 'large'].includes(fonte)) result[nome] = fonte
  }
  return result
}

function normalizarTipografias(value) {
  return Object.fromEntries(Object.entries(value || {}).map(([name, settings]) => [name, require('./typography.cjs').normalizeTypography(settings)]))
}

function normalizarColunas(value) {
  const result = {}
  if (!value || typeof value !== 'object') return result
  for (const [nome, colunas] of Object.entries(value)) {
    const numero = Number(colunas)
    if (nome && Number.isInteger(numero) && numero >= 8 && numero <= 160) result[nome] = numero
  }
  return result
}

function normalizarDpis(value) {
  const result = {}
  if (!value || typeof value !== 'object') return result
  for (const [nome, dpi] of Object.entries(value)) {
    const numero = Number(dpi)
    if (nome && Number.isInteger(numero) && numero >= 100 && numero <= 1200) result[nome] = numero
  }
  return result
}

function statusAtual() {
  return {
    ...config,
    version: app.getVersion(),
    online: config.conectado && !!ultimoContato && Date.now() - new Date(ultimoContato).getTime() < 15000,
    ultimoContato,
    ultimoJob,
    ultimoNfc,
    ultimoErro,
    portaLocal: PORTA_LOCAL,
    hostname: os.hostname(),
  }
}

function notificarStatus() {
  if (janela && !janela.isDestroyed()) janela.webContents.send('status-atualizado', statusAtual())
}

async function api(endpoint, body) {
  const resposta = await fetch(`${config.deployUrl}/api${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, session_id: sessaoId }),
    signal: AbortSignal.timeout(15000),
  })
  const contentType = resposta.headers.get('content-type') || ''
  const data = contentType.includes('application/json') ? await resposta.json().catch(() => ({})) : {}
  if (!contentType.includes('application/json')) {
    throw new Error(`Endereço não é um servidor DoixP (resposta ${resposta.status})`)
  }
  if (!resposta.ok) throw new Error(data.error || `Servidor respondeu ${resposta.status}`)
  return data
}

async function registrar() {
  const printers = await listarImpressoras()
  await api('/gestor/register', {
    token: config.token, nome: config.nome, ip: os.hostname(), printers, nfc: estadoNfc(),
  })
}

function estadoNfc() {
  return { ativo: !!config.nfcAtivo, prefixo: config.nfcPrefixo || PREFIXO_PADRAO }
}

async function publicarLeituraNfc(texto) {
  const leitura = interpretarLeituraNfc(config, texto)
  leitura.leitor = os.hostname()
  const data = await api('/gestor/nfc', { token: config.token, ...leitura })
  ultimoNfc = { id: data.id, uid: data.uid, payload: data.payload, em: new Date().toISOString() }
  notificarStatus()
  return { ok: true, id: data.id, uid: data.uid, payload: data.payload }
}

async function lerJsonLimitado(req, limite) {
  const partes = []
  let total = 0
  for await (const parte of req) {
    total += parte.length
    if (total > limite) throw new Error('Conteudo excede o limite')
    partes.push(parte)
  }
  return JSON.parse(Buffer.concat(partes).toString('utf8'))
}

function nomeComparavel(value) {
  return String(value || '').trim().toLocaleLowerCase('pt-BR')
}

async function resolverImpressora(nomeSolicitado) {
  return selectPrinter(await listarImpressoras(), nomeSolicitado, config.impressoraPadrao)
}

function quebrarPorLargura(texto, larguraMm, fonte = 'normal', colunasNormal = null) {
  const base = Number.isInteger(colunasNormal) && colunasNormal >= 8 && colunasNormal <= 160
    ? colunasNormal : (Number(larguraMm) || 58) * 32 / 58
  const colunas = Math.max(1, Math.floor(base / escalaDaFonte(fonte)))
  return quebrarPorColunas(texto, colunas)
}

function escalaDaFonte(fonte) { return fonte === 'small' ? 0.75 : fonte === 'large' ? 2 : 1 }

function quebrarPorColunas(texto, colunas) {
  return String(texto || '').replace(/\r\n?/g, '\n').split('\n').flatMap((linha) => {
    if (!linha.length) return ['']
    const partes = []
    let restante = linha
    while (restante.length > colunas) {
      let corte = restante.lastIndexOf(' ', colunas)
      if (corte <= 0) corte = colunas
      partes.push(restante.slice(0, corte).trimEnd())
      restante = restante.slice(corte).trimStart()
    }
    partes.push(restante)
    return partes
  }).join('\n')
}

function bytesEscPos(texto, { alimentar = 3, cortar = true, larguraMm = 58, centralizar = false, tamanhoFonte = 'normal', colunasNormal = null, cutMode = 'FULL' } = {}) {
  const normalizado = quebrarPorLargura(textoAscii(texto).replaceAll('\t', '    '), larguraMm, tamanhoFonte, colunasNormal)
    .replace(/\r\n?/g, '\n')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replaceAll('º', 'o').replaceAll('ª', 'a')
    .replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '')
    .trimEnd()
  const partes = [Buffer.from([0x1b, 0x40, 0x1b, 0x4d, tamanhoFonte === 'small' ? 1 : 0, 0x1d, 0x21, tamanhoFonte === 'large' ? 0x11 : 0])]
  if (tamanhoFonte === 'large') partes.push(Buffer.from([0x1b, 0x33, 56]))
  if (centralizar) partes.push(Buffer.from([0x1b, 0x61, 0x01]))
  partes.push(Buffer.from(normalizado + '\n', 'ascii'))
  if (centralizar) partes.push(Buffer.from([0x1b, 0x61, 0x00]))
  if (alimentar > 0) partes.push(Buffer.from([0x1b, 0x64, Math.min(255, Number(alimentar) || 0)]))
  if (cortar && cutMode !== 'NONE') {
    const cortes = { FULL: [0x1d, 0x56, 0], PARTIAL: [0x1d, 0x56, 1], FEED_FULL: [0x1d, 0x56, 65, 0], FEED_PARTIAL: [0x1d, 0x56, 66, 0] }
    partes.push(Buffer.from(cortes[cutMode] || cortes.FULL))
  }
  return Buffer.concat(partes)
}

// IM453H em modo Padrão/Padrão II: ESC M não recebe parâmetro e GS ! não
// seleciona fonte. SO é reaplicado por linha porque Padrão II o cancela no LF.
// Manual do firmware I43.51.00.PD1.XX, seções 3.1 e 3.3.
function bytesDiebold(texto, { alimentar = 3, cortar = true, larguraMm = 80, centralizar = false, tamanhoFonte = 'normal', colunasNormal = null, cutMode = 'FULL' } = {}) {
  const base = Number.isInteger(colunasNormal) && colunasNormal >= 8 && colunasNormal <= 160
    ? colunasNormal : larguraMm <= 58 ? Math.max(8, Math.floor(larguraMm * 32 / 58)) : Math.floor(Math.min(larguraMm, 80) * 48 / 80)
  // A densidade condensada varia com o CPP do firmware. Conserva o limite
  // normal na fonte pequena; a expandida precisa de metade das colunas.
  const colunas = Math.max(1, Math.floor(base / (tamanhoFonte === 'large' ? 2 : 1)))
  const linhas = quebrarPorColunas(textoAscii(texto).replaceAll('\t', '    '), colunas).split('\n')
  const reset = Buffer.from([0x1b, 0x4d, 0x1b, 0x5d, 0])
  const partes = [reset]
  if (tamanhoFonte === 'small') partes.push(Buffer.from([0x0f]))
  if (tamanhoFonte === 'large') partes.push(Buffer.from([0x1b, 0x5d, 1]))
  for (const linha of linhas) {
    if (tamanhoFonte === 'large') partes.push(Buffer.from([0x0e]))
    const espacos = centralizar ? ' '.repeat(Math.max(0, Math.floor((colunas - linha.length) / 2))) : ''
    partes.push(Buffer.from(espacos + linha + (tamanhoFonte === 'large' ? '\n\n' : '\n'), 'ascii'))
  }
  partes.push(reset)
  if (alimentar > 0) partes.push(Buffer.from('\n'.repeat(Math.min(255, Math.floor(Number(alimentar) || 0))), 'ascii'))
  if (cortar && cutMode !== 'NONE') partes.push(Buffer.from(cutMode === 'FEED_PARTIAL' ? [0x1b, 0x1f] : [0x11]))
  return Buffer.concat(partes)
}

// Comandos nativos: Star Line Rev. 1.12 e Bematech MP-4200 TH Rev. 1.0.
function bytesNativeReceipt(texto, { alimentar = 3, cortar = true, larguraMm = 80, centralizar = false, tamanhoFonte = 'normal', colunasNormal = null, cutMode = 'FULL' } = {}, star = false) {
  const base = colunasNormal || (larguraMm <= 58 ? 32 : 48)
  const normalized = quebrarPorLargura(textoAscii(texto).replaceAll('\t', '    '), larguraMm, tamanhoFonte, base)
  const partes = [Buffer.from([27, 64])]
  if (star) {
    partes.push(Buffer.from([27, 30, 70, tamanhoFonte === 'small' ? 1 : 0]))
    partes.push(Buffer.from([27, 105, tamanhoFonte === 'large' ? 1 : 0, tamanhoFonte === 'large' ? 1 : 0]))
    partes.push(Buffer.from([27, 29, 97, centralizar ? 1 : 0]))
    partes.push(Buffer.from(normalized + '\n', 'ascii'))
  } else {
    if (tamanhoFonte === 'small') partes.push(Buffer.from([15]))
    partes.push(Buffer.from([27, 87, tamanhoFonte === 'large' ? 1 : 0, 27, 97, centralizar ? 1 : 0]))
    for (const line of normalized.split('\n')) {
      if (tamanhoFonte === 'large') partes.push(Buffer.from([27, 86]))
      partes.push(Buffer.from(line + '\n', 'ascii'))
    }
  }
  partes.push(Buffer.from(star ? [27, 29, 97, 0] : [27, 97, 0]))
  partes.push(Buffer.from('\n'.repeat(Math.max(0, Math.min(255, Math.floor(Number(alimentar) || 0)))), 'ascii'))
  if (cortar && cutMode !== 'NONE') {
    const partial = ['PARTIAL', 'FEED_PARTIAL'].includes(cutMode)
    if (star) partes.push(Buffer.from([27, 100, cutMode === 'FEED_FULL' ? 2 : cutMode === 'FEED_PARTIAL' ? 3 : partial ? 1 : 0]))
    else partes.push(Buffer.from([27, partial ? 109 : 119]))
  }
  return Buffer.concat(partes)
}
function bytesStarLine(texto, options) { return bytesNativeReceipt(texto, options, true) }
function bytesBema(texto, options) { return bytesNativeReceipt(texto, options, false) }

function textoAscii(texto) {
  return String(texto || '').replace(/\r\n?/g, '\n').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replaceAll('º', 'o').replaceAll('ª', 'a')
    .replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/[^\x09\x0A\x20-\x7E]/g, '').trimEnd()
}

function mmDots(mm, dpi = 203) { return Math.max(0, Math.round(Number(mm || 0) * Number(dpi || 203) / 25.4)) }

function layoutEtiqueta(texto, { larguraMm = 58, alturaMm = null, dpi = 203, tamanhoFonte = 'normal' } = {}) {
  const escalaDpi = dpi / 203
  const colunasBase = Math.max(8, Math.floor(larguraMm * 32 / 58))
  const alturaFixa = Number(alturaMm) >= 10 ? mmDots(alturaMm, dpi) : null
  let escalaFonte = escalaDaFonte(tamanhoFonte)
  let linhas
  let margem
  let alturaLinha
  for (;;) {
    const colunas = Math.max(1, Math.floor(colunasBase / escalaFonte))
    linhas = quebrarPorColunas(textoAscii(texto), colunas).split('\n')
    margem = Math.max(4, Math.round(16 * escalaDpi * escalaFonte))
    alturaLinha = Math.max(6, Math.round(28 * escalaDpi * escalaFonte))
    if (alturaFixa === null || margem * 2 + linhas.length * alturaLinha <= alturaFixa || escalaFonte <= 0.25) break
    escalaFonte = Math.max(0.25, escalaFonte - 0.01)
  }
  const alturaConteudo = Math.max(80, margem * 2 + linhas.length * alturaLinha)
  return {
    linhas, escalaFonte, margem, alturaLinha,
    fonte: Math.max(6, Math.round(24 * escalaDpi * escalaFonte)),
    largura: mmDots(larguraMm, dpi),
    altura: alturaFixa ?? alturaConteudo,
  }
}

function bytesEtiqueta(protocolo, texto, { copias = 1, larguraMm = 58, alturaMm = null, dpi = 203, centralizar = false, tamanhoFonte = 'normal', paperMode = 'CONTINUOUS', gapMm = 2 } = {}) {
  const { linhas, escalaFonte, margem, alturaLinha, fonte, largura, altura } = layoutEtiqueta(texto, { larguraMm, alturaMm, dpi, tamanhoFonte })
  const escala = (dpi / 203) * escalaFonte
  const quantidade = Math.min(20, Math.max(1, Number(copias) || 1))
  const xCentralizado = (linha, larguraCaractere = 12) => centralizar
    ? Math.max(margem, Math.round((largura - linha.length * larguraCaractere * escala) / 2))
    : Math.round(8 * escala)
  const midia = paperMode === 'BLACK_MARK' ? `BLINE ${gapMm} mm,0 mm` : `GAP ${paperMode === 'GAP' ? gapMm : 0} mm,0 mm`
  let comandos
  if (protocolo === 'TSPL') {
    comandos = `SIZE ${larguraMm} mm,${Math.ceil(altura / (dpi / 25.4))} mm\r\n${midia}\r\nDIRECTION 1\r\nCLS\r\n`
    // TSPL2 font 0 receives a size in points, not a bitmap multiplier.
    const pontosTspl = Math.max(1, Math.round(24 / 203 * 72 * escalaFonte))
    comandos += linhas.map((linha, i) => `TEXT ${xCentralizado(linha)},${margem + i * alturaLinha},"0",0,${pontosTspl},${pontosTspl},"${linha.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join('\r\n')
    comandos += `\r\nPRINT ${quantidade},1\r\n`
  } else if (protocolo === 'ZPL') {
    comandos = `^XA\n^PW${largura}\n^LL${altura}\n^LH0,0\n`
    comandos += linhas.map((linha, i) => centralizar
      ? `^FO0,${margem + i * alturaLinha}^FB${largura},1,0,C,0^A0N,${fonte},${fonte}^FD${linha.replace(/[\^~]/g, ' ')}^FS`
      : `^FO${margem},${margem + i * alturaLinha}^A0N,${fonte},${fonte}^FD${linha.replace(/[\^~]/g, ' ')}^FS`).join('\n')
    comandos += `\n^PQ${quantidade}\n^XZ\n`
  } else if (protocolo === 'CPCL') {
    comandos = `! 0 ${dpi} ${dpi} ${altura} ${quantidade}\r\nPW ${largura}\r\n`
    const multiplicador = Math.max(1, Math.floor(escala))
    comandos += `SETMAG ${multiplicador} ${multiplicador}\r\n`
    const fonteCpcl = escalaFonte < 0.85 ? 7 : 0
    const tamanhoCpcl = escalaFonte < 0.85 ? 0 : 2
    comandos += linhas.map((linha, i) => `TEXT ${fonteCpcl} ${tamanhoCpcl} ${xCentralizado(linha)} ${margem + i * alturaLinha} ${linha}`).join('\r\n')
    comandos += '\r\nFORM\r\nPRINT\r\n'
  } else if (protocolo === 'EPL') {
    comandos = `N\nq${largura}\nQ${altura},${paperMode === 'CONTINUOUS' ? 0 : mmDots(gapMm, dpi)}\n`
    const multiplicador = Math.max(1, Math.floor(escala))
    const fonteEpl = escalaFonte < 0.85 ? 1 : 3
    comandos += linhas.map((linha, i) => `A${xCentralizado(linha)},${margem + i * alturaLinha},0,${fonteEpl},${multiplicador},${multiplicador},N,"${linha.replaceAll('\\', ' ').replaceAll('"', "'")}"`).join('\n')
    comandos += `\nP${quantidade}\n`
  } else {
    return bytesEscPos(texto, { larguraMm, tamanhoFonte })
  }
  return Buffer.from(comandos, 'ascii')
}

function layoutDriver(texto, larguraMm, alturaMm, tamanhoFonte = 'normal') {
  const alturaFixa = Number(alturaMm) >= 10 ? Number(alturaMm) : null
  let escala = 1 / escalaDaFonte(tamanhoFonte)
  let ajustado
  let linhas
  for (;;) {
    const cpi = 10 * escala
    const colunas = Math.max(1, Math.floor(larguraMm * cpi / 25.4))
    ajustado = quebrarPorColunas(texto, colunas).trimEnd()
    linhas = Math.max(1, ajustado.split('\n').length)
    const necessaria = Math.max(10, (linhas + 1) * 25.4 / (6 * escala))
    if (alturaFixa === null) return { texto: ajustado, alturaMm: necessaria, cpi, lpi: 6 * escala, fontePt: 10 / escala }
    if (necessaria <= alturaFixa || escala >= 10) return { texto: ajustado, alturaMm: alturaFixa, cpi, lpi: 6 * escala, fontePt: 10 / escala }
    escala += 0.02
  }
}

async function imprimirRawAgora({ texto, copias = 1, cortar = true, alimentar, centralizar = false, larguraMm: larguraTrabalho }, printer) {
  const acabamento = config.acabamentosImpressoras?.[printer.name] || {}
  alimentar = Math.max(Number(alimentar) || 0, acabamento.feedLines ?? 3)
  cortar = cortar && acabamento.cutMode !== 'NONE'
  const cutMode = acabamento.cutMode || 'FULL'
  const paperMode = acabamento.paperMode || 'CONTINUOUS'
  const gapMm = acabamento.gapMm || 2
  const solicitada = Number(larguraTrabalho)
  const larguraMm = Number(config.largurasImpressoras?.[printer.name]) ||
    (Number.isFinite(solicitada) && solicitada >= 20 && solicitada <= 320 ? solicitada : 58)
  const alturaMm = Number(config.alturasImpressoras?.[printer.name]) || null
  const dpi = Number(config.dpisImpressoras?.[printer.name]) || 203
  const tamanhoFonte = config.fontesImpressoras?.[printer.name] || 'normal'
  const colunasNormal = config.colunasImpressoras?.[printer.name] || null
  const protocolo = config.protocolosImpressoras?.[printer.name] || (printer.raw || /RAW$/i.test(printer.name) ? 'ESC_POS' : 'DRIVER')
  const tipografia = config.tipografiasImpressoras?.[printer.name]
  if (tipografia) return printWithTypography({ BrowserWindow, fs, path, app, crypto, execute: executarArquivo, printer,
    text: texto, typography: tipografia, widthMm: larguraMm, heightMm: ['ESC_POS', 'DIEBOLD', 'ESC_BEMA', 'STAR_LINE'].includes(protocolo) ? null : alturaMm,
    dpi, centered: centralizar, protocol: protocolo, copies: Math.max(1, Math.min(20, Math.trunc(Number(copias) || 1))), feed: alimentar, cut: cortar, cutMode, paperMode, gapMm })
  const filaRaw = protocolo !== 'DRIVER'
  const cupomRaw = ['ESC_POS', 'DIEBOLD', 'ESC_BEMA', 'STAR_LINE'].includes(protocolo)
  const temporario = path.join(app.getPath('temp'), `simplexsa-job-${crypto.randomUUID()}.${filaRaw ? 'bin' : 'txt'}`)
  const layout = layoutDriver(texto, larguraMm, alturaMm, tamanhoFonte)
  const textoAjustado = filaRaw ? texto : layout.texto
  await fs.writeFile(temporario, filaRaw
    ? (cupomRaw
        ? (protocolo === 'DIEBOLD' ? bytesDiebold : protocolo === 'STAR_LINE' ? bytesStarLine : protocolo === 'ESC_BEMA' ? bytesBema : bytesEscPos)(textoAjustado, { alimentar, cortar, larguraMm, centralizar, tamanhoFonte, colunasNormal, cutMode })
        : bytesEtiqueta(protocolo, texto, { copias, larguraMm, alturaMm, dpi, centralizar, tamanhoFonte, paperMode, gapMm }))
    : textoAjustado + '\n', filaRaw ? undefined : 'utf8')
  try {
    const repeticoes = filaRaw && !cupomRaw ? 1 : Math.max(1, Number(copias) || 1)
    for (let copia = 0; copia < repeticoes; copia += 1) {
      if (process.platform === 'linux') {
        if (filaRaw) {
          await executarArquivo('lp', ['-d', printer.name, '-o', 'raw', temporario], { timeout: 15000 })
        } else {
          await executarArquivo('lp', [
            '-d', printer.name,
            '-o', `media=Custom.${larguraMm}x${layout.alturaMm.toFixed(2)}mm`,
            '-o', 'page-left=0', '-o', 'page-right=0', '-o', 'page-top=0', '-o', 'page-bottom=0',
            '-o', `cpi=${layout.cpi.toFixed(2)}`, '-o', `lpi=${layout.lpi.toFixed(2)}`, temporario,
          ], { timeout: 15000 })
        }
      } else if (process.platform === 'win32') {
        const script = filaRaw ? 'windows-raw.ps1' : 'windows-fit.ps1'
        const argumentos = [
          '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
          '-File', externalFilePath(path.join(__dirname, script)), '-PrinterName', printer.name, '-FilePath', temporario,
        ]
        if (script === 'windows-fit.ps1') argumentos.push('-WidthMm', String(larguraMm), '-HeightMm', String(layout.alturaMm), '-FontSizePt', String(layout.fontePt))
        await executarArquivo('powershell.exe', argumentos, { timeout: 15000, windowsHide: true })
      } else {
        throw new Error(`Impressao RAW ainda nao suportada em ${process.platform}`)
      }
    }
  } finally {
    await fs.unlink(temporario).catch(() => {})
  }
}

async function imprimirRaw(opcoes) {
  if (instalandoAtualizacao) throw new Error('Servidor reiniciando para atualizar. Aguarde a reabertura.')
  const printer = await resolverImpressora(opcoes.impressora)
  const chave = nomeComparavel(printer.name)
  const anterior = filasImpressao.get(chave) || Promise.resolve()
  const atual = anterior.catch(() => {}).then(() => imprimirRawAgora(opcoes, printer))
  filasImpressao.set(chave, atual)
  try {
    return await atual
  } finally {
    if (filasImpressao.get(chave) === atual) filasImpressao.delete(chave)
  }
}

async function executarJob(job) {
  if (job.tipo === 'html') throw new Error('Job HTML recusado: o deploy deve enviar somente texto para impressao termica')
  const etiquetaValidade = job.tipo === 'PRINT_LABEL' || /(^|\n)ABERTO:.*\nVENCE:.*\nTEMP:.*\nRESP:/i.test(job.conteudo || '')
  await imprimirRaw({ texto: job.conteudo, impressora: job.impressora, copias: job.copias, cortar: job.cortar, alimentar: job.alimentar, centralizar: etiquetaValidade, larguraMm: job.largura_mm })
}

async function confirmarJob(job, status, erro) {
  return api(`/gestor/jobs/${job.id}/status`, { token: config.token, lease_id: job.lease_id, status, erro })
}

function sincronizar() {
  if (!sincronizacaoAtual) sincronizacaoAtual = sincronizarAgora().finally(() => { sincronizacaoAtual = null })
  return sincronizacaoAtual
}

async function desconectar({ tolerarFalhaRemota = false } = {}) {
  if (!config) return
  await salvarConfig({ ...config, conectado: false })
  // Termina os trabalhos já recebidos antes de liberar a sessão.
  await sincronizacaoAtual
  try {
    await api('/gestor/disconnect', { token: config.token })
  } catch (error) {
    if (!tolerarFalhaRemota) throw error
  } finally {
    ultimoContato = null
    sessaoId = crypto.randomUUID()
    notificarStatus()
  }
  return statusAtual()
}

async function sincronizarAgora() {
  if (instalandoAtualizacao || sincronizando || !config?.conectado || !config?.token || !config?.deployUrl) return
  sincronizando = true
  try {
    await registrar()
    const resposta = await api('/gestor/pull', { token: config.token, limit: 1 })
    ultimoContato = new Date().toISOString()
    ultimoErro = ''
    notificarStatus()
    for (const job of resposta.jobs || []) {
      let renewal
      try {
        const reservation = await confirmarJob(job, 'processando')
        if (reservation?.duplicate) continue
        renewal = setInterval(() => confirmarJob(job, 'processando').catch(() => {}), 30000)
        const journal = new JobJournal(path.join(app.getPath('userData'), 'print-journal'))
        const result = await journal.execute(`${config.deployUrl}:${config.token}`, job, executarJob)
        clearInterval(renewal)
        await confirmarJob(job, result.status, result.erro)
        ultimoJob = { id: job.id, impressora: job.impressora || config.impressoraPadrao || 'padrao', status: result.status, erro: result.erro, em: new Date().toISOString() }
      } catch (erro) {
        // Uma falha de confirmação não é uma falha da impressora. A reserva
        // expira e o diário local permite confirmar novamente sem reimprimir.
        ultimoErro = `Confirmação pendente: ${erro.message}`
        ultimoJob = { id: job.id, impressora: job.impressora || '-', status: 'pendente', erro: erro.message, em: new Date().toISOString() }
      } finally {
        clearInterval(renewal)
      }
      notificarStatus()
    }
    // Drena a fila sem acrescentar três segundos de espera a cada pedido.
    if (resposta.jobs?.length) setTimeout(() => sincronizar(), 0)
  } catch (erro) {
    ultimoErro = erro.message || String(erro)
    notificarStatus()
  } finally {
    sincronizando = false
  }
}

async function listarImpressoras(force = false) {
  return descobrirImpressoras({ force })
}

function responderJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': res.origemPermitida || 'null',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  })
  res.end(JSON.stringify(data))
}

function origemLocalPermitida(req) {
  const origem = req.headers.origin
  if (!origem) return true
  try {
    const url = new URL(origem)
    const deploy = new URL(config.deployUrl)
    return url.origin === deploy.origin || ['127.0.0.1', 'localhost'].includes(url.hostname)
  } catch {
    return false
  }
}

function iniciarServidorLocal() {
  servidorLocal = http.createServer(async (req, res) => {
    res.origemPermitida = req.headers.origin || 'null'
    if (!origemLocalPermitida(req)) return responderJson(res, 403, { error: 'Origem nao autorizada' })
    if (req.method === 'OPTIONS') return responderJson(res, 204, {})
    if (req.method === 'GET' && req.url === '/health') return responderJson(res, 200, { ok: true, version: app.getVersion() })
    if (req.method === 'GET' && req.url === '/nfc') {
      return responderJson(res, 200, { ativo: !!config?.nfcAtivo, prefixo: config?.nfcPrefixo || PREFIXO_PADRAO, ultimo: ultimoNfc })
    }
    if (req.method === 'POST' && req.url === '/nfc') {
      try {
        const body = await lerJsonLimitado(req, 4096)
        return responderJson(res, 200, await publicarLeituraNfc(body.text || ''))
      } catch (erro) {
        return responderJson(res, 400, { ok: false, error: erro.message })
      }
    }
    if (req.method === 'GET' && req.url === '/printers') {
      try {
        const printers = await listarImpressoras(true)
        return responderJson(res, 200, { printers })
      } catch (erro) {
        return responderJson(res, 503, { error: erro.message })
      }
    }
    if (req.method === 'POST' && req.url === '/print') {
      try {
        const partes = []
        let total = 0
        for await (const parte of req) {
          total += parte.length
          if (total > 10 * 1024 * 1024) throw new Error('Conteudo excede 10 MB')
          partes.push(parte)
        }
        const body = JSON.parse(Buffer.concat(partes).toString('utf8'))
        if (body.html) throw new Error('HTML nao e aceito; envie o campo text')
        await imprimirRaw({ texto: body.text || '', impressora: body.printer, copias: body.copies, cortar: body.cut, alimentar: body.feed, larguraMm: body.width })
        return responderJson(res, 200, { ok: true })
      } catch (erro) {
        return responderJson(res, 500, { ok: false, error: erro.message })
      }
    }
    responderJson(res, 404, { error: 'Rota nao encontrada' })
  })
  servidorLocal.on('error', (erro) => {
    ultimoErro = erro.code === 'EADDRINUSE'
      ? `A porta ${PORTA_LOCAL} já está sendo usada. Feche a outra instância do Gestor e abra novamente.`
      : `Servidor local: ${erro.message}`
    servidorLocal = null
    notificarStatus()
  })
  servidorLocal.listen(PORTA_LOCAL, '127.0.0.1')
}

function criarJanela() {
  janela = new BrowserWindow({
    width: 860,
    height: 700,
    minWidth: 700,
    minHeight: 580,
    title: 'Servidor DoixP',
    icon: path.join(__dirname, 'doixp-logo.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
  })
  janela.loadFile(path.join(__dirname, 'index.html'))
  janela.on('close', (event) => {
    if (encerrando) return
    event.preventDefault()
    janela.hide()
  })
}

function criarTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'doixp-logo.png')).resize({ width: 18, height: 18 })
  tray = new Tray(icon)
  tray.setToolTip('Servidor DoixP')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir Servidor DoixP', click: () => janela.show() },
    { type: 'separator' },
    { label: 'Sincronizar agora', click: sincronizar },
    { label: 'Sair', click: () => app.quit() },
  ]))
  tray.on('double-click', () => janela.show())
}

ipcMain.handle('status', () => statusAtual())
ipcMain.handle('salvar-config', async (_e, value) => {
  if (String(value.deployUrl || '').replace(/\/$/, '') !== config.deployUrl) await desconectar()
  await sincronizacaoAtual
  await salvarConfig({ ...value, conectado: true })
  await sincronizar()
  return statusAtual()
})
ipcMain.handle('desconectar', desconectar)
ipcMain.handle('listar-perfis-impressoras', () => require('./catalog/printer-profiles.json').profiles)
ipcMain.handle('listar-impressoras', () => listarImpressoras(true))
ipcMain.handle('testar-impressora', async (_e, impressora) => {
  await imprimirRaw({ texto: 'DOIXP - TESTE DE IMPRESSAO\nGarcom | File | Limao | Acai\n\nConexao OK', impressora })
  return { ok: true }
})
ipcMain.handle('salvar-impressora', async (_e, value) => {
  const acabamento = normalizarAcabamento(value?.acabamento)
  const impressora = String(value?.impressora || '').trim()
  const larguraMm = Number(value?.larguraMm)
  const alturaMm = value?.alturaMm === null || value?.alturaMm === '' || value?.alturaMm === undefined ? null : Number(value.alturaMm)
  const dpi = Number(value?.dpi)
  const tamanhoFonte = value?.tamanhoFonte ?? 'normal'
  const tipografia = value?.tipografia == null ? config.tipografiasImpressoras?.[impressora] : require('./typography.cjs').normalizeTypography(value.tipografia)
  if (tipografia?.printableWidthMm > larguraMm) throw new Error('Largura imprimível não pode superar a largura do papel')
  const colunasNormal = value?.colunasNormal == null || value.colunasNormal === '' ? null : Number(value.colunasNormal)
  if (colunasNormal !== null && (!Number.isInteger(colunasNormal) || colunasNormal < 8 || colunasNormal > 160)) throw new Error('Colunas devem estar entre 8 e 160 ou vazias para automático')
  if (!['small', 'normal', 'large'].includes(tamanhoFonte)) throw new Error('Tamanho da fonte inválido')
  const protocolo = String(value?.protocolo || 'DRIVER').toUpperCase()
  if (!impressora) throw new Error('Selecione uma impressora')
  if (!Number.isFinite(larguraMm) || larguraMm < 20 || larguraMm > 320) throw new Error('Largura deve estar entre 20 e 320 mm')
  if (alturaMm !== null && (!Number.isFinite(alturaMm) || alturaMm < 10 || alturaMm > 500)) throw new Error('Altura deve estar entre 10 e 500 mm')
  if (!Number.isInteger(dpi) || dpi < 100 || dpi > 1200) throw new Error('DPI deve estar entre 100 e 1200')
  if (!['DRIVER', 'ESC_POS', 'DIEBOLD', 'ESC_BEMA', 'STAR_LINE', 'TSPL', 'ZPL', 'CPCL', 'EPL'].includes(protocolo)) throw new Error('Protocolo inválido')
  return salvarConfig({
    ...config,
    largurasImpressoras: { ...config.largurasImpressoras, [impressora]: larguraMm },
    alturasImpressoras: { ...config.alturasImpressoras, [impressora]: alturaMm },
    dpisImpressoras: { ...config.dpisImpressoras, [impressora]: dpi },
    fontesImpressoras: { ...config.fontesImpressoras, [impressora]: tamanhoFonte },
    tipografiasImpressoras: { ...config.tipografiasImpressoras, ...(tipografia ? { [impressora]: tipografia } : {}) },
    colunasImpressoras: { ...config.colunasImpressoras, [impressora]: colunasNormal },
    protocolosImpressoras: { ...config.protocolosImpressoras, [impressora]: protocolo },
    acabamentosImpressoras: { ...config.acabamentosImpressoras, [impressora]: acabamento },
  })
})
ipcMain.handle('abrir-externamente', (_e, url) => shell.openExternal(url))
ipcMain.handle('ler-nfc', (_e, texto) => publicarLeituraNfc(texto))

const updates = createUpdates({
  updater: autoUpdater,
  supported: () => app.isPackaged && (process.platform === 'win32' || (process.platform === 'linux' && !!process.env.APPIMAGE)),
  notify: (state) => {
    if (janela && !janela.isDestroyed()) janela.webContents.send('atualizacao-status', state)
  },
  prepareInstall: async () => {
    // Aguarda também impressões manuais/API local e mantém token, filas e diário.
    const reconectar = config.conectado
    reconectarAposAtualizacao = reconectar
    // Impede novas consultas; os trabalhos já recebidos ainda podem imprimir.
    clearInterval(timer)
    await desconectar({ tolerarFalhaRemota: true })
    instalandoAtualizacao = true
    await Promise.allSettled([...filasImpressao.values()])
    await salvarConfig({ ...config, conectado: reconectar })
    encerrando = true
  },
  recoverInstall: async () => {
    encerrando = false
    instalandoAtualizacao = false
    if (reconectarAposAtualizacao !== undefined) {
      await salvarConfig({ ...config, conectado: reconectarAposAtualizacao })
      reconectarAposAtualizacao = undefined
    }
    clearInterval(timer)
    timer = setInterval(sincronizar, INTERVALO_POLL)
    sincronizar()
  },
})
ipcMain.handle('atualizacao-status', () => updates.status())
ipcMain.handle('atualizar-servidor', () => updates.action())

if (instanciaUnica) {
  app.whenReady().then(async () => {
    await carregarConfig()
    criarJanela()
    criarTray()
    iniciarServidorLocal()
    void updates.check()
    heartbeatTimer = setInterval(() => {
      if ((config?.conectado || sincronizando) && ultimoContato) api('/gestor/heartbeat', { token: config.token, nfc: estadoNfc() }).catch(() => {})
    }, 20_000)
    await sincronizar()
    timer = setInterval(sincronizar, INTERVALO_POLL)
  }).catch((erro) => {
    dialog.showErrorBox('Não foi possível abrir o Servidor DoixP', erro?.message || String(erro))
    app.quit()
  })
}

app.on('window-all-closed', () => {
  // O gestor permanece ativo na bandeja para continuar sincronizando.
})

app.on('activate', () => janela?.show())
app.on('before-quit', (event) => {
  if (encerrando) return
  event.preventDefault()
  if (fechando) return
  fechando = true
  clearInterval(timer)
  servidorLocal?.close()
  // Fechar o app libera a sessão, mas preserva a preferência de conectar ao abrir.
  const reconectar = config?.conectado
  desconectar().catch(() => {}).finally(async () => {
    clearInterval(heartbeatTimer)
    if (config) await salvarConfig({ ...config, conectado: reconectar }).catch(() => {})
    encerrando = true
    app.quit()
  })
})
