const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { createUpdates } = require('../src/updates.cjs')

function setup(options = {}) {
  const updater = new EventEmitter()
  const calls = []
  updater.checkForUpdates = async () => { calls.push('check'); updater.emit('update-available', { version: '1.5.17' }) }
  updater.downloadUpdate = async () => { calls.push('download'); updater.emit('download-progress', { percent: 70 }); updater.emit('update-downloaded', { version: '1.5.17' }) }
  updater.quitAndInstall = () => calls.push('install')
  const updates = createUpdates({ updater, supported: () => true, prepareInstall: async () => calls.push('drain'), notify: () => {}, ...options })
  return { updater, calls, updates }
}

test('busca e download são explícitos; instalação espera os trabalhos antes de reiniciar', async () => {
  let finish
  const drain = new Promise(resolve => { finish = resolve })
  const { updates, calls, updater } = setup({ prepareInstall: () => drain })
  assert.equal(updater.autoDownload, false)
  assert.equal(updater.autoInstallOnAppQuit, false)
  assert.equal((await updates.action()).phase, 'available')
  assert.deepEqual(calls, ['check'])
  assert.equal((await updates.action()).phase, 'downloaded')
  const installation = updates.action()
  assert.equal(updates.status().phase, 'installing')
  await updates.action()
  assert.deepEqual(calls, ['check', 'download'])
  finish()
  await installation
  assert.deepEqual(calls, ['check', 'download', 'install'])
})

test('falha na preparação recupera o servidor e não inicia o instalador', async () => {
  let recovered = false
  const { updates, calls } = setup({ prepareInstall: async () => { throw new Error('disk') }, recoverInstall: async () => { recovered = true } })
  await updates.action(); await updates.action()
  assert.equal((await updates.action()).phase, 'error')
  assert.equal(recovered, true)
  assert.equal(calls.includes('install'), false)
})

test('erro emitido pelo instalador recupera o servidor sem aguardar encerramento', async () => {
  let recovered = false
  const { updates, updater } = setup({ recoverInstall: async () => { recovered = true } })
  updater.quitAndInstall = () => updater.emit('error', new Error('permission'))
  await updates.action(); await updates.action(); await updates.action()
  assert.equal(recovered, true)
  assert.equal(updates.status().phase, 'error')
})

test('desenvolvimento e Linux fora do AppImage não fingem uma atualização', async () => {
  const { updates, calls } = setup({ supported: () => false })
  assert.equal((await updates.action()).phase, 'unsupported')
  assert.deepEqual(calls, [])
})

test('consulta concorrente é única e falha de rede permite buscar novamente', async () => {
  const { updates, updater } = setup()
  let resolve
  let requests = 0
  updater.checkForUpdates = () => { requests++; return new Promise(r => { resolve = r }) }
  const first = updates.action()
  await updates.action()
  assert.equal(requests, 1)
  updater.emit('update-not-available')
  resolve()
  assert.equal((await first).phase, 'current')
  updater.checkForUpdates = async () => { throw new Error('offline') }
  assert.equal((await updates.action()).phase, 'error')
  updater.checkForUpdates = async () => updater.emit('update-not-available')
  assert.equal((await updates.action()).phase, 'current')
})
