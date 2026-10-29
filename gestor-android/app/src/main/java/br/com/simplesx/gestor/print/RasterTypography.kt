package br.com.simplesx.gestor.print

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import br.com.simplesx.gestor.data.PrinterConfig
import br.com.simplesx.gestor.data.TsplPaperMode
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.roundToInt

/** Renderiza no aparelho: o firmware recebe a mesma fonte, os acentos e o negrito. */
object RasterTypography {
    fun render(text: String, printer: PrinterConfig, centered: Boolean): List<RasterPage> {
        val size = requireNotNull(printer.fontSizePx)
        require(size.isFinite() && size in 6.0..96.0) { "Tamanho deve estar entre 6 e 96 px" }
        val printable = printer.printableWidthMm ?: (printer.widthMm - if (printer.widthMm <= 58) 10 else 8)
        require(printable in 10..printer.widthMm) { "Confira a largura imprimível e a largura do papel" }
        val scale = printer.dpi / 96.0
        val width = max(8, floor(printable / 25.4 * printer.dpi / 8).toInt() * 8)
        val margin = max(2, scale.roundToInt())
        val family = when (printer.fontFamily) {
            "Arial", "Verdana" -> "sans-serif"
            "Courier New", "Consolas" -> "monospace"
            else -> printer.fontFamily
        }
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK
            textSize = (size * scale).toFloat()
            typeface = Typeface.create(family, if (printer.fontBold) Typeface.BOLD else Typeface.NORMAL)
        }
        val metrics = paint.fontMetrics
        val lineHeight = max(ceil(size * scale * 1.3).toInt(), ceil((metrics.bottom - metrics.top).toDouble()).toInt())
        val available = width - 2 * margin
        require(paint.measureText("W") <= available) { "A fonte não cabe na largura imprimível. Reduza o tamanho em px." }
        val lines = mutableListOf<String>()
        val clean = text.replace("\r\n", "\n").replace('\r', '\n').replace("\t", "    ").replace(Regex("[\\x00-\\x08\\x0b-\\x1f\\x7f]"), "")
        clean.split('\n').forEach { original ->
            var remaining = original
            while (paint.measureText(remaining) > available) {
                var count = paint.breakText(remaining, true, available.toFloat(), null).coerceAtLeast(1)
                if (count < remaining.length && remaining[count - 1].isHighSurrogate()) count--
                count = count.coerceAtLeast(1)
                val space = remaining.lastIndexOf(' ', count)
                val end = if (space > 0) space else count
                lines.add(remaining.substring(0, end))
                remaining = remaining.substring(end).trimStart(' ')
                require(lines.size <= 10000) { "Documento excede o limite de linhas" }
            }
            lines.add(remaining)
        }
        val fixedHeight = if (!printer.protocol.isReceipt && (printer.fixedHeight || printer.tsplPaperMode != TsplPaperMode.CONTINUOUS))
            (printer.labelHeightMm / 25.4 * printer.dpi).roundToInt() else null
        val pageLimit = fixedHeight ?: minOf(8192, 8000000 / width)
        val perPage = (pageLimit - margin * 2) / lineHeight
        require(perPage > 0) { "A fonte não cabe na altura da etiqueta. Reduza o tamanho ou aumente a altura." }
        require(ceil(lines.size.toDouble() / perPage) <= 200) { "Documento excede 200 páginas" }
        return lines.chunked(perPage).map { group ->
            val height = fixedHeight ?: (group.size * lineHeight + margin * 2)
            val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            try {
                val canvas = Canvas(bitmap)
                canvas.drawColor(Color.WHITE)
                group.forEachIndexed { index, line ->
                    val x = if (centered) max(margin.toFloat(), (width - paint.measureText(line)) / 2) else margin.toFloat()
                    canvas.drawText(line, x, margin + index * lineHeight - metrics.top, paint)
                }
                val data = ByteArray(width / 8 * height)
                val row = IntArray(width)
                for (y in 0 until height) {
                    bitmap.getPixels(row, 0, width, 0, y, width, 1)
                    for (x in 0 until width) {
                        val pixel = row[x]
                        if (Color.red(pixel) * 299 + Color.green(pixel) * 587 + Color.blue(pixel) * 114 < 160000) {
                            val offset = y * width / 8 + x / 8
                            data[offset] = (data[offset].toInt() or (128 shr (x % 8))).toByte()
                        }
                    }
                }
                RasterPage(width, height, data)
            } finally { bitmap.recycle() }
        }
    }
}
