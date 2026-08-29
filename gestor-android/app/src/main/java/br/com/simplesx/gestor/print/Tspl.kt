package br.com.simplesx.gestor.print

import br.com.simplesx.gestor.data.TsplPaperMode

object Tspl {
    fun label(
        text: String, widthMm: Int = 58, copies: Int = 1,
        paperMode: TsplPaperMode = TsplPaperMode.CONTINUOUS,
        configuredHeightMm: Int = 30, gapMm: Int = 2, dpi: Int = 203, centered: Boolean = false,
    ): ByteArray {
        val width = widthMm.coerceIn(20, 320)
        val fixedHeight = configuredHeightMm.takeIf { paperMode != TsplPaperMode.CONTINUOUS }
        val layout = LabelLayouts.calculate(text, width, fixedHeight, dpi)
        val heightMm = fixedHeight ?: ((layout.heightDots / (dpi.coerceIn(100, 1200) / 25.4)).toInt() + 1).coerceAtLeast(10)
        val commands = buildString {
            append("SIZE $width mm,$heightMm mm\r\n")
            when (paperMode) {
                TsplPaperMode.CONTINUOUS -> append("GAP 0 mm,0 mm\r\n")
                TsplPaperMode.GAP -> append("GAP ${gapMm.coerceIn(1, 20)} mm,0 mm\r\n")
                TsplPaperMode.BLACK_MARK -> append("BLINE ${gapMm.coerceIn(1, 20)} mm,0 mm\r\n")
            }
            append("DIRECTION 1\r\n")
            append("CLS\r\n")
            val printerFont = if (layout.fontScale < 0.72) "1" else "0"
            layout.lines.forEachIndexed { index, line ->
                val characterWidth = 12 * layout.dpiScale * layout.fontScale
                val leftMargin = (8 * layout.dpiScale * layout.fontScale).toInt().coerceAtLeast(4)
                val x = if (centered) ((layout.widthDots - line.length * characterWidth) / 2).toInt().coerceAtLeast(leftMargin) else leftMargin
                append("TEXT $x,${layout.margin + index * layout.lineHeight},\"$printerFont\",0,1,1,\"")
                append(line.replace("\\", "\\\\").replace("\"", "\\\""))
                append("\"\r\n")
            }
            append("PRINT ${copies.coerceIn(1, 20)},1\r\n")
        }
        return commands.toByteArray(Charsets.US_ASCII)
    }

}
