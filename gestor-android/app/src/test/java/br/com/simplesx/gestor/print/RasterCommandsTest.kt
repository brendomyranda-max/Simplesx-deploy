package br.com.simplesx.gestor.print

import br.com.simplesx.gestor.data.*
import org.junit.Assert.*
import org.junit.Test

class RasterCommandsTest {
    private val page = RasterPage(16, 2, byteArrayOf(0x80.toByte(), 0, 1, 0xff.toByte()))

    @Test fun receiptsKeepBitmapAndUseOnlyTheirOwnProtocol() {
        for (protocol in listOf(PrinterProtocol.ESC_POS, PrinterProtocol.ESC_BEMA, PrinterProtocol.DIEBOLD)) {
            val header = if (protocol == PrinterProtocol.DIEBOLD) byteArrayOf(27, 110, 0, 2, 2, 0)
                else byteArrayOf(29, 118, 48, 0, 2, 0, 2, 0)
            val actual = RasterCommands.document(listOf(page), PrinterConfig(protocol = protocol), 1, 0, false)
            val prefix = if (protocol == PrinterProtocol.DIEBOLD) byteArrayOf(27, 77, 27, 93, 0) else byteArrayOf(27, 64)
            assertArrayEquals(prefix + header + page.data + byteArrayOf(10), actual)
        }
        val diebold = PrinterConfig(protocol = PrinterProtocol.DIEBOLD, cutMode = CutMode.FEED_PARTIAL)
        assertArrayEquals(byteArrayOf(27, 31), RasterCommands.document(listOf(page), diebold, 1, 3, true).takeLast(2).toByteArray())
        val bema = PrinterConfig(protocol = PrinterProtocol.ESC_BEMA, cutMode = CutMode.PARTIAL)
        assertArrayEquals(byteArrayOf(27, 109), RasterCommands.document(listOf(page), bema, 1, 3, true).takeLast(2).toByteArray())
    }

    @Test fun starUsesPadded24DotBands() {
        val actual = RasterCommands.document(listOf(page), PrinterConfig(protocol = PrinterProtocol.STAR_LINE), 1, 0, false)
        assertArrayEquals(byteArrayOf(27, 64, 27, 107, 2, 0) + page.data + ByteArray(44) + byteArrayOf(10), actual)
    }

    @Test fun longReceiptsSplitWithoutDroppingRows() {
        val rows = ByteArray(600) { 0xaa.toByte() }
        val actual = RasterCommands.document(listOf(RasterPage(16, 300, rows)), PrinterConfig(), 1, 0, false)
        var offset = 2
        for (height in listOf(128, 128, 44)) {
            assertArrayEquals(byteArrayOf(29, 118, 48, 0, 2, 0, height.toByte(), 0), actual.copyOfRange(offset, offset + 8))
            offset += 8
            assertArrayEquals(rows.copyOfRange(0, height * 2), actual.copyOfRange(offset, offset + height * 2))
            offset += height * 2
        }
        assertEquals(offset + 1, actual.size)
    }

    @Test fun labelsKeepBinaryPolarityCopiesAndMedia() {
        val tspl = RasterCommands.document(listOf(page), PrinterConfig(protocol = PrinterProtocol.TSPL, tsplPaperMode = TsplPaperMode.GAP, gapMm = 3), 2, 0, false)
        val text = tspl.toString(Charsets.ISO_8859_1)
        assertTrue(text.contains("GAP 3 mm,0 mm"))
        assertTrue(text.contains(byteArrayOf(0x7f, 0xff.toByte(), 0xfe.toByte(), 0).toString(Charsets.ISO_8859_1)))
        assertTrue(text.endsWith("PRINT 1,2\r\n"))
        val zpl = RasterCommands.document(listOf(page), PrinterConfig(protocol = PrinterProtocol.ZPL), 2, 0, false).toString(Charsets.US_ASCII)
        assertTrue(zpl.contains("^GFA,4,4,2,800001FF^FS"))
        assertTrue(zpl.contains("^PQ2"))
        val cpcl = RasterCommands.document(listOf(page), PrinterConfig(protocol = PrinterProtocol.CPCL), 3, 0, false).toString(Charsets.ISO_8859_1)
        assertTrue(cpcl.contains("CG 2 2 0 0 " + page.data.toString(Charsets.ISO_8859_1)))
        assertFalse(cpcl.contains("FORM"))
        val epl = RasterCommands.document(listOf(page), PrinterConfig(protocol = PrinterProtocol.EPL), 2, 0, false).toString(Charsets.ISO_8859_1)
        assertTrue(epl.contains("GW0,0,2,2," + page.data.toString(Charsets.ISO_8859_1)))
        assertTrue(epl.endsWith("P2\n"))
    }
}
