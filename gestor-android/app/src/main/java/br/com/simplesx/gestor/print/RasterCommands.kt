package br.com.simplesx.gestor.print

import br.com.simplesx.gestor.data.*
import java.io.ByteArrayOutputStream
import java.util.Locale
import kotlin.math.roundToInt

data class RasterPage(val width: Int, val height: Int, val data: ByteArray)

object RasterCommands {
    fun document(pages: List<RasterPage>, printer: PrinterConfig, copies: Int, feed: Int, cut: Boolean): ByteArray {
        val count = copies.coerceIn(1, 20)
        return ByteArrayOutputStream().use { out ->
            fun bytes(vararg values: Int) = out.write(values.map { it.toByte() }.toByteArray())
            fun command(value: String) = out.write(value.toByteArray(Charsets.US_ASCII))
            if (printer.protocol.isReceipt) {
                if (printer.protocol == PrinterProtocol.DIEBOLD) bytes(27, 77, 27, 93, 0) else bytes(27, 64)
            }
            pages.forEach { page ->
                val stride = page.width / 8
                require(page.width % 8 == 0 && stride in 1..2048 && page.height > 0 && page.data.size == stride * page.height) { "Bitmap inválido" }
                when (printer.protocol) {
                    PrinterProtocol.ESC_POS, PrinterProtocol.ESC_BEMA, PrinterProtocol.DIEBOLD -> {
                        if (printer.protocol == PrinterProtocol.DIEBOLD) require(stride <= 72) { "Diebold IM453H: limite de 72 mm imprimíveis a 203 DPI" }
                        var y = 0
                        while (y < page.height) {
                            val rows = minOf(128, page.height - y)
                            if (printer.protocol == PrinterProtocol.DIEBOLD) bytes(27, 110, 0, stride, rows and 255, rows shr 8)
                            else bytes(29, 118, 48, 0, stride and 255, stride shr 8, rows and 255, rows shr 8)
                            out.write(page.data, y * stride, rows * stride)
                            y += rows
                        }
                    }
                    PrinterProtocol.STAR_LINE -> {
                        require(stride <= 255) { "Largura excede o limite gráfico Star Line" }
                        var y = 0
                        while (y < page.height) {
                            bytes(27, 107, stride, 0)
                            val band = ByteArray(stride * 24)
                            page.data.copyInto(band, 0, y * stride, minOf(y + 24, page.height) * stride)
                            out.write(band)
                            y += 24
                        }
                    }
                    PrinterProtocol.TSPL -> {
                        val media = if (printer.tsplPaperMode == TsplPaperMode.BLACK_MARK) "BLINE ${printer.gapMm} mm,0 mm"
                            else "GAP ${if (printer.tsplPaperMode == TsplPaperMode.GAP) printer.gapMm else 0} mm,0 mm"
                        val height = String.format(Locale.US, "%.3f", page.height / printer.dpi.toDouble() * 25.4)
                        command("SIZE ${printer.widthMm} mm,$height mm\r\n$media\r\nDIRECTION 1\r\nREFERENCE 0,0\r\nCLS\r\nBITMAP 0,0,$stride,${page.height},0,")
                        out.write(page.data.map { (it.toInt() xor 255).toByte() }.toByteArray())
                        command("\r\nPRINT 1,$count\r\n")
                    }
                    PrinterProtocol.ZPL -> {
                        val hex = page.data.joinToString("") { "%02X".format(it.toInt() and 255) }
                        command("^XA\n^PW${page.width}\n^LL${page.height}\n^LH0,0\n^FO0,0^GFA,${page.data.size},${page.data.size},$stride,$hex^FS\n^PQ$count\n^XZ\n")
                    }
                    PrinterProtocol.CPCL -> {
                        command("! 0 ${printer.dpi} ${printer.dpi} ${page.height} $count\r\nPW ${page.width}\r\nCG $stride ${page.height} 0 0 ")
                        out.write(page.data)
                        command("\r\n${if (printer.tsplPaperMode == TsplPaperMode.CONTINUOUS) "" else "FORM\r\n"}PRINT\r\n")
                    }
                    PrinterProtocol.EPL -> {
                        val gap = if (printer.tsplPaperMode == TsplPaperMode.CONTINUOUS) 0 else (printer.gapMm / 25.4 * printer.dpi).roundToInt()
                        command("N\nq${page.width}\nQ${page.height},$gap\nGW0,0,$stride,${page.height},")
                        out.write(page.data)
                        command("\nP$count\n")
                    }
                }
            }
            if (printer.protocol.isReceipt) {
                bytes(10)
                repeat(feed.coerceIn(0, 255)) { bytes(10) }
                if (cut && printer.cutMode != CutMode.NONE) when (printer.protocol) {
                    PrinterProtocol.DIEBOLD -> if (printer.cutMode == CutMode.FEED_PARTIAL) bytes(27, 31) else bytes(17)
                    PrinterProtocol.ESC_BEMA -> bytes(27, if (printer.cutMode in listOf(CutMode.PARTIAL, CutMode.FEED_PARTIAL)) 109 else 119)
                    PrinterProtocol.STAR_LINE -> bytes(27, 100, when (printer.cutMode) { CutMode.PARTIAL -> 1; CutMode.FEED_FULL -> 2; CutMode.FEED_PARTIAL -> 3; else -> 0 })
                    else -> when (printer.cutMode) {
                        CutMode.PARTIAL -> bytes(29, 86, 1)
                        CutMode.FEED_FULL -> bytes(29, 86, 65, 0)
                        CutMode.FEED_PARTIAL -> bytes(29, 86, 66, 0)
                        else -> bytes(29, 86, 0)
                    }
                }
            }
            out.toByteArray()
        }
    }
}
