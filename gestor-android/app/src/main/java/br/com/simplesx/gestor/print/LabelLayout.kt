package br.com.simplesx.gestor.print

import java.text.Normalizer

internal data class LabelLayout(
    val lines: List<String>,
    val fontScale: Double,
    val dpiScale: Double,
    val margin: Int,
    val lineHeight: Int,
    val fontSize: Int,
    val widthDots: Int,
    val heightDots: Int,
)

internal object LabelLayouts {
    fun calculate(text: String, widthMm: Int, fixedHeightMm: Int?, dpi: Int): LabelLayout {
        val safeWidth = widthMm.coerceIn(20, 320)
        val safeDpi = dpi.coerceIn(100, 1200)
        val dpiScale = safeDpi / 203.0
        val baseColumns = ((safeWidth * 32) / 58).coerceAtLeast(8)
        val fixedHeightDots = fixedHeightMm?.coerceIn(10, 500)?.let { mmToDots(it, safeDpi) }
        var fontScale = 1.0
        var lines: List<String>
        var margin: Int
        var lineHeight: Int
        while (true) {
            val columns = (baseColumns / fontScale).toInt().coerceAtLeast(baseColumns)
            lines = normalize(text).lines().flatMap { wrap(it, columns) }.ifEmpty { listOf("") }
            margin = (16 * dpiScale * fontScale).toInt().coerceAtLeast(4)
            lineHeight = (28 * dpiScale * fontScale).toInt().coerceAtLeast(6)
            if (fixedHeightDots == null || margin * 2 + lines.size * lineHeight <= fixedHeightDots || fontScale <= 0.25) break
            fontScale = (fontScale - 0.01).coerceAtLeast(0.25)
        }
        val automaticHeight = ((32 + lines.size * 28) * dpiScale * fontScale).toInt().coerceAtLeast(80)
        return LabelLayout(
            lines, fontScale, dpiScale, margin, lineHeight,
            (24 * dpiScale * fontScale).toInt().coerceAtLeast(6),
            mmToDots(safeWidth, safeDpi), fixedHeightDots ?: automaticHeight,
        )
    }

    fun mmToDots(mm: Int, dpi: Int): Int =
        (mm.coerceIn(0, 500) * dpi.coerceIn(100, 1200) / 25.4).toInt().coerceAtLeast(0)

    private fun normalize(text: String): String = Normalizer.normalize(
        text.replace("\r\n", "\n").replace('\r', '\n'), Normalizer.Form.NFD,
    ).replace(Regex("[\\p{InCombiningDiacriticalMarks}]"), "")
        .replace('º', 'o').replace('ª', 'a').replace('–', '-').replace('—', '-')
        .replace(Regex("[^\\x09\\x0A\\x20-\\x7E]"), "").trimEnd()

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
