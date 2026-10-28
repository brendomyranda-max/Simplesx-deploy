package br.com.simplesx.gestor.print

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream

class ChunkedTransferTest {
    @Test fun partialUsbWritesKeepEveryByteIncludingDieboldCut() {
        val bytes = Diebold.ticket("Pedido grande\n".repeat(200))
        val output = ByteArrayOutputStream()
        val pauses = mutableListOf<Long>()
        ChunkedTransfer.send(bytes, pause = { pauses.add(it) }) { offset, length ->
            assertTrue(length <= 512)
            val accepted = minOf(length, 17)
            output.write(bytes, offset, accepted)
            accepted
        }
        assertArrayEquals(bytes, output.toByteArray())
        assertEquals(0x11.toByte(), output.toByteArray().last())
        assertEquals(400L, pauses.last())
        assertTrue(pauses.dropLast(1).all { it == 40L })
    }

    @Test fun failedUsbWriteStopsWithoutRetryingOrSendingCut() {
        var calls = 0
        try {
            ChunkedTransfer.send(ByteArray(2048), pause = {}) { _, _ ->
                calls++
                if (calls == 1) 512 else -1
            }
            fail("Deveria informar falha")
        } catch (_: IllegalStateException) {
            assertEquals(2, calls)
        }
    }
}
