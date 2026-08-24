package br.com.simplesx.gestor.print

import java.io.ByteArrayOutputStream
import java.text.Normalizer

object EscPos {
    fun ticket(text: String, feed: Int = 3, cut: Boolean = true): ByteArray {
        val normalized = Normalizer.normalize(text.replace("\r\n", "\n").replace('\r', '\n'), Normalizer.Form.NFD)
            .replace(Regex("[\\p{InCombiningDiacriticalMarks}]"), "")
            .replace('º', 'o').replace('ª', 'a').replace('–', '-').replace('—', '-')
            .replace(Regex("[^\\x09\\x0A\\x0D\\x20-\\x7E]"), "")
            .trimEnd()
        return ByteArrayOutputStream().use { out ->
            out.write(byteArrayOf(0x1B, 0x40))
            out.write((normalized + "\n").toByteArray(Charsets.US_ASCII))
            if (feed > 0) out.write(byteArrayOf(0x1B, 0x64, feed.coerceIn(0, 255).toByte()))
            if (cut) out.write(byteArrayOf(0x1D, 0x56, 0x00))
            out.toByteArray()
        }
    }

    fun openDrawer(): ByteArray = byteArrayOf(0x1B, 0x70, 0x00, 0x19, 0xFA.toByte())
}
