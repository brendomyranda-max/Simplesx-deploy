/**
 * Arquivo: EscPos.kt
 * Responsabilidade: Gera comandos ESC/POS para impressoras térmicas de cupons.
 */

package br.com.simplesx.gestor.print

import br.com.simplesx.gestor.data.PrinterFontSize
import br.com.simplesx.gestor.data.CutMode

import java.io.ByteArrayOutputStream
import java.text.Normalizer

object EscPos {
    fun ticket(text: String, feed: Int = 3, cut: Boolean = true, widthMm: Int = 58, centered: Boolean = false, fontSize: PrinterFontSize = PrinterFontSize.NORMAL, columnsNormal: Int? = null, cutMode: CutMode = CutMode.FULL): ByteArray {
        val clean = Normalizer.normalize(text, Normalizer.Form.NFD).replace(Regex("[\\p{InCombiningDiacriticalMarks}]"), "").replace("\t", "    ")
        val wrapped = wrapToWidth(clean, widthMm, fontSize.scale, columnsNormal)
        val normalized = Normalizer.normalize(wrapped.replace("\r\n", "\n").replace('\r', '\n'), Normalizer.Form.NFD)
            .replace(Regex("[\\p{InCombiningDiacriticalMarks}]"), "")
            .replace('“', '"').replace('”', '"').replace('‘', '\'').replace('’', '\'')
            .replace('º', 'o').replace('ª', 'a').replace('–', '-').replace('—', '-')
            .replace(Regex("[^\\x09\\x0A\\x0D\\x20-\\x7E]"), "")
            .trimEnd()
        return ByteArrayOutputStream().use { out ->
            out.write(byteArrayOf(0x1B, 0x40))
            out.write(byteArrayOf(0x1B, 0x4D, (if (fontSize == PrinterFontSize.SMALL) 1 else 0).toByte()))
            out.write(byteArrayOf(0x1D, 0x21, (if (fontSize == PrinterFontSize.LARGE) 0x11 else 0).toByte()))
            if (fontSize == PrinterFontSize.LARGE) out.write(byteArrayOf(0x1B, 0x33, 56))
            if (centered) out.write(byteArrayOf(0x1B, 0x61, 0x01))
            out.write((normalized + "\n").toByteArray(Charsets.US_ASCII))
            if (centered) out.write(byteArrayOf(0x1B, 0x61, 0x00))
            if (feed > 0) out.write(byteArrayOf(0x1B, 0x64, feed.coerceIn(0, 255).toByte()))
            if (cut) when (cutMode) {
                CutMode.FULL -> out.write(byteArrayOf(0x1D, 0x56, 0))
                CutMode.PARTIAL -> out.write(byteArrayOf(0x1D, 0x56, 1))
                CutMode.FEED_FULL -> out.write(byteArrayOf(0x1D, 0x56, 65, 0))
                CutMode.FEED_PARTIAL -> out.write(byteArrayOf(0x1D, 0x56, 66, 0))
                CutMode.NONE -> Unit
            }
            out.toByteArray()
        }
    }

    internal fun wrapToWidth(text: String, widthMm: Int, scale: Double, columnsNormal: Int? = null): String {
        val base = columnsNormal?.takeIf { it in 8..160 } ?: ((widthMm.coerceIn(20, 320) * 32) / 58)
        val columns = (base / scale).toInt().coerceAtLeast(1)
        return text.replace("\r\n", "\n").replace('\r', '\n').lines().flatMap { source ->
            if (source.isEmpty()) return@flatMap listOf("")
            val parts = mutableListOf<String>()
            var remaining = source
            while (remaining.length > columns) {
                val space = remaining.lastIndexOf(' ', columns).takeIf { it > 0 } ?: columns
                parts += remaining.substring(0, space).trimEnd()
                remaining = remaining.substring(space).trimStart()
            }
            parts + remaining
        }.joinToString("\n")
    }

    fun openDrawer(): ByteArray = byteArrayOf(0x1B, 0x70, 0x00, 0x19, 0xFA.toByte())
}
