package br.com.simplesx.gestor.print

import br.com.simplesx.gestor.data.PrinterConfig
import br.com.simplesx.gestor.data.PrinterProtocol

object PrinterCommands {
    fun document(text: String, printer: PrinterConfig, copies: Int = 1, feed: Int = 3, cut: Boolean = true, centered: Boolean = false): ByteArray =
        when (printer.protocol) {
            PrinterProtocol.ESC_POS -> EscPos.ticket(text, feed, cut, printer.widthMm, centered)
            PrinterProtocol.TSPL -> Tspl.label(
                text, printer.widthMm, copies, printer.tsplPaperMode, printer.labelHeightMm, printer.gapMm, printer.dpi, centered,
            )
            PrinterProtocol.ZPL -> zpl(text, printer, copies, centered)
            PrinterProtocol.CPCL -> cpcl(text, printer, copies, centered)
            PrinterProtocol.EPL -> epl(text, printer, copies, centered)
        }

    fun displayName(protocol: PrinterProtocol): String = when (protocol) {
        PrinterProtocol.ESC_POS -> "ESC/POS (cupons)"
        PrinterProtocol.TSPL -> "TSPL/TSPL2 (etiquetas)"
        PrinterProtocol.ZPL -> "ZPL (Zebra)"
        PrinterProtocol.CPCL -> "CPCL (portáteis)"
        PrinterProtocol.EPL -> "EPL/EPL2 (etiquetas antigas)"
    }

    private fun zpl(text: String, printer: PrinterConfig, copies: Int, centered: Boolean): ByteArray {
        val layout = labelLayout(text, printer)
        return buildString {
            append("^XA\n^PW${layout.widthDots}\n^LL${layout.heightDots}\n^LH0,0\n")
            layout.lines.forEachIndexed { index, line ->
                if (centered) append("^FO0,${layout.margin + index * layout.lineHeight}^FB${layout.widthDots},1,0,C,0^A0N,${layout.fontSize},${layout.fontSize}^FD${line.replace("^", " ").replace("~", " ")}^FS\n")
                else append("^FO${layout.margin},${layout.margin + index * layout.lineHeight}^A0N,${layout.fontSize},${layout.fontSize}^FD${line.replace("^", " ").replace("~", " ")}^FS\n")
            }
            append("^PQ${copies.coerceIn(1, 20)}\n^XZ\n")
        }.toByteArray(Charsets.US_ASCII)
    }

    private fun cpcl(text: String, printer: PrinterConfig, copies: Int, centered: Boolean): ByteArray {
        val layout = labelLayout(text, printer)
        val dpi = printer.dpi.coerceIn(100, 1200)
        val scale = layout.dpiScale * layout.fontScale
        val cpclFont = if (layout.fontScale < 0.72) "7 0" else "0 2"
        return buildString {
            append("! 0 $dpi $dpi ${layout.heightDots} ${copies.coerceIn(1, 20)}\r\n")
            append("PW ${layout.widthDots}\r\n")
            layout.lines.forEachIndexed { index, line ->
                val x = if (centered) ((layout.widthDots - line.length * 12 * scale) / 2).toInt().coerceAtLeast(layout.margin) else layout.margin
                append("TEXT $cpclFont $x ${layout.margin + index * layout.lineHeight} $line\r\n")
            }
            append("FORM\r\nPRINT\r\n")
        }.toByteArray(Charsets.US_ASCII)
    }

    private fun epl(text: String, printer: PrinterConfig, copies: Int, centered: Boolean): ByteArray {
        val layout = labelLayout(text, printer)
        val scale = layout.dpiScale * layout.fontScale
        val eplFont = if (layout.fontScale < 0.72) 1 else 3
        return buildString {
            append("N\nq${layout.widthDots}\nQ${layout.heightDots},${LabelLayouts.mmToDots(printer.gapMm, printer.dpi)}\n")
            layout.lines.forEachIndexed { index, line ->
                val x = if (centered) ((layout.widthDots - line.length * 12 * scale) / 2).toInt().coerceAtLeast(layout.margin) else layout.margin
                append("A$x,${layout.margin + index * layout.lineHeight},0,$eplFont,1,1,N,\"${line.replace("\\", " ").replace("\"", "'")}\"\n")
            }
            append("P${copies.coerceIn(1, 20)}\n")
        }.toByteArray(Charsets.US_ASCII)
    }

    private fun labelLayout(text: String, printer: PrinterConfig): LabelLayout = LabelLayouts.calculate(
        text, printer.widthMm,
        printer.labelHeightMm.takeIf { printer.tsplPaperMode.name != "CONTINUOUS" },
        printer.dpi,
    )
}
