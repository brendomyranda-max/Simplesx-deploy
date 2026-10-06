/**
 * Arquivo: preload.cjs
 * Responsabilidade: Expõe à tela apenas as operações Electron autorizadas.
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('simplexsa', {
  status: () => ipcRenderer.invoke('status'),
  salvar: (config) => ipcRenderer.invoke('salvar-config', config),
  desconectar: () => ipcRenderer.invoke('desconectar'),
  listarImpressoras: () => ipcRenderer.invoke('listar-impressoras'),
  testar: (impressora) => ipcRenderer.invoke('testar-impressora', impressora),
  salvarImpressora: (impressora, larguraMm, alturaMm, protocolo, dpi) => ipcRenderer.invoke('salvar-impressora', { impressora, larguraMm, alturaMm, protocolo, dpi }),
  abrirExternamente: (url) => ipcRenderer.invoke('abrir-externamente', url),
  onStatus: (callback) => ipcRenderer.on('status-atualizado', (_event, value) => callback(value)),
})
