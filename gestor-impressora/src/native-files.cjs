// Processos externos não conseguem ler caminhos virtuais dentro de app.asar.
function externalFilePath(filePath) {
  return filePath.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2')
}

module.exports = { externalFilePath }
