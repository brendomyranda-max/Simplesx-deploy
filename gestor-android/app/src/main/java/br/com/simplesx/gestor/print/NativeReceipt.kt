package br.com.simplesx.gestor.print

import br.com.simplesx.gestor.data.*
import java.io.ByteArrayOutputStream
import java.text.Normalizer

/** Star Line Rev. 1.12; Bematech MP-4200 TH Rev. 1.0. Não altera a emulação do equipamento. */
object NativeReceipt {
    fun ticket(text: String, printer: PrinterConfig, feed: Int, cut: Boolean, centered: Boolean): ByteArray {
        val star = printer.protocol == PrinterProtocol.STAR_LINE
        val clean = Normalizer.normalize(text.replace("\r\n", "\n").replace('\r', '\n'), Normalizer.Form.NFD)
            .replace(Regex("[\\p{InCombiningDiacriticalMarks}]"), "")
            .replace('º', 'o').replace('ª', 'a').replace('–', '-').replace('—', '-')
            .replace('“', '"').replace('”', '"').replace('‘', '\'').replace('’', '\'')
            .replace(Regex("[^\\x09\\x0A\\x20-\\x7E]"), "").trimEnd().replace("\t", "    ")
        val base = printer.columnsNormal ?: if (printer.widthMm <= 58) 32 else 48
        val normalized = EscPos.wrapToWidth(clean, printer.widthMm, printer.fontSize.scale, base)
        val large = printer.fontSize == PrinterFontSize.LARGE
        val small = printer.fontSize == PrinterFontSize.SMALL
        return ByteArrayOutputStream().use { out ->
            out.write(byteArrayOf(27, 64))
            if (star) {
                out.write(byteArrayOf(27, 30, 70, if (small) 1 else 0))
                out.write(byteArrayOf(27, 105, if (large) 1 else 0, if (large) 1 else 0))
                out.write(byteArrayOf(27, 29, 97, if (centered) 1 else 0))
                out.write((normalized + "\n").toByteArray(Charsets.US_ASCII))
            } else {
                if (small) out.write(15)
                out.write(byteArrayOf(27, 87, if (large) 1 else 0, 27, 97, if (centered) 1 else 0))
                normalized.lines().forEach { line ->
                    if (large) out.write(byteArrayOf(27, 86))
                    out.write((line + "\n").toByteArray(Charsets.US_ASCII))
                }
            }
            out.write(if (star) byteArrayOf(27, 29, 97, 0) else byteArrayOf(27, 97, 0))
            repeat(feed.coerceIn(0, 255)) { out.write(10) }
            if (cut && printer.cutMode != CutMode.NONE) {
                val partial = printer.cutMode in listOf(CutMode.PARTIAL, CutMode.FEED_PARTIAL)
                if (star) out.write(byteArrayOf(27, 100, when (printer.cutMode) {
                    CutMode.FEED_FULL -> 2; CutMode.FEED_PARTIAL -> 3; CutMode.PARTIAL -> 1; else -> 0
                })) else out.write(byteArrayOf(27, if (partial) 109 else 119))
            }
            out.toByteArray()
        }
    }
}
