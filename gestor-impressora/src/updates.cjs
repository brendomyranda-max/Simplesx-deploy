// Electron-updater valida o checksum dos instaladores publicados pelo nosso feed.
function createUpdates({ updater, supported, prepareInstall, recoverInstall = async () => {}, notify }) {
  let state = { phase: 'idle', message: 'Atualize para baixar, instalar e reabrir o servidor. As configurações são preservadas.' }
  let busy = false
  let installation = null
  function change(phase, message, extra = {}) {
    state = { phase, message, ...extra }
    notify(state)
    return state
  }
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.allowDowngrade = false
  updater.disableDifferentialDownload = true
  async function failed(error) {
    if (state.phase === 'installing') await recoverInstall()
    return change('error', `Não foi possível atualizar. ${error?.message || 'Confira a internet e tente novamente.'}`)
  }
  updater.on('error', (error) => { failed(error).catch(() => change('error', 'Falha na instalação. Reabra o servidor e tente novamente.')) })
  updater.on('update-available', (info) => change('available', `Versão ${info.version} disponível.`, { version: info.version }))
  updater.on('update-not-available', () => change('current', 'O servidor já está atualizado.'))
  updater.on('download-progress', (progress) => change('downloading', `Baixando atualização: ${Math.round(progress.percent)}%`, { percent: progress.percent }))
  updater.on('update-downloaded', (info) => {
    if (state.phase === 'installing') return
    change('downloaded', `Versão ${info.version} baixada. Preparando a instalação…`, { version: info.version })
    // Algumas plataformas notificam depois que downloadUpdate já retornou.
    // O download concluído deve iniciar a instalação também nesse caso.
    if (!busy) void installDownloaded()
  })

  function installDownloaded() {
    if (installation) return installation
    if (state.phase !== 'downloaded') return Promise.resolve(state)
    installation = (async () => {
      try {
        change('installing', 'Finalizando impressões em andamento e reiniciando…', { version: state.version })
        await prepareInstall()
        updater.quitAndInstall(true, true)
      } catch (error) { await failed(error) }
      return state
    })().finally(() => { installation = null })
    return installation
  }

  async function action() {
    if (busy || state.phase === 'installing') return state
    if (!supported()) return change('unsupported', 'Use o aplicativo instalado no Windows ou o arquivo AppImage no Linux para atualizar por aqui.')
    busy = true
    try {
      if (!['available', 'downloaded'].includes(state.phase)) {
        change('checking', 'Buscando atualizações…')
        await updater.checkForUpdates()
      }
      if (state.phase === 'available') {
        change('downloading', 'Iniciando download…')
        await updater.downloadUpdate()
      }
      if (state.phase === 'downloaded') await installDownloaded()
    } catch (error) {
      await failed(error)
    } finally { busy = false }
    return state
  }
  return { status: () => state, action }
}

module.exports = { createUpdates }
