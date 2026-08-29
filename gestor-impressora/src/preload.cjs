const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('simplesx', {
  status: () => ipcRenderer.invoke('status'),
  salvar: (config) => ipcRenderer.invoke('salvar-config', config),
  listarImpressoras: () => ipcRenderer.invoke('listar-impressoras'),
  testar: (impressora) => ipcRenderer.invoke('testar-impressora', impressora),
  salvarImpressora: (impressora, larguraMm, alturaMm, protocolo, dpi) => ipcRenderer.invoke('salvar-impressora', { impressora, larguraMm, alturaMm, protocolo, dpi }),
  abrirExternamente: (url) => ipcRenderer.invoke('abrir-externamente', url),
  onStatus: (callback) => ipcRenderer.on('status-atualizado', (_event, value) => callback(value)),
})
