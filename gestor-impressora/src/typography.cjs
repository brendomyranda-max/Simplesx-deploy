const FONT_FAMILIES = ['monospace', 'sans-serif', 'serif', 'Arial', 'Verdana', 'Courier New', 'Consolas']

function normalizeTypography(value) {
  const sizePx = Number(value?.sizePx ?? 12)
  const family = value?.family ?? 'monospace'
  const bold = value?.bold ?? false
  const printableWidthMm = value?.printableWidthMm == null || value.printableWidthMm === '' ? null : Number(value.printableWidthMm)
  if (!Number.isFinite(sizePx) || sizePx < 6 || sizePx > 96) throw new Error('Tamanho da fonte deve estar entre 6 e 96 px')
  if (!FONT_FAMILIES.includes(family)) throw new Error('Modelo da fonte inválido')
  if (typeof bold !== 'boolean') throw new Error('Negrito inválido')
  if (printableWidthMm !== null && (!Number.isFinite(printableWidthMm) || printableWidthMm < 10 || printableWidthMm > 320)) throw new Error('Largura imprimível deve estar entre 10 e 320 mm')
  return { sizePx, family, bold, printableWidthMm }
}

function migrateTypography(legacy) {
  return { sizePx: legacy === 'small' ? 9 : legacy === 'large' ? 24 : 12, family: 'monospace', bold: false, printableWidthMm: null }
}

// Executada no Chromium isolado, sem acesso a Node ou rede. O retorno é 1 bit/dot.
function renderTypography({ text, typography, widthMm, heightMm, dpi = 203, centered = false }) {
  const scale = dpi / 96
  const printable = typography.printableWidthMm ?? (widthMm <= 58 ? widthMm - 10 : widthMm - 8)
  if (printable > widthMm) throw new Error('A largura imprimível não pode superar a largura do papel')
  const width = Math.max(8, Math.floor(printable / 25.4 * dpi / 8) * 8)
  const margin = Math.max(2, Math.round(scale))
  const fontSize = typography.sizePx * scale
  const lineHeight = Math.ceil(fontSize * 1.3)
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const family = ['monospace', 'sans-serif', 'serif'].includes(typography.family) ? typography.family : JSON.stringify(typography.family)
  const font = `${typography.bold ? '700' : '400'} ${fontSize}px ${family}`
  context.font = font
  const lines = []
  const available = width - 2 * margin
  if (context.measureText('W').width > available) throw new Error('A fonte não cabe na largura imprimível. Reduza o tamanho em px.')
  const clean = String(text || '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
  for (const original of clean.split('\n')) {
    let chars = Array.from(original)
    while (chars.length && context.measureText(chars.join('')).width > available) {
      let low = 1, high = chars.length
      while (low < high) {
        const middle = Math.ceil((low + high) / 2)
        if (context.measureText(chars.slice(0, middle).join('')).width <= available) low = middle
        else high = middle - 1
      }
      let end = low
      const space = chars.slice(0, low + 1).lastIndexOf(' ')
      if (space > 0) end = space
      lines.push(chars.slice(0, end).join(''))
      chars = chars.slice(end)
      while (chars[0] === ' ') chars.shift()
      if (lines.length > 10000) throw new Error('Documento excede o limite de linhas')
    }
    lines.push(chars.join(''))
  }
  const fixedHeight = heightMm ? Math.round(heightMm / 25.4 * dpi) : null
  const pageLimit = fixedHeight ?? Math.min(8192, Math.floor(8000000 / width))
  const perPage = Math.floor((pageLimit - 2 * margin) / lineHeight)
  if (perPage < 1) throw new Error('A fonte não cabe na altura da etiqueta. Reduza o tamanho ou aumente a altura.')
  const pages = []
  for (let offset = 0; offset < lines.length; offset += perPage) {
    const group = lines.slice(offset, offset + perPage)
    const height = fixedHeight ?? group.length * lineHeight + 2 * margin
    canvas.width = width; canvas.height = height
    context.fillStyle = '#fff'; context.fillRect(0, 0, width, height)
    context.fillStyle = '#000'; context.font = font; context.textBaseline = 'top'
    group.forEach((line, index) => context.fillText(line, centered ? Math.max(margin, (width - context.measureText(line).width) / 2) : margin, margin + index * lineHeight))
    const rgba = context.getImageData(0, 0, width, height).data
    const packed = new Uint8Array(width / 8 * height)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4
      if (rgba[p] * 0.299 + rgba[p + 1] * 0.587 + rgba[p + 2] * 0.114 < 160) packed[y * width / 8 + (x >> 3)] |= 128 >> (x & 7)
    }
    let binary = ''
    for (let start = 0; start < packed.length; start += 8192) binary += String.fromCharCode(...packed.subarray(start, start + 8192))
    pages.push({ width, height, data: btoa(binary), png: canvas.toDataURL('image/png'), heightMm: height / dpi * 25.4 })
    if (pages.length > 200) throw new Error('Documento excede 200 páginas')
  }
  return pages
}

module.exports = { FONT_FAMILIES, normalizeTypography, migrateTypography, renderTypography }
