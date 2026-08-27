package br.com.simplesx.gestor.network

import br.com.simplesx.gestor.data.AppConfig
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class DeviceTask(val id: String, val type: String, val leaseId: String, val payload: JSONObject)
data class DeviceCategory(val id: Int, val name: String, val parentId: Int?, val printer: String?)

class SimplesXApi(private val config: AppConfig) {
    private val appVersion = "1.5.3"
    private fun request(path: String, body: JSONObject, authenticated: Boolean = true): JSONObject {
        val base = config.deployUrl.trimEnd('/')
        val parsed = URL(base)
        val local = parsed.host in setOf("localhost", "127.0.0.1", "10.0.2.2")
        require(parsed.protocol == "https" || (local && parsed.protocol == "http")) {
            "O servidor deve usar HTTPS"
        }
        val connection = URL("$base/api$path").openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 15_000
            connection.readTimeout = 20_000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            if (authenticated) {
                connection.setRequestProperty("Authorization", "Bearer ${config.deviceToken}")
                connection.setRequestProperty("X-Device-Id", config.deviceId)
            }
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            val json = runCatching { JSONObject(text) }.getOrDefault(JSONObject())
            if (connection.responseCode !in 200..299) throw IllegalStateException(json.optString("error", "Servidor respondeu ${connection.responseCode}"))
            json
        } finally {
            connection.disconnect()
        }
    }

    fun pair(pairingId: String, code: String) {
        val response = request("/device/pair", JSONObject()
            .put("pairing_id", pairingId.trim()).put("code", code.trim())
            .put("device_id", config.deviceId).put("name", config.deviceName)
            .put("platform", "android").put("version", appVersion), authenticated = false)
        config.deviceToken = response.getString("device_token")
        config.tokenExpiresAt = response.optString("token_expires_at")
    }

    fun heartbeat(status: String = "online", error: String? = null) {
        request("/device/heartbeat", JSONObject().put("status", status).put("version", appVersion).apply {
            if (error != null) put("error", error.take(1000))
            put("printers", JSONArray().apply {
                config.printers.forEach { printer -> put(JSONObject()
                    .put("name", printer.name).put("connection", printer.connection.name.lowercase())
                    .put("protocol", printer.protocol.name.lowercase())
                    .put("width_mm", printer.widthMm).put("dpi", printer.dpi)) }
            })
        })
    }

    fun pullTasks(): List<DeviceTask> {
        val tasks = request("/device/tasks/pull", JSONObject()).optJSONArray("tasks") ?: JSONArray()
        return (0 until tasks.length()).map { index ->
            val item = tasks.getJSONObject(index)
            DeviceTask(item.getString("id"), item.getString("tipo"), item.getString("lease_id"), item.optJSONObject("payload") ?: JSONObject())
        }
    }

    fun printCategories(): List<DeviceCategory> {
        val categories = request("/device/print-config", JSONObject()).optJSONArray("categories") ?: JSONArray()
        return (0 until categories.length()).map { index ->
            val item = categories.getJSONObject(index)
            DeviceCategory(
                item.getInt("id"), item.getString("name"), item.optInt("parent_id").takeIf { it > 0 },
                item.optString("printer").takeIf { it.isNotBlank() },
            )
        }
    }

    fun updatePrinterCategories(printer: br.com.simplesx.gestor.data.PrinterConfig) {
        request("/device/printer-categories", JSONObject()
            .put("printer", printer.name).put("width_mm", printer.widthMm)
            .put("category_ids", JSONArray(printer.categoryIds)))
    }

    fun taskStatus(task: DeviceTask, status: String, code: String? = null, error: String? = null, resultPrinter: String? = null) {
        request("/device/tasks/${task.id}/status", JSONObject().put("status", status).put("lease_id", task.leaseId).apply {
            if (code != null) put("error_code", code)
            if (error != null) put("error_message", error.take(2000))
            if (status == "success") put("result", JSONObject().apply {
                put("printer", resultPrinter ?: config.printer.name)
                put("transport", config.printerFor(resultPrinter).connection.name.lowercase())
            })
        })
    }
}
