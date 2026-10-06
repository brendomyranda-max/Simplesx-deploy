const fs = require('node:fs')
const path = require('node:path')

// Reutiliza o diretório e o bloqueio de instância das instalações anteriores.
// Copiar somente config.json perderia o diário que impede reimpressões após falhas.
function resolveDataDirectory(appData, exists = fs.existsSync) {
  const previous = ['simplesx-gestor-impressora', 'SimplesX Gestor'].map(name => path.join(appData, name))
  return previous.find(directory => exists(path.join(directory, 'config.json')))
    || previous.find(directory => exists(directory))
    || path.join(appData, 'simplexsa-gestor-impressora')
}

module.exports = { resolveDataDirectory }
