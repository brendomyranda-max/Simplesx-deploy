const { normalizeTypography, renderTypography } = require('./typography.cjs')
const { rasterDocument } = require('./raster.cjs')

async function printWithTypography({ BrowserWindow, fs, path, app, crypto, execute, printer, text, typography, widthMm, heightMm, dpi, centered, protocol, copies, feed, cut, cutMode, paperMode, gapMm }) {
  const settings = normalizeTypography(typography)
  const win = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  let temporary
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'"><body></body>'))
    const pages = await win.webContents.executeJavaScript(`(${renderTypography.toString()})(${JSON.stringify({ text, typography: settings, widthMm, heightMm, dpi, centered })})`)
    if (protocol === 'DRIVER') {
      // O mesmo desenho é usado no driver, eliminando divergências entre Windows e CUPS.
      for (let copy = 0; copy < copies; copy++) for (const page of pages) {
        await win.webContents.executeJavaScript(`(async () => {document.body.innerHTML='';document.body.style.cssText='margin:0;padding:0';const img=document.createElement('img');img.src=${JSON.stringify(page.png)};img.style.cssText='display:block;width:${page.width / dpi * 25.4}mm;height:${page.heightMm}mm';document.body.appendChild(img);await img.decode()})()`)
        await new Promise((resolve, reject) => win.webContents.print({ silent: true, deviceName: printer.name, printBackground: true, color: false, margins: { marginType: 'none' }, scaleFactor: 100, pageSize: { width: Math.round(widthMm * 1000), height: Math.max(10000, Math.round(page.heightMm * 1000)) } }, (ok, reason) => ok ? resolve() : reject(new Error(reason || 'O driver recusou a impressão'))))
      }
    } else {
      const receipt = ['ESC_POS', 'DIEBOLD', 'ESC_BEMA', 'STAR_LINE'].includes(protocol)
      const data = rasterDocument(protocol, pages, { copies, feed, cut, cutMode, widthMm, paperMode, gapMm, dpi })
      temporary = path.join(app.getPath('temp'), `doixp-typography-${crypto.randomUUID()}.bin`)
      await fs.writeFile(temporary, data)
      for (let copy = 0; copy < (receipt ? copies : 1); copy++) {
        if (process.platform === 'linux') await execute('lp', ['-d', printer.name, '-o', 'raw', temporary], { timeout: 60000 })
        else if (process.platform === 'win32') await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', require('./native-files.cjs').externalFilePath(path.join(__dirname, 'windows-raw.ps1')), '-PrinterName', printer.name, '-FilePath', temporary], { timeout: 60000, windowsHide: true })
        else throw new Error('Sistema sem suporte ao envio de impressão')
      }
    }
  } finally {
    win.destroy()
    if (temporary) await fs.unlink(temporary).catch(() => {})
  }
}
module.exports = { printWithTypography }
