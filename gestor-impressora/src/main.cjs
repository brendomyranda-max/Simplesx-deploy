const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage } = require('electron')
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
  config = {
    ...config,
    deployUrl: String(novaConfig.deployUrl || DEPLOY_PADRAO).trim().replace(/\/$/, ''),
    token: String(novaConfig.token || config?.token || '').trim(),
    nome: String(novaConfig.nome || `Gestor ${os.hostname()}`).trim(),
    impressoraPadrao: String(novaConfig.impressoraPadrao || ''),
    iniciarComSistema: novaConfig.iniciarComSistema !== false,
  }
  await fs.mkdir(path.dirname(arquivoConfig()), { recursive: true })
  await fs.writeFile(arquivoConfig(), JSON.stringify(config, null, 2), 'utf8')
  app.setLoginItemSettings({ openAtLogin: config.iniciarComSistema, openAsHidden: true })
  ultimoErro = ''
  notificarStatus()
  return statusAtual()
}

function statusAtual() {
  return {
    ...config,
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
  const data = await resposta.json().catch(() => ({}))
  if (!resposta.ok) throw new Error(data.error || `Servidor respondeu ${resposta.status}`)
  return data
}

async function registrar() {
  await api('/gestor/register', { token: config.token, nome: config.nome, ip: os.hostname() })
}

function documentoTexto(texto) {
  const seguro = String(texto)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return `<!doctype html><html><head><meta charset="UTF-8"><style>@page{margin:0}body{margin:0;padding:2mm;font:11px/1.35 "DejaVu Sans Mono","Courier New",monospace}pre{margin:0;white-space:pre-wrap}</style></head><body><pre>${seguro}</pre></body></html>`
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

async function aguardarRenderizacao(webContents) {
  await webContents.executeJavaScript(`new Promise((resolve) => {
    const pronto = () => requestAnimationFrame(() => requestAnimationFrame(resolve));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(pronto, pronto);
    else pronto();
  })`)
}

async function imprimirHtml({ html, impressora, larguraMm = 80, copias = 1 }) {
  const printer = await resolverImpressora(impressora)
  const larguraPapelMm = Number(larguraMm) === 58 ? 58 : 80
  const temporario = path.join(app.getPath('temp'), `simplesx-job-${crypto.randomUUID()}.html`)
  await fs.writeFile(temporario, html, 'utf8')
  const printWindow = new BrowserWindow({
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: { sandbox: true, backgroundThrottling: false },
  })
  try {
    await printWindow.loadFile(temporario)
    await aguardarRenderizacao(printWindow.webContents)
    const temConteudoVisivel = await printWindow.webContents.executeJavaScript(
      `document.body && document.body.innerText.trim().length > 0`,
    )
    if (!temConteudoVisivel) throw new Error('O documento de impressao ficou vazio antes de chegar ao driver')
    const alturaConteudoPx = await printWindow.webContents.executeJavaScript(
      `Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)`,
    )
    // O Electron espera dimensoes em microns. Sem pageSize, a impressao
    // silenciosa usa o papel padrao do driver (frequentemente A4) e reduz o
    // cupom termico. A altura acompanha o documento para nao gerar papel vazio.
    const alturaPapelMicrons = Math.max(10_000, Math.ceil(Number(alturaConteudoPx) * 264.583))
    await new Promise((resolve, reject) => {
      printWindow.webContents.print({
        silent: true,
        printBackground: true,
        // Electron exige o nome interno retornado por getPrintersAsync, nao o
        // nome amigavel mostrado pelo painel de impressoras do Windows.
        deviceName: printer.name,
        pageSize: { width: larguraPapelMm * 1000, height: alturaPapelMicrons },
        scaleFactor: 100,
        copies: Math.max(1, Number(copias) || 1),
        margins: { marginType: 'none' },
      }, (sucesso, motivo) => sucesso ? resolve() : reject(new Error(motivo || 'Falha ao imprimir')))
    })
  } finally {
    if (!printWindow.isDestroyed()) printWindow.destroy()
    await fs.unlink(temporario).catch(() => {})
  }
}

async function executarJob(job) {
  const html = job.tipo === 'html' ? String(job.conteudo) : documentoTexto(job.conteudo)
  await imprimirHtml({ html, impressora: job.impressora, larguraMm: job.largura_mm, copias: job.copias })
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
  const printers = await impressorasInstaladas()
  return printers.map((p) => ({
    name: p.name,
    displayName: p.displayName,
    description: p.description,
    status: p.status,
    state: 'disponivel',
    enabled: true,
    accepting: true,
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
        await imprimirHtml({ html: body.html || documentoTexto(body.text || ''), impressora: body.printer, copias: body.copies })
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
  await imprimirHtml({ html: documentoTexto('SIMPLESX - TESTE DE IMPRESSAO\nGarcom | File | Limao | Acai\n\nConexao OK'), impressora })
  return { ok: true }
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
