const { app, BrowserWindow, dialog, ipcMain, shell, Tray, Menu, nativeImage } = require('electron')
const crypto = require('node:crypto')
const { execFile } = require('node:child_process')
const fs = require('node:fs/promises')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')

const executarArquivo = promisify(execFile)

const PORTA_LOCAL = 8410
const INTERVALO_POLL = 3000
const DEPLOY_PADRAO = 'https://simplesx-projeto-beta.pages.dev'

let janela
let tray
let encerrando = false
let config
let timer
let sincronizando = false
let servidorLocal
let ultimoErro = ''
let ultimoContato = null
let ultimoJob = null
const filasImpressao = new Map()

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
    nome: `Gestor ${os.hostname()}`,
    impressoraPadrao: '',
    largurasImpressoras: {},
    dpisImpressoras: {},
    protocolosImpressoras: {},
    iniciarComSistema: true,
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
  config = {
    ...config,
    deployUrl,
    token: String(novaConfig.token || config?.token || '').trim(),
    nome: String(novaConfig.nome || `Gestor ${os.hostname()}`).trim(),
    impressoraPadrao: String(novaConfig.impressoraPadrao || ''),
    largurasImpressoras: normalizarLarguras(novaConfig.largurasImpressoras || config?.largurasImpressoras),
    dpisImpressoras: normalizarDpis(novaConfig.dpisImpressoras || config?.dpisImpressoras),
    protocolosImpressoras: normalizarProtocolos(novaConfig.protocolosImpressoras || config?.protocolosImpressoras),
    iniciarComSistema: novaConfig.iniciarComSistema !== false,
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

function normalizarProtocolos(value) {
  const permitidos = new Set(['DRIVER', 'ESC_POS', 'TSPL', 'ZPL', 'CPCL', 'EPL'])
  const result = {}
  if (!value || typeof value !== 'object') return result
  for (const [nome, protocolo] of Object.entries(value)) {
    const normalizado = String(protocolo || '').toUpperCase()
    if (nome && permitidos.has(normalizado)) result[nome] = normalizado
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
    online: !!ultimoContato && Date.now() - new Date(ultimoContato).getTime() < 15000,
    ultimoContato,
    ultimoJob,
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
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
  const contentType = resposta.headers.get('content-type') || ''
  const data = contentType.includes('application/json') ? await resposta.json().catch(() => ({})) : {}
  if (!contentType.includes('application/json')) {
    throw new Error(`Endereço não é um servidor SimplesX (resposta ${resposta.status})`)
  }
  if (!resposta.ok) throw new Error(data.error || `Servidor respondeu ${resposta.status}`)
  return data
}

async function registrar() {
  const printers = await listarImpressoras()
  await api('/gestor/register', { token: config.token, nome: config.nome, ip: os.hostname(), printers })
}

async function filasCupsDisponiveis() {
  if (process.platform !== 'linux') return null
  try {
    const opcoes = { env: { ...process.env, LC_ALL: 'C' }, timeout: 5000 }
    const [{ stdout: estado }, { stdout: aceitando }] = await Promise.all([
      executarArquivo('lpstat', ['-p'], opcoes),
      executarArquivo('lpstat', ['-a'], opcoes),
    ])
    const habilitadas = new Set()
    for (const linha of estado.split('\n')) {
      const match = linha.match(/^printer\s+(\S+)\s+/)
      if (match && !/\bdisabled\b/i.test(linha)) habilitadas.add(match[1])
    }
    const aceitas = new Set()
    for (const linha of aceitando.split('\n')) {
      const match = linha.match(/^(\S+)\s+accepting requests/i)
      if (match) aceitas.add(match[1])
    }
    return new Set([...habilitadas].filter((nome) => aceitas.has(nome)))
  } catch (erro) {
    throw new Error(`CUPS indisponível: ${erro.stderr?.trim() || erro.message}`)
  }
}

async function impressorasInstaladas() {
  if (!janela || janela.isDestroyed()) return []
  const printers = await janela.webContents.getPrintersAsync()
  const cups = await filasCupsDisponiveis()
  if (!cups) return printers
  return printers.filter((printer) => cups.has(printer.name))
}

function nomeComparavel(value) {
  return String(value || '').trim().toLocaleLowerCase('pt-BR')
}

async function resolverImpressora(nomeSolicitado) {
  const printers = await impressorasInstaladas()
  if (!printers.length) throw new Error('Nenhuma impressora instalada foi encontrada pelo Windows/Linux')

  const solicitado = String(nomeSolicitado || '').trim()
  const configurado = String(config.impressoraPadrao || '').trim()
  for (const candidato of [solicitado, configurado]) {
    if (!candidato) continue
    const chave = nomeComparavel(candidato)
    const printer = printers.find((p) =>
      nomeComparavel(p.name) === chave || nomeComparavel(p.displayName) === chave)
    if (printer) return printer
    if (candidato === solicitado && solicitado) {
      throw new Error(`A impressora "${solicitado}" não está disponível neste computador`)
    }
  }

  // Sem destino solicitado, usa somente uma fila local confirmada como ativa.
  return printers.find((p) => p.isDefault) || printers[0]
}

function quebrarPorLargura(texto, larguraMm) {
  const colunas = Math.max(8, Math.floor((Number(larguraMm) || 58) * 32 / 58))
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

function bytesEscPos(texto, { alimentar = 0, cortar = true, larguraMm = 58, centralizar = false } = {}) {
  const normalizado = quebrarPorLargura(texto, larguraMm)
    .replace(/\r\n?/g, '\n')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replaceAll('º', 'o').replaceAll('ª', 'a')
    .replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '')
    .trimEnd()
  const partes = [Buffer.from([0x1b, 0x40])]
  if (centralizar) partes.push(Buffer.from([0x1b, 0x61, 0x01]))
  partes.push(Buffer.from(normalizado + '\n', 'ascii'))
  if (centralizar) partes.push(Buffer.from([0x1b, 0x61, 0x00]))
  if (alimentar > 0) partes.push(Buffer.from([0x1b, 0x64, Math.min(255, Number(alimentar) || 0)]))
  if (cortar) partes.push(Buffer.from([0x1d, 0x56, 0x00]))
  return Buffer.concat(partes)
}

function textoAscii(texto) {
  return String(texto || '').replace(/\r\n?/g, '\n').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replaceAll('º', 'o').replaceAll('ª', 'a')
    .replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/[^\x09\x0A\x20-\x7E]/g, '').trimEnd()
}

function linhasEtiqueta(texto, larguraMm) {
  return quebrarPorLargura(textoAscii(texto), larguraMm).split('\n')
}

function mmDots(mm, dpi = 203) { return Math.max(0, Math.round(Number(mm || 0) * Number(dpi || 203) / 25.4)) }

function bytesEtiqueta(protocolo, texto, { copias = 1, larguraMm = 58, dpi = 203, centralizar = false } = {}) {
  const linhas = linhasEtiqueta(texto, larguraMm)
  const escala = dpi / 203
  const margem = Math.max(8, Math.round(16 * escala))
  const alturaLinha = Math.max(14, Math.round(28 * escala))
  const fonte = Math.max(12, Math.round(24 * escala))
  const largura = mmDots(larguraMm, dpi)
  const altura = Math.max(80, Math.round((32 + linhas.length * 28) * escala))
  const quantidade = Math.min(20, Math.max(1, Number(copias) || 1))
  const xCentralizado = (linha, larguraCaractere = 12) => centralizar
    ? Math.max(margem, Math.round((largura - linha.length * larguraCaractere * escala) / 2))
    : Math.round(8 * escala)
  let comandos
  if (protocolo === 'TSPL') {
    comandos = `SIZE ${larguraMm} mm,${Math.ceil(altura / (dpi / 25.4))} mm\r\nGAP 0 mm,0 mm\r\nDIRECTION 1\r\nCLS\r\n`
    comandos += linhas.map((linha, i) => `TEXT ${xCentralizado(linha)},${margem + i * alturaLinha},"0",0,1,1,"${linha.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join('\r\n')
    comandos += `\r\nPRINT ${quantidade},1\r\n`
  } else if (protocolo === 'ZPL') {
    comandos = `^XA\n^PW${largura}\n^LL${altura}\n^LH0,0\n`
    comandos += linhas.map((linha, i) => centralizar
      ? `^FO0,${margem + i * alturaLinha}^FB${largura},1,0,C,0^A0N,${fonte},${fonte}^FD${linha.replace(/[\^~]/g, ' ')}^FS`
      : `^FO${margem},${margem + i * alturaLinha}^A0N,${fonte},${fonte}^FD${linha.replace(/[\^~]/g, ' ')}^FS`).join('\n')
    comandos += `\n^PQ${quantidade}\n^XZ\n`
  } else if (protocolo === 'CPCL') {
    comandos = `! 0 ${dpi} ${dpi} ${altura} ${quantidade}\r\nPW ${largura}\r\n`
    comandos += linhas.map((linha, i) => `TEXT 0 2 ${xCentralizado(linha)} ${margem + i * alturaLinha} ${linha}`).join('\r\n')
    comandos += '\r\nFORM\r\nPRINT\r\n'
  } else if (protocolo === 'EPL') {
    comandos = `N\nq${largura}\nQ${altura},0\n`
    comandos += linhas.map((linha, i) => `A${xCentralizado(linha)},${margem + i * alturaLinha},0,3,1,1,N,"${linha.replaceAll('\\', ' ').replaceAll('"', "'")}"`).join('\n')
    comandos += `\nP${quantidade}\n`
  } else {
    return bytesEscPos(texto, { larguraMm })
  }
  return Buffer.from(comandos, 'ascii')
}

async function imprimirRawAgora({ texto, copias = 1, cortar = true, alimentar = 0, centralizar = false }, printer) {
  const larguraMm = Number(config.largurasImpressoras?.[printer.name]) || 58
  const dpi = Number(config.dpisImpressoras?.[printer.name]) || 203
  const protocolo = config.protocolosImpressoras?.[printer.name] || (/RAW$/i.test(printer.name) ? 'ESC_POS' : 'DRIVER')
  const filaRaw = protocolo !== 'DRIVER'
  const temporario = path.join(app.getPath('temp'), `simplesx-job-${crypto.randomUUID()}.${filaRaw ? 'bin' : 'txt'}`)
  const textoAjustado = quebrarPorLargura(texto, larguraMm).trimEnd()
  await fs.writeFile(temporario, filaRaw
    ? (protocolo === 'ESC_POS'
        ? bytesEscPos(textoAjustado, { alimentar, cortar, larguraMm, centralizar })
        : bytesEtiqueta(protocolo, textoAjustado, { copias, larguraMm, dpi, centralizar }))
    : textoAjustado + '\n', filaRaw ? undefined : 'utf8')
  try {
    const repeticoes = filaRaw && protocolo !== 'ESC_POS' ? 1 : Math.max(1, Number(copias) || 1)
    for (let copia = 0; copia < repeticoes; copia += 1) {
      if (process.platform === 'linux') {
        if (filaRaw) {
          await executarArquivo('lp', ['-d', printer.name, '-o', 'raw', temporario], { timeout: 15000 })
        } else {
          const linhas = Math.max(1, textoAjustado.split('\n').length)
          const alturaMm = Math.max(10, (linhas + 1) * (25.4 / 6)).toFixed(2)
          await executarArquivo('lp', [
            '-d', printer.name,
            '-o', `media=Custom.${larguraMm}x${alturaMm}mm`,
            '-o', 'page-left=0', '-o', 'page-right=0', '-o', 'page-top=0', '-o', 'page-bottom=0',
            '-o', 'cpi=10', '-o', 'lpi=6', temporario,
          ], { timeout: 15000 })
        }
      } else if (process.platform === 'win32') {
        await executarArquivo('powershell.exe', [
          '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
          '-File', path.join(__dirname, 'windows-raw.ps1'), '-PrinterName', printer.name, '-FilePath', temporario,
        ], { timeout: 15000, windowsHide: true })
      } else {
        throw new Error(`Impressao RAW ainda nao suportada em ${process.platform}`)
      }
    }
  } finally {
    await fs.unlink(temporario).catch(() => {})
  }
}

async function imprimirRaw(opcoes) {
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
  await imprimirRaw({ texto: job.conteudo, impressora: job.impressora, copias: job.copias, cortar: job.cortar, alimentar: job.alimentar, centralizar: etiquetaValidade })
}

async function confirmarJob(job, status, erro) {
  await api(`/gestor/jobs/${job.id}/status`, { token: config.token, status, erro })
}

async function sincronizar() {
  if (sincronizando || !config?.token || !config?.deployUrl) return
  sincronizando = true
  try {
    await registrar()
    const resposta = await api('/gestor/pull', { token: config.token })
    ultimoContato = new Date().toISOString()
    ultimoErro = ''
    notificarStatus()
    for (const job of resposta.jobs || []) {
      try {
        await executarJob(job)
        await confirmarJob(job, 'feito')
        ultimoJob = { id: job.id, impressora: job.impressora || config.impressoraPadrao || 'padrao', status: 'feito', em: new Date().toISOString() }
      } catch (erro) {
        await confirmarJob(job, 'erro', erro.message).catch(() => {})
        ultimoJob = { id: job.id, impressora: job.impressora || '-', status: 'erro', erro: erro.message, em: new Date().toISOString() }
      }
      notificarStatus()
    }
  } catch (erro) {
    ultimoErro = erro.message || String(erro)
    notificarStatus()
  } finally {
    sincronizando = false
  }
}

async function listarImpressoras() {
  if (!janela || janela.isDestroyed()) return []
  const printers = await janela.webContents.getPrintersAsync()
  const cups = await filasCupsDisponiveis()
  return printers.map((p) => ({
    name: p.name,
    displayName: p.displayName,
    description: p.description,
    status: p.status,
    state: !cups || cups.has(p.name) ? 'disponivel' : 'indisponivel',
    enabled: !cups || cups.has(p.name),
    accepting: !cups || cups.has(p.name),
    isDefault: p.isDefault,
  }))
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
    if (req.method === 'GET' && req.url === '/printers') {
      const printers = await listarImpressoras()
      return responderJson(res, 200, { printers })
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
        await imprimirRaw({ texto: body.text || '', impressora: body.printer, copias: body.copies, cortar: body.cut, alimentar: body.feed })
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
    title: 'SimplesX Gestor de Impressoras',
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
  const icon = nativeImage.createFromPath(path.join(__dirname, 'tray.svg')).resize({ width: 18, height: 18 })
  tray = new Tray(icon)
  tray.setToolTip('SimplesX Gestor de Impressoras')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir SimplesX Gestor', click: () => janela.show() },
    { type: 'separator' },
    { label: 'Sincronizar agora', click: sincronizar },
    { label: 'Sair', click: () => { encerrando = true; app.quit() } },
  ]))
  tray.on('double-click', () => janela.show())
}

ipcMain.handle('status', () => statusAtual())
ipcMain.handle('salvar-config', async (_e, value) => salvarConfig(value))
ipcMain.handle('listar-impressoras', listarImpressoras)
ipcMain.handle('testar-impressora', async (_e, impressora) => {
  await imprimirRaw({ texto: 'SIMPLESX - TESTE DE IMPRESSAO\nGarcom | File | Limao | Acai\n\nConexao OK', impressora, alimentar: 3, cortar: true })
  return { ok: true }
})
ipcMain.handle('salvar-impressora', async (_e, value) => {
  const impressora = String(value?.impressora || '').trim()
  const larguraMm = Number(value?.larguraMm)
  const dpi = Number(value?.dpi)
  const protocolo = String(value?.protocolo || 'DRIVER').toUpperCase()
  if (!impressora) throw new Error('Selecione uma impressora')
  if (!Number.isFinite(larguraMm) || larguraMm < 20 || larguraMm > 320) throw new Error('Largura deve estar entre 20 e 320 mm')
  if (!Number.isInteger(dpi) || dpi < 100 || dpi > 1200) throw new Error('DPI deve estar entre 100 e 1200')
  if (!['DRIVER', 'ESC_POS', 'TSPL', 'ZPL', 'CPCL', 'EPL'].includes(protocolo)) throw new Error('Protocolo inválido')
  return salvarConfig({
    ...config,
    largurasImpressoras: { ...config.largurasImpressoras, [impressora]: larguraMm },
    dpisImpressoras: { ...config.dpisImpressoras, [impressora]: dpi },
    protocolosImpressoras: { ...config.protocolosImpressoras, [impressora]: protocolo },
  })
})
ipcMain.handle('abrir-externamente', (_e, url) => shell.openExternal(url))

if (instanciaUnica) {
  app.whenReady().then(async () => {
    await carregarConfig()
    criarJanela()
    criarTray()
    iniciarServidorLocal()
    await sincronizar()
    timer = setInterval(sincronizar, INTERVALO_POLL)
  }).catch((erro) => {
    dialog.showErrorBox('Não foi possível abrir o SimplesX Gestor', erro?.message || String(erro))
    app.quit()
  })
}

app.on('window-all-closed', () => {
  // O gestor permanece ativo na bandeja para continuar sincronizando.
})

app.on('activate', () => janela?.show())
app.on('before-quit', () => {
  encerrando = true
  clearInterval(timer)
  servidorLocal?.close()
})
