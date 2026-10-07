package br.com.simplesx.gestor.print

import java.io.Closeable
import java.net.SocketTimeoutException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Fecha o transporte para interromper também escritas bloqueadas, não só leituras. */
object TransportGuard {
    private val deadlines = Executors.newScheduledThreadPool(2) { runnable ->
        Thread(runnable, "printer-transport-timeout").apply { isDaemon = true }
    }

    fun <T> withTimeout(connection: Closeable, timeoutMs: Long, operation: () -> T): T {
        val timedOut = AtomicBoolean(false)
        val complete = AtomicBoolean(false)
        val deadline = deadlines.schedule({
            if (complete.compareAndSet(false, true)) {
                timedOut.set(true)
                runCatching { connection.close() }
            }
        }, timeoutMs, TimeUnit.MILLISECONDS)
        try {
            val result = operation()
            if (!complete.compareAndSet(false, true)) throw SocketTimeoutException("Tempo de comunicação com a impressora esgotado")
            return result
        } catch (error: Exception) {
            if (timedOut.get()) throw SocketTimeoutException("Tempo de comunicação com a impressora esgotado").apply { initCause(error) }
            throw error
        } finally {
            complete.set(true)
            deadline.cancel(false)
        }
    }

    /** Alternativas são seguras antes de transmitir. Falhas de escrita nunca repetem o documento. */
    fun <T : Closeable> connectAndSend(attempts: Int, connect: (Int) -> T, send: (T) -> Unit) {
        require(attempts > 0)
        var lastError: Exception? = null
        for (attempt in 0 until attempts) {
            val connection = try { connect(attempt) } catch (error: Exception) {
                lastError = error
                continue
            }
            connection.use { send(it) }
            return
        }
        throw IllegalStateException("Não foi possível conectar à impressora após $attempts tentativas. " +
            "Confira se está ligada, pareada e livre em outros aparelhos. Detalhe: ${lastError?.message}", lastError)
    }
}
