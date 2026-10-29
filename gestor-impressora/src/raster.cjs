/** Bitmap 1=preto, MSB primeiro. Cada emulação recebe somente seus comandos. */
function rasterDocument(protocol, pages, { copies = 1, feed = 3, cut = true, cutMode = 'FULL', widthMm = 80, paperMode = 'CONTINUOUS', gapMm = 2, dpi = 203 } = {}) {
  const parts = []
  copies = Math.max(1, Math.min(20, Math.trunc(Number(copies) || 1)))
  const receipt = ['ESC_POS', 'DIEBOLD', 'ESC_BEMA', 'STAR_LINE'].includes(protocol)
  if (receipt) parts.push(Buffer.from(protocol === 'DIEBOLD' ? [27, 77, 27, 93, 0] : [27, 64]))
  for (const page of pages) {
    const stride = page.width / 8
    const data = Buffer.from(page.data, 'base64')
    if (!Number.isInteger(stride) || stride < 1 || stride > 2048 || !Number.isInteger(page.height) || page.height < 1 || data.length !== stride * page.height) throw new Error('Bitmap de impressão inválido')
    if (protocol === 'ESC_POS' || protocol === 'ESC_BEMA' || protocol === 'DIEBOLD') {
      if (protocol === 'DIEBOLD' && stride > 72) throw new Error('A Diebold IM453H permite até 72 mm imprimíveis a 203 DPI. Confira largura e DPI.')
      for (let y = 0; y < page.height; y += 128) {
        const rows = Math.min(128, page.height - y)
        parts.push(Buffer.from(protocol === 'DIEBOLD' ? [27, 110, 0, stride, rows & 255, rows >> 8] : [29, 118, 48, 0, stride & 255, stride >> 8, rows & 255, rows >> 8]), data.subarray(y * stride, (y + rows) * stride))
      }
    } else if (protocol === 'STAR_LINE') {
      if (stride > 255) throw new Error('Largura excede o limite gráfico de Star Line')
      for (let y = 0; y < page.height; y += 24) {
        const band = Buffer.alloc(stride * 24)
        data.copy(band, 0, y * stride, Math.min(y + 24, page.height) * stride)
        parts.push(Buffer.from([27, 107, stride, 0]), band)
      }
    } else if (protocol === 'TSPL') {
      const media = paperMode === 'BLACK_MARK' ? `BLINE ${gapMm} mm,0 mm` : `GAP ${paperMode === 'GAP' ? gapMm : 0} mm,0 mm`
      parts.push(Buffer.from(`SIZE ${widthMm} mm,${page.heightMm.toFixed(3)} mm\r\n${media}\r\nDIRECTION 1\r\nREFERENCE 0,0\r\nCLS\r\nBITMAP 0,0,${stride},${page.height},0,`, 'ascii'), Buffer.from(data.map((byte) => byte ^ 255)), Buffer.from(`\r\nPRINT 1,${copies}\r\n`, 'ascii'))
    } else if (protocol === 'ZPL') {
      parts.push(Buffer.from(`^XA\n^PW${page.width}\n^LL${page.height}\n^LH0,0\n^FO0,0^GFA,${data.length},${data.length},${stride},${data.toString('hex').toUpperCase()}^FS\n^PQ${copies}\n^XZ\n`, 'ascii'))
    } else if (protocol === 'CPCL') {
      parts.push(Buffer.from(`! 0 ${dpi} ${dpi} ${page.height} ${copies}\r\nPW ${page.width}\r\nCG ${stride} ${page.height} 0 0 `, 'ascii'), data, Buffer.from(`\r\n${paperMode === 'CONTINUOUS' ? '' : 'FORM\r\n'}PRINT\r\n`, 'ascii'))
    } else if (protocol === 'EPL') {
      parts.push(Buffer.from(`N\nq${page.width}\nQ${page.height},${Math.round((paperMode === 'CONTINUOUS' ? 0 : gapMm) / 25.4 * dpi)}\nGW0,0,${stride},${page.height},`, 'ascii'), data, Buffer.from(`\nP${copies}\n`, 'ascii'))
    } else throw new Error(`Protocolo sem suporte a bitmap: ${protocol}`)
  }
  if (receipt) {
    parts.push(Buffer.from([10])) // também descarrega o último bloco gráfico Diebold
    parts.push(Buffer.alloc(Math.min(255, Math.max(0, Math.trunc(feed))), 10))
    if (cut && cutMode !== 'NONE') {
      if (protocol === 'DIEBOLD') parts.push(Buffer.from(cutMode === 'FEED_PARTIAL' ? [27, 31] : [17]))
      else if (protocol === 'ESC_BEMA') parts.push(Buffer.from([27, ['PARTIAL', 'FEED_PARTIAL'].includes(cutMode) ? 109 : 119]))
      else if (protocol === 'STAR_LINE') parts.push(Buffer.from([27, 100, ({ FULL: 0, PARTIAL: 1, FEED_FULL: 2, FEED_PARTIAL: 3 })[cutMode] ?? 0]))
      else parts.push(Buffer.from(({ FULL: [29, 86, 0], PARTIAL: [29, 86, 1], FEED_FULL: [29, 86, 65, 0], FEED_PARTIAL: [29, 86, 66, 0] })[cutMode] || [29, 86, 0]))
    }
  }
  return Buffer.concat(parts)
}
module.exports = { rasterDocument }
