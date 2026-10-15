package com.doixp.entregas

import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets

/** A session exists only in memory. Requests must run outside the main thread. */
internal class DeliveryHttpClient(baseUrl: String, private val cookie: String) {
    private val origin = ServerAddress.normalize(baseUrl, BuildConfig.DEBUG)
    @Volatile private var activeConnection: HttpURLConnection? = null

    fun get(path: String): JSONObject = request("GET", path, null)

    fun post(path: String, body: JSONObject): JSONObject = request("POST", path, body)

    fun cancelPending() {
        activeConnection?.disconnect()
    }

    private fun request(method: String, path: String, body: JSONObject?): JSONObject {
        // Never let a caller send the session to another host or follow a redirect.
        require(path.startsWith("/api/") && !path.contains("..") &&
            !path.contains('\\') && !path.contains('#')) { "Caminho de API inválido." }
        require(cookie.isNotBlank() && !cookie.contains('\r') && !cookie.contains('\n')) {
            "Sessão inválida."
        }
        val connection = URL(origin.trimEnd('/') + path).openConnection() as HttpURLConnection
        activeConnection = connection
        try {
            connection.requestMethod = method
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 10_000
            connection.readTimeout = 10_000
            connection.useCaches = false
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Cookie", cookie)
            // The same origin is required by the server's request protection.
            connection.setRequestProperty("Origin", origin.trimEnd('/'))
            if (body != null) {
                val bytes = body.toString().toByteArray(StandardCharsets.UTF_8)
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.setFixedLengthStreamingMode(bytes.size)
                connection.outputStream.use { it.write(bytes) }
            }
            val statusCode = connection.responseCode
            if (statusCode !in 200..299) throw DeliveryHttpException(statusCode)
            val bodyText = connection.inputStream.bufferedReader(StandardCharsets.UTF_8).use {
                // Bound memory even if a configured server unexpectedly sends a huge body.
                val result = StringBuilder()
                val buffer = CharArray(8_192)
                while (true) {
                    val read = it.read(buffer)
                    if (read == -1) break
                    if (result.length + read > MAX_RESPONSE_CHARS) {
                        throw IOException("Resposta do servidor excedeu o limite.")
                    }
                    result.append(buffer, 0, read)
                }
                result.toString()
            }
            return if (bodyText.isBlank()) JSONObject() else JSONObject(bodyText)
        } finally {
            if (activeConnection === connection) activeConnection = null
            connection.disconnect()
        }
    }

    private companion object {
        const val MAX_RESPONSE_CHARS = 4 * 1024 * 1024
    }
}

internal class DeliveryHttpException(val statusCode: Int) :
    IOException("Servidor respondeu HTTP $statusCode.")
