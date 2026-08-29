package br.com.simplesx.gestor.print

import br.com.simplesx.gestor.data.PrinterConfig
import br.com.simplesx.gestor.data.PrinterProtocol
import br.com.simplesx.gestor.data.TsplPaperMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PrinterCommandsTest {
    private fun config(
        protocol: PrinterProtocol,
        dpi: Int = 203,
        width: Int = 58,
        mode: TsplPaperMode = TsplPaperMode.CONTINUOUS,
        height: Int = 30,
    ) = PrinterConfig(protocol = protocol, dpi = dpi, widthMm = width, tsplPaperMode = mode, labelHeightMm = height)

    @Test fun escPosProducesInitTextFeedAndCut() {
        val bytes = PrinterCommands.document("Ação 123", config(PrinterProtocol.ESC_POS), feed = 2, cut = true)
        assertTrue(bytes.take(2).toByteArray().contentEquals(byteArrayOf(0x1B, 0x40)))
        assertTrue(bytes.toString(Charsets.US_ASCII).contains("Acao 123"))
        assertTrue(bytes.takeLast(3).toByteArray().contentEquals(byteArrayOf(0x1D, 0x56, 0x00)))
    }

    @Test fun tsplUsesConfiguredDimensionsDpiAndCopies() {
        val command = PrinterCommands.document(
            "Etiqueta", config(PrinterProtocol.TSPL, dpi = 300, width = 58, mode = TsplPaperMode.GAP), copies = 3,
        ).toString(Charsets.US_ASCII)
        assertTrue(command.startsWith("SIZE 58 mm,30 mm\r\nGAP 2 mm,0 mm\r\n"))
        assertTrue(command.contains("TEXT 11,23,"))
        assertTrue(command.endsWith("PRINT 3,1\r\n"))
    }

    @Test fun zplUsesCustomDpiForWidthHeightAndCopies() {
        val command = PrinterCommands.document(
            "Zebra", config(PrinterProtocol.ZPL, dpi = 300, width = 58), copies = 2,
        ).toString(Charsets.US_ASCII)
        assertTrue(command.contains("^PW685"))
        assertTrue(command.contains("^LL88"))
        assertTrue(command.contains("^PQ2"))
        assertTrue(command.endsWith("^XZ\n"))
    }

    @Test fun cpclUsesConfiguredResolutionWidthHeightAndCopies() {
        val command = PrinterCommands.document(
            "CPCL", config(PrinterProtocol.CPCL, dpi = 300, width = 58), copies = 4,
        ).toString(Charsets.US_ASCII)
        assertTrue(command.startsWith("! 0 300 300 88 4\r\n"))
        assertTrue(command.contains("PW 685\r\n"))
        assertTrue(command.endsWith("FORM\r\nPRINT\r\n"))
    }

    @Test fun eplUsesCustomDpiForWidthGapHeightAndCopies() {
        val command = PrinterCommands.document(
            "EPL", config(PrinterProtocol.EPL, dpi = 300, width = 58, mode = TsplPaperMode.GAP), copies = 5,
        ).toString(Charsets.US_ASCII)
        assertTrue(command.startsWith("N\nq685\nQ354,23\n"))
        assertTrue(command.endsWith("P5\n"))
    }

    @Test fun copiesAreClampedForLabelProtocols() {
        PrinterProtocol.entries.filter { it != PrinterProtocol.ESC_POS }.forEach { protocol ->
            val command = PrinterCommands.document("x", config(protocol), copies = 99).toString(Charsets.US_ASCII)
            assertFalse(command.contains("99"))
        }
        assertEquals("ESC/POS (cupons)", PrinterCommands.displayName(PrinterProtocol.ESC_POS))
    }

    @Test fun centeredEscPosAddsAndRestoresAlignment() {
        val bytes = PrinterCommands.document("Validade", config(PrinterProtocol.ESC_POS), centered = true)
        assertTrue(bytes.indexOfSubsequence(byteArrayOf(0x1B, 0x61, 0x01)) >= 0)
        assertTrue(bytes.indexOfSubsequence(byteArrayOf(0x1B, 0x61, 0x00)) >= 0)
    }

    @Test fun centeredLabelProtocolsUseCenteredCoordinates() {
        assertTrue(PrinterCommands.document("ABC", config(PrinterProtocol.TSPL), centered = true).toString(Charsets.US_ASCII).contains("TEXT 213,"))
        assertTrue(PrinterCommands.document("ABC", config(PrinterProtocol.ZPL), centered = true).toString(Charsets.US_ASCII).contains("^FB463,1,0,C,0"))
        assertTrue(PrinterCommands.document("ABC", config(PrinterProtocol.CPCL), centered = true).toString(Charsets.US_ASCII).contains("TEXT 0 2 213 "))
        assertTrue(PrinterCommands.document("ABC", config(PrinterProtocol.EPL), centered = true).toString(Charsets.US_ASCII).contains("A213,"))
    }

    @Test fun fixedHeightShrinksLabelOnlyWhenContentDoesNotFit() {
        val shortLayout = LabelLayouts.calculate("Texto curto", 40, 30, 203)
        assertEquals(1.0, shortLayout.fontScale, 0.001)

        val text = "Produto com descricao muito longa que ocupa varias linhas\nQuantidade: 10\nPreco: 123,45"
        val compactLayout = LabelLayouts.calculate(text, 40, 20, 203)
        assertTrue(compactLayout.fontScale < 1.0)
        assertTrue(compactLayout.margin * 2 + compactLayout.lines.size * compactLayout.lineHeight <= compactLayout.heightDots)

        val zpl = PrinterCommands.document(
            text, config(PrinterProtocol.ZPL, width = 40, mode = TsplPaperMode.GAP, height = 20),
        ).toString(Charsets.US_ASCII)
        assertTrue(zpl.contains("^LL159"))
        assertFalse(zpl.contains("^A0N,24,24"))
    }

    private fun ByteArray.indexOfSubsequence(value: ByteArray): Int =
        indices.firstOrNull { start -> start + value.size <= size && value.indices.all { this[start + it] == value[it] } } ?: -1
}
