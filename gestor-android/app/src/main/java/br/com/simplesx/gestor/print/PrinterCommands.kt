package br.com.simplesx.gestor.print

import br.com.simplesx.gestor.data.PrinterConfig
import br.com.simplesx.gestor.data.PrinterProtocol
import java.text.Normalizer

object PrinterCommands {
    fun document(text: String, printer: PrinterConfig, copies: Int = 1, feed: Int = 3, cut: Boolean = true): ByteArray =
        when (printer.protocol) {
            PrinterProtocol.ESC_POS -> EscPos.ticket(text, feed, cut, printer.widthMm)
            PrinterProtocol.TSPL -> Tspl.label(
                text, printer.widthMm, copies, printer.tsplPaperMode, printer.labelHeightMm, printer.gapMm, printer.dpi,
            )
            PrinterProtocol.ZPL -> zpl(text, printer, copies)
            PrinterProtocol.CPCL -> cpcl(text, printer, copies)
            PrinterProtocol.EPL -> epl(text, printer, copies)
        }

    fun displayName(protocol: PrinterProtocol): String = when (protocol) {
        PrinterProtocol.ESC_POS -> "ESC/POS (cupons)"
        PrinterProtocol.TSPL -> "TSPL/TSPL2 (etiquetas)"
        PrinterProtocol.ZPL -> "ZPL (Zebra)"
        PrinterProtocol.CPCL -> "CPCL (portáteis)"
        PrinterProtocol.EPL -> "EPL/EPL2 (etiquetas antigas)"
    }

    private fun zpl(text: String, printer: PrinterConfig, copies: Int): ByteArray {
        val lines = lines(text, printer.widthMm)
        val widthDots = mmToDots(printer.widthMm, printer.dpi)
        val heightDots = labelHeightDots(printer, lines.size)
        val scale = printer.dpi / 203.0
        val margin = (16 * scale).toInt().coerceAtLeast(8)
        val lineHeight = (28 * scale).toInt().coerceAtLeast(14)
        val fontSize = (24 * scale).toInt().coerceAtLeast(12)
        return buildString {
            append("^XA\n^PW$widthDots\n^LL$heightDots\n^LH0,0\n")
            lines.forEachIndexed { index, line ->
                append("^FO$margin,${margin + index * lineHeight}^A0N,$fontSize,$fontSize^FD${line.replace("^", " ").replace("~", " ")}^FS\n")
            }
            append("^PQ${copies.coerceIn(1, 20)}\n^XZ\n")
        }.toByteArray(Charsets.US_ASCII)
    }

    private fun cpcl(text: String, printer: PrinterConfig, copies: Int): ByteArray {
        val lines = lines(text, printer.widthMm)
        val heightDots = labelHeightDots(printer, lines.size)
        val dpi = printer.dpi.coerceIn(100, 1200)
        val scale = dpi / 203.0
        val margin = (16 * scale).toInt().coerceAtLeast(8)
        val lineHeight = (28 * scale).toInt().coerceAtLeast(14)
        return buildString {
            append("! 0 $dpi $dpi $heightDots ${copies.coerceIn(1, 20)}\r\n")
            append("PW ${mmToDots(printer.widthMm, printer.dpi)}\r\n")
            lines.forEachIndexed { index, line -> append("TEXT 0 2 $margin ${margin + index * lineHeight} $line\r\n") }
            append("FORM\r\nPRINT\r\n")
        }.toByteArray(Charsets.US_ASCII)
    }

    private fun epl(text: String, printer: PrinterConfig, copies: Int): ByteArray {
        val lines = lines(text, printer.widthMm)
        val heightDots = labelHeightDots(printer, lines.size)
        val scale = printer.dpi / 203.0
        val margin = (16 * scale).toInt().coerceAtLeast(8)
        val lineHeight = (28 * scale).toInt().coerceAtLeast(14)
        return buildString {
            append("N\nq${mmToDots(printer.widthMm, printer.dpi)}\nQ$heightDots,${mmToDots(printer.gapMm, printer.dpi)}\n")
            lines.forEachIndexed { index, line ->
                append("A$margin,${margin + index * lineHeight},0,3,1,1,N,\"${line.replace("\\", " ").replace("\"", "'")}\"\n")
            }
            append("P${copies.coerceIn(1, 20)}\n")
        }.toByteArray(Charsets.US_ASCII)
    }

    private fun labelHeightDots(printer: PrinterConfig, lineCount: Int): Int =
        if (printer.tsplPaperMode.name == "CONTINUOUS") {
            val scale = printer.dpi / 203.0
            ((32 + lineCount * 28) * scale).toInt().coerceAtLeast(80)
        } else mmToDots(printer.labelHeightMm, printer.dpi).coerceAtLeast(80)

    private fun mmToDots(mm: Int, dpi: Int): Int =
        (mm.coerceIn(0, 320) * dpi.coerceIn(100, 1200) / 25.4).toInt().coerceAtLeast(0)

    private fun lines(text: String, widthMm: Int): List<String> {
        val columns = ((widthMm.coerceIn(20, 320) * 32) / 58).coerceAtLeast(8)
        return normalize(text).lines().flatMap { wrap(it, columns) }.ifEmpty { listOf("") }
    }

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
