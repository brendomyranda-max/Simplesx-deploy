package br.com.simplesx.gestor.print

import java.text.Normalizer
import br.com.simplesx.gestor.data.TsplPaperMode

object Tspl {
    fun label(
        text: String, widthMm: Int = 58, copies: Int = 1,
        paperMode: TsplPaperMode = TsplPaperMode.CONTINUOUS,
        configuredHeightMm: Int = 30, gapMm: Int = 2, dpi: Int = 203,
    ): ByteArray {
        val width = widthMm.coerceIn(20, 320)
        val columns = ((width * 32) / 58).coerceAtLeast(8)
        val lines = normalize(text).lines().flatMap { wrap(it, columns) }.ifEmpty { listOf("") }
        val scale = dpi.coerceIn(100, 1200) / 203.0
        val lineHeightDots = (28 * scale).toInt().coerceAtLeast(14)
        val topMarginDots = (16 * scale).toInt().coerceAtLeast(8)
        val dotsPerMm = dpi.coerceIn(100, 1200) / 25.4
        val contentHeightMm = (((topMarginDots * 2 + lines.size * lineHeightDots) / dotsPerMm).toInt() + 1).coerceAtLeast(10)
        val heightMm = if (paperMode == TsplPaperMode.CONTINUOUS) contentHeightMm else configuredHeightMm.coerceIn(10, 500)
        val commands = buildString {
            append("SIZE $width mm,$heightMm mm\r\n")
            when (paperMode) {
                TsplPaperMode.CONTINUOUS -> append("GAP 0 mm,0 mm\r\n")
                TsplPaperMode.GAP -> append("GAP ${gapMm.coerceIn(1, 20)} mm,0 mm\r\n")
                TsplPaperMode.BLACK_MARK -> append("BLINE ${gapMm.coerceIn(1, 20)} mm,0 mm\r\n")
            }
            append("DIRECTION 1\r\n")
            append("CLS\r\n")
            lines.forEachIndexed { index, line ->
                append("TEXT ${(8 * scale).toInt()},${topMarginDots + index * lineHeightDots},\"0\",0,1,1,\"")
                append(line.replace("\\", "\\\\").replace("\"", "\\\""))
                append("\"\r\n")
            }
            append("PRINT ${copies.coerceIn(1, 20)},1\r\n")
        }
        return commands.toByteArray(Charsets.US_ASCII)
    }

    private fun normalize(text: String): String = Normalizer.normalize(
        text.replace("\r\n", "\n").replace('\r', '\n'), Normalizer.Form.NFD
    ).replace(Regex("[\\p{InCombiningDiacriticalMarks}]"), "")
        .replace('º', 'o').replace('ª', 'a').replace('–', '-').replace('—', '-')
        .replace(Regex("[^\\x09\\x0A\\x20-\\x7E]"), "")
        .trimEnd()

    private fun wrap(source: String, columns: Int): List<String> {
        if (source.isEmpty()) return listOf("")
        val parts = mutableListOf<String>()
        var remaining = source
        while (remaining.length > columns) {
            val split = remaining.lastIndexOf(' ', columns).takeIf { it > 0 } ?: columns
            parts += remaining.substring(0, split).trimEnd()
            remaining = remaining.substring(split).trimStart()
        }
        return parts + remaining
    }
}
