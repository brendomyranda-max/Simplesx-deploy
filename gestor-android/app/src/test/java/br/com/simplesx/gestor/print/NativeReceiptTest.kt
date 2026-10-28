package br.com.simplesx.gestor.print

import br.com.simplesx.gestor.data.*
import org.junit.Assert.*
import org.junit.Test

class NativeReceiptTest {
    private fun ByteArray.containsSequence(seq: ByteArray) = asList().windowed(seq.size).any { it == seq.asList() }

    @Test fun starCutterAndFontUseNativeProtocolAcrossTransports() {
        for (connection in ConnectionType.entries) for ((mode, command) in listOf(
            CutMode.FULL to 0, CutMode.PARTIAL to 1, CutMode.FEED_FULL to 2, CutMode.FEED_PARTIAL to 3)) {
            val printer = PrinterConfig(protocol = PrinterProtocol.STAR_LINE, connection = connection, cutMode = mode, fontSize = PrinterFontSize.LARGE)
            val bytes = PrinterCommands.document("Ação\nABC", printer, centered = true)
            assertArrayEquals(byteArrayOf(27, 100, command.toByte()), bytes.takeLast(3).toByteArray())
            assertTrue(bytes.containsSequence(byteArrayOf(27, 105, 1, 1)))
            assertTrue(bytes.containsSequence(byteArrayOf(27, 29, 97, 1)))
            assertFalse(bytes.containsSequence(byteArrayOf(29, 86)))
            assertFalse(PrinterCommands.document("ABC", printer, cut = false).containsSequence(byteArrayOf(27, 100)))
        }
    }

    @Test fun bemaReappliesHeightAndDoesNotSendEscPosCutter() {
        val printer = PrinterConfig(protocol = PrinterProtocol.ESC_BEMA, cutMode = CutMode.PARTIAL, fontSize = PrinterFontSize.LARGE)
        val bytes = PrinterCommands.document("Ação\nABC", printer)
        assertTrue(bytes.toString(Charsets.US_ASCII).contains("\u001bVAcao\n\u001bVABC\n"))
        assertArrayEquals(byteArrayOf(27, 109), bytes.takeLast(2).toByteArray())
        assertFalse(bytes.containsSequence(byteArrayOf(29, 86)))
        assertFalse(PrinterCommands.document("ABC", printer.copy(cutMode = CutMode.NONE)).containsSequence(byteArrayOf(27, 109)))
    }

    @Test fun profilePreservesRouteAddressCategoriesAndFont() {
        val previous = PrinterConfig(name = "Cozinha", connection = ConnectionType.USB, usbVendorId = 123, usbProductId = 456, usbDeviceName = "/dev/bus/usb/001", host = "192.168.1.10", bluetoothAddress = "AA:BB:CC:DD:EE:FF", categoryIds = listOf(2, 3), fontSize = PrinterFontSize.LARGE)
        val profile = PrinterProfile("star", "Star", "STAR_LINE", 80, 42, 203, CutMode.FEED_PARTIAL, 3, "manual")
        val selected = profile.applyTo(previous)
        assertEquals(previous, selected.copy(protocol = previous.protocol, columnsNormal = previous.columnsNormal, cutMode = previous.cutMode))
        assertEquals(PrinterProtocol.STAR_LINE, selected.protocol)
        assertTrue(selected.protocol.isReceipt)
        assertTrue(PrinterProtocol.ESC_BEMA.isReceipt)
        try { profile.copy(protocol = "DRIVER").applyTo(previous); fail("Driver desktop não deve enviar ESC/POS no Android") }
        catch (_: IllegalArgumentException) { }
    }
}
