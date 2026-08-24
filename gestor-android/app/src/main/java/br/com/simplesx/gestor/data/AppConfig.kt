package br.com.simplesx.gestor.data

import android.content.Context
import android.provider.Settings
import org.json.JSONObject

enum class ConnectionType { NETWORK, BLUETOOTH }

data class PrinterConfig(
    val name: String = "Impressora padrão",
    val connection: ConnectionType = ConnectionType.NETWORK,
    val host: String = "",
    val port: Int = 9100,
    val bluetoothAddress: String = "",
    val bluetoothName: String = "",
    val widthMm: Int = 80,
)

class AppConfig(context: Context) {
    private val prefs = context.getSharedPreferences("simplesx_gestor", Context.MODE_PRIVATE)
    val deviceId: String = "android-${Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)}"

    var deployUrl: String
        get() = prefs.getString("deploy_url", "https://simplesx-projeto-beta.pages.dev")!!
        set(value) = prefs.edit().putString("deploy_url", value.trim().trimEnd('/')).apply()
    var deviceName: String
        get() = prefs.getString("device_name", "Gestor Android")!!
        set(value) = prefs.edit().putString("device_name", value.trim()).apply()
    var deviceToken: String
        get() = prefs.getString("device_token", "")!!
        set(value) = prefs.edit().putString("device_token", value).apply()
    var tokenExpiresAt: String
        get() = prefs.getString("token_expires_at", "")!!
        set(value) = prefs.edit().putString("token_expires_at", value).apply()
    var serviceEnabled: Boolean
        get() = prefs.getBoolean("service_enabled", false)
        set(value) = prefs.edit().putBoolean("service_enabled", value).apply()
    var lastStatus: String
        get() = prefs.getString("last_status", "Parado")!!
        set(value) = prefs.edit().putString("last_status", value).apply()
    var lastJob: String
        get() = prefs.getString("last_job", "Nenhum")!!
        set(value) = prefs.edit().putString("last_job", value).apply()

    var defaultPrinterName: String
        get() = prefs.getString("default_printer_name", "")!!
        set(value) = prefs.edit().putString("default_printer_name", value.trim()).apply()

    var printers: List<PrinterConfig>
        get() {
            val saved = prefs.getString("printers", null)
            if (saved.isNullOrBlank()) return listOf(readLegacyPrinter())
            return runCatching {
                val array = org.json.JSONArray(saved)
                (0 until array.length()).map { printerFromJson(array.getJSONObject(it)) }
            }.getOrDefault(listOf(readLegacyPrinter())).ifEmpty { listOf(readLegacyPrinter()) }
        }
        set(value) {
            val normalized = value.distinctBy { it.name.trim().lowercase() }
            val array = org.json.JSONArray()
            normalized.forEach { array.put(printerToJson(it)) }
            prefs.edit().putString("printers", array.toString()).apply()
            if (normalized.none { it.name.equals(defaultPrinterName, ignoreCase = true) }) {
                defaultPrinterName = normalized.firstOrNull()?.name.orEmpty()
            }
        }

    var printer: PrinterConfig
        get() = printerFor(null)
        set(value) {
            val list = printers.toMutableList()
            val index = list.indexOfFirst { it.name.equals(value.name, ignoreCase = true) }
            if (index >= 0) list[index] = value else list.add(value)
            printers = list
            if (defaultPrinterName.isBlank()) defaultPrinterName = value.name
        }

    fun printerFor(route: String?): PrinterConfig {
        val list = printers
        val requested = route.orEmpty().trim()
        return list.firstOrNull { requested.isNotBlank() && it.name.equals(requested, ignoreCase = true) }
            ?: list.firstOrNull { it.name.equals(defaultPrinterName, ignoreCase = true) }
            ?: list.first()
    }

    private fun readLegacyPrinter(): PrinterConfig = printerFromJson(
        runCatching { JSONObject(prefs.getString("printer", "{}")!!) }.getOrDefault(JSONObject())
    )

    private fun printerFromJson(json: JSONObject) = PrinterConfig(
        name = json.optString("name", "Impressora padrão"),
        connection = runCatching { ConnectionType.valueOf(json.optString("connection", "NETWORK")) }.getOrDefault(ConnectionType.NETWORK),
        host = json.optString("host"), port = json.optInt("port", 9100),
        bluetoothAddress = json.optString("bluetoothAddress"), bluetoothName = json.optString("bluetoothName"),
        widthMm = json.optInt("widthMm", 80),
    )

    private fun printerToJson(value: PrinterConfig) = JSONObject().put("name", value.name)
        .put("connection", value.connection.name).put("host", value.host).put("port", value.port)
        .put("bluetoothAddress", value.bluetoothAddress).put("bluetoothName", value.bluetoothName)
        .put("widthMm", value.widthMm)
}
