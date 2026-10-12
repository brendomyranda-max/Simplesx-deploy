// Electron-updater valida o checksum dos instaladores publicados pelo nosso feed.
function createUpdates({ updater, supported, prepareInstall, recoverInstall = async () => {}, notify }) {
  let state = { phase: 'idle', message: 'Busque uma nova versão sem desinstalar o servidor.' }
  let busy = false
  function change(phase, message, extra = {}) {
    state = { phase, message, ...extra }
    notify(state)
    return state
  }
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.allowDowngrade = false
  updater.disableDifferentialDownload = true
  async function failed() {
    if (state.phase === 'installing') await recoverInstall()
    return change('error', 'Não foi possível atualizar. Confira a internet e tente novamente.')
  }
  updater.on('error', () => { failed().catch(() => change('error', 'Falha na instalação. Reabra o servidor e tente novamente.')) })
  updater.on('update-available', (info) => change('available', `Versão ${info.version} disponível.`, { version: info.version }))
  updater.on('update-not-available', () => change('current', 'O servidor já está atualizado.'))
  updater.on('download-progress', (progress) => change('downloading', `Baixando atualização: ${Math.round(progress.percent)}%`, { percent: progress.percent }))
  updater.on('update-downloaded', (info) => change('downloaded', `Versão ${info.version} pronta. Termine o atendimento antes de reiniciar.`, { version: info.version }))

  async function action() {
    if (busy) return state
    if (!supported()) return change('unsupported', 'Use o aplicativo instalado no Windows ou o arquivo AppImage no Linux para atualizar por aqui.')
    busy = true
    try {
      if (state.phase === 'downloaded') {
        const version = state.version
        change('installing', 'Finalizando impressões em andamento e reiniciando…', { version })
        await prepareInstall()
        updater.quitAndInstall(false, true)
      } else if (state.phase === 'available') {
        change('downloading', 'Iniciando download…')
        await updater.downloadUpdate()
      } else {
        change('checking', 'Buscando atualizações…')
        await updater.checkForUpdates()
      }
    } catch {
      await failed()
    } finally { busy = false }
    return state
  }
  return { status: () => state, action }
}

module.exports = { createUpdates }
