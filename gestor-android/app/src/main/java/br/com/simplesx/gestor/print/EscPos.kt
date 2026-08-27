package br.com.simplesx.gestor.print

import java.io.ByteArrayOutputStream
import java.text.Normalizer

object EscPos {
    fun ticket(text: String, feed: Int = 3, cut: Boolean = true, widthMm: Int = 58, centered: Boolean = false): ByteArray {
        val wrapped = wrapToWidth(text, widthMm)
        val normalized = Normalizer.normalize(wrapped.replace("\r\n", "\n").replace('\r', '\n'), Normalizer.Form.NFD)
            .replace(Regex("[\\p{InCombiningDiacriticalMarks}]"), "")
            .replace('º', 'o').replace('ª', 'a').replace('–', '-').replace('—', '-')
            .replace(Regex("[^\\x09\\x0A\\x0D\\x20-\\x7E]"), "")
            .trimEnd()
        return ByteArrayOutputStream().use { out ->
            out.write(byteArrayOf(0x1B, 0x40))
            if (centered) out.write(byteArrayOf(0x1B, 0x61, 0x01))
            out.write((normalized + "\n").toByteArray(Charsets.US_ASCII))
            if (centered) out.write(byteArrayOf(0x1B, 0x61, 0x00))
            if (feed > 0) out.write(byteArrayOf(0x1B, 0x64, feed.coerceIn(0, 255).toByte()))
            if (cut) out.write(byteArrayOf(0x1D, 0x56, 0x00))
            out.toByteArray()
        }
    }

    private fun wrapToWidth(text: String, widthMm: Int): String {
        val columns = ((widthMm.coerceIn(20, 320) * 32) / 58).coerceAtLeast(8)
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
