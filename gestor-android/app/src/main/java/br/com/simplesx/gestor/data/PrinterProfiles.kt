package br.com.simplesx.gestor.data

import android.content.Context
import org.json.JSONObject

data class PrinterProfile(val id: String, val label: String, val protocol: String,
    val widthMm: Int, val columnsNormal: Int?, val dpi: Int, val cutMode: CutMode,
    val feedLines: Int, val notes: String) {
    fun applyTo(printer: PrinterConfig): PrinterConfig {
        require(protocol != "DRIVER") { "Este modelo precisa do driver no servidor desktop ou de integração específica do fabricante no Android." }
        return printer.copy(protocol = PrinterProtocol.valueOf(protocol), widthMm = widthMm,
            columnsNormal = columnsNormal, dpi = dpi, cutMode = cutMode, feedLines = feedLines)
    }
}

object PrinterProfiles {
    fun load(context: Context): List<PrinterProfile> {
        val json = context.assets.open("printer-profiles.json").bufferedReader().use { JSONObject(it.readText()) }
        require(json.getInt("schemaVersion") == 1)
        val profiles = json.getJSONArray("profiles")
        return (0 until profiles.length()).map { index ->
            val p = profiles.getJSONObject(index)
            PrinterProfile(p.getString("id"), p.getString("label"), p.getString("protocol"),
                p.getInt("widthMm"), p.optInt("columnsNormal").takeIf { it in 8..160 },
                p.getInt("dpi"), CutMode.valueOf(p.getString("cutMode")), p.getInt("feedLines"), p.getString("notes"))
        }
    }
}
