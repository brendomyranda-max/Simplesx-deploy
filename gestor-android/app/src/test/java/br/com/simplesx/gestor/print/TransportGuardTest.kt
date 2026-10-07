package br.com.simplesx.gestor.print

import org.junit.Assert.*
import org.junit.Test
import java.io.Closeable
import java.io.IOException
import java.net.SocketTimeoutException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class TransportGuardTest {
    @Test fun failedConnectionsTryAlternativesBeforeSending() {
        var attempts = 0
        var sends = 0
        var closed = false
        TransportGuard.connectAndSend(3, connect = {
            attempts++
            if (it < 2) throw IOException("Sem SDP")
            Closeable { closed = true }
        }, send = { sends++ })
        assertEquals(3, attempts)
        assertEquals(1, sends)
        assertTrue(closed)
    }

    @Test fun partialWriteNeverRetriesTheDocument() {
        var attempts = 0
        var sends = 0
        var closed = false
        val error = assertThrows(IOException::class.java) {
            TransportGuard.connectAndSend(3, connect = {
                attempts++
                Closeable { closed = true }
            }, send = {
                sends++
                throw IOException("Falha após enviar parte do documento")
            })
        }
        assertTrue(error.message!!.contains("parte"))
        assertEquals(1, attempts)
        assertEquals(1, sends)
        assertTrue(closed)
    }

    @Test fun timeoutClosesBlockedTransport() {
        val closed = CountDownLatch(1)
        assertThrows(SocketTimeoutException::class.java) {
            TransportGuard.withTimeout(Closeable { closed.countDown() }, 50) {
                check(closed.await(2, TimeUnit.SECONDS)) { "Transporte não foi fechado" }
                throw IOException("socket closed")
            }
        }
        assertEquals(0L, closed.count)
    }

    @Test fun completedOperationCancelsItsDeadline() {
        val closed = CountDownLatch(1)
        assertEquals("ok", TransportGuard.withTimeout(Closeable { closed.countDown() }, 100) { "ok" })
        assertFalse(closed.await(200, TimeUnit.MILLISECONDS))
    }
}
