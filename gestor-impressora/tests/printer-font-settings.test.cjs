const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

test('salvar fonte persiste por impressora e preserva token, papel e demais filas', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8')
  let saved
  const handlers = {}
  const context = {
    config: { token: 'token-de-teste', fontesImpressoras: { Bar: 'small' }, largurasImpressoras: { Bar: 80 }, alturasImpressoras: {}, dpisImpressoras: {}, protocolosImpressoras: {} },
    DEPLOY_PADRAO: 'https://doixp.com', PREFIXO_PADRAO: 'NFC:', ultimoErro: '', URL, path,
    os: { hostname: () => 'servidor' }, app: { setLoginItemSettings() {} },
    arquivoConfig: () => '/config/config.json', notificarStatus() {},
    fs: { mkdir: async () => {}, writeFile: async (_file, text) => { saved = JSON.parse(text) } },
    ipcMain: { handle: (name, fn) => { handlers[name] = fn } },
  }
  vm.createContext(context)
  vm.runInContext(source.slice(source.indexOf('async function salvarConfig'), source.indexOf('function statusAtual')) + '\nfunction statusAtual() { return config }', context)
  vm.runInContext(source.slice(source.indexOf("ipcMain.handle('salvar-impressora'"), source.indexOf("ipcMain.handle('abrir-externamente'")), context)
  const body = { impressora: 'Caixa', larguraMm: 58, alturaMm: null, dpi: 203, protocolo: 'ESC_POS', tamanhoFonte: 'large' }
  await handlers['salvar-impressora']({}, body)
  assert.deepEqual(saved.fontesImpressoras, { Bar: 'small', Caixa: 'large' })
  assert.deepEqual(saved.largurasImpressoras, { Bar: 80, Caixa: 58 })
  assert.equal(saved.token, 'token-de-teste')
  // Uma configuração antiga sem campo de fonte recebe o padrão Normal.
  await handlers['salvar-impressora']({}, { ...body, impressora: 'Antiga', tamanhoFonte: undefined })
  assert.equal(saved.fontesImpressoras.Antiga, 'normal')
  await assert.rejects(handlers['salvar-impressora']({}, { ...body, tamanhoFonte: 'enorme' }), /fonte inválido/)
  assert.equal(saved.fontesImpressoras.Caixa, 'large')
})
