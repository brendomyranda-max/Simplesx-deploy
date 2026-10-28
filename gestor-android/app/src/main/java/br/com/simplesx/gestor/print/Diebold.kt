package br.com.simplesx.gestor.print

import br.com.simplesx.gestor.data.PrinterFontSize
import br.com.simplesx.gestor.data.CutMode
import java.io.ByteArrayOutputStream
import java.text.Normalizer

/** IM453H: tabela Padrão/Padrão II, conforme manual I43.51.00.PD1.XX. */
object Diebold {
    fun ticket(text: String, feed: Int = 3, cut: Boolean = true, widthMm: Int = 80, centered: Boolean = false,
               fontSize: PrinterFontSize = PrinterFontSize.NORMAL, columnsNormal: Int? = null, cutMode: CutMode = CutMode.FULL): ByteArray {
        val width = widthMm.coerceIn(20, 320)
        val base = columnsNormal?.takeIf { it in 8..160 }
            ?: if (width <= 58) (width * 32 / 58).coerceAtLeast(8) else width.coerceAtMost(80) * 48 / 80
        // Condensado varia com o CPP do firmware: mantém a quebra conservadora.
        val scale = if (fontSize == PrinterFontSize.LARGE) 2.0 else 1.0
        val columns = (base / scale).toInt().coerceAtLeast(1)
        val clean = Normalizer.normalize(text.replace("\r\n", "\n").replace('\r', '\n'), Normalizer.Form.NFD)
            .replace(Regex("[\\p{InCombiningDiacriticalMarks}]"), "")
            .replace('º', 'o').replace('ª', 'a').replace('–', '-').replace('—', '-')
            .replace('“', '"').replace('”', '"').replace('‘', '\'').replace('’', '\'')
            .replace(Regex("[^\\x09\\x0A\\x20-\\x7E]"), "").trimEnd().replace("\t", "    ")
        val lines = EscPos.wrapToWidth(clean, width, scale, base).split('\n')
        val reset = byteArrayOf(0x1B, 0x4D, 0x1B, 0x5D, 0)
        return ByteArrayOutputStream().use { out ->
            out.write(reset)
            if (fontSize == PrinterFontSize.SMALL) out.write(0x0F)
            if (fontSize == PrinterFontSize.LARGE) out.write(byteArrayOf(0x1B, 0x5D, 1))
            lines.forEach { line ->
                // SO é cancelado pelo LF na tabela Padrão II.
                if (fontSize == PrinterFontSize.LARGE) out.write(0x0E)
                val padding = if (centered) " ".repeat(((columns - line.length) / 2).coerceAtLeast(0)) else ""
                out.write((padding + line + if (fontSize == PrinterFontSize.LARGE) "\n\n" else "\n").toByteArray(Charsets.US_ASCII))
            }
            out.write(reset)
            repeat(feed.coerceIn(0, 255)) { out.write(0x0A) }
            if (cut && cutMode != CutMode.NONE) {
                if (cutMode == CutMode.FEED_PARTIAL) out.write(byteArrayOf(0x1B, 0x1F)) // Firmware PD1.12+: avanço otimizado.
                else out.write(0x11) // Corte conforme configuração da impressora.
            }
            out.toByteArray()
        }
    }
}
