package br.com.simplesx.gestor.update

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import br.com.simplesx.gestor.BuildConfig
import org.json.JSONObject
import java.io.File
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

class AppUpdater(private val context: Context) {
    private val directory get() = File(context.cacheDir, "updates").apply { mkdirs() }
    private fun releaseJson(release: UpdateRelease) = JSONObject().put("version", release.version)
        .put("versionCode", release.versionCode).put("url", release.url).put("sha256", release.sha256).put("size", release.size)
    private fun parseRelease(json: JSONObject) = UpdateRelease(json.getString("version"), json.getInt("versionCode"),
        json.getString("url"), json.getString("sha256"), json.getLong("size")).validate()

    // As configurações de permissão podem recriar a Activity no Samsung.
    // Recupera o download validado para continuar a instalação ao voltar.
    fun cachedRelease(): UpdateRelease? = runCatching {
        val release = parseRelease(JSONObject(File(directory, "release.json").readText()))
        check(release.versionCode > BuildConfig.VERSION_CODE)
        validateApk(File(directory, "servidor-doixp.apk"), release)
        release
    }.getOrNull()

    fun cachedApk() = File(directory, "servidor-doixp.apk")
    private fun connection(url: String): HttpURLConnection = (URL(url).openConnection() as HttpURLConnection).apply {
        connectTimeout = 15_000
        readTimeout = 30_000
        setRequestProperty("User-Agent", "ServidorDoixP/${BuildConfig.VERSION_NAME}")
        useCaches = false
        setRequestProperty("Cache-Control", "no-cache")
    }

    fun check(): UpdateRelease {
        val connection = connection("https://doixp.com/atualizacoes/android.json")
        try {
            check(connection.responseCode == 200 && connection.url.protocol == "https") { "Não foi possível consultar atualizações (HTTP ${connection.responseCode})" }
            val bytes = connection.inputStream.use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(4096)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    check(output.size() + count <= 65_536) { "Resposta de atualização inválida" }
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            }
            val json = JSONObject(bytes.toString(Charsets.UTF_8))
            return parseRelease(json)
        } finally { connection.disconnect() }
    }

    fun download(release: UpdateRelease, progress: (Int) -> Unit): File {
        release.validate()
        check(release.versionCode > BuildConfig.VERSION_CODE) { "O servidor já está atualizado" }
        val target = File(directory, "servidor-doixp.apk")
        val partial = File(directory, "servidor-doixp.part")
        val digest = MessageDigest.getInstance("SHA-256")
        val connection = connection(release.url)
        try {
            check(connection.responseCode == 200 && connection.url.protocol == "https") { "Não foi possível baixar o APK" }
            var total = 0L
            var lastPercent = -1
            connection.inputStream.use { input ->
                partial.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        total += count
                        check(total <= release.size) { "Tamanho do APK inválido" }
                        output.write(buffer, 0, count)
                        digest.update(buffer, 0, count)
                        val percent = (total * 100 / release.size).toInt()
                        if (percent != lastPercent) { progress(percent); lastPercent = percent }
                    }
                }
            }
            check(total == release.size && digest.digest().hex() == release.sha256) { "Download incompleto ou corrompido. Tente novamente." }
            validateApk(partial, release)
            check(partial.renameTo(target)) { "Não foi possível salvar o APK" }
            File(directory, "release.json").writeText(releaseJson(release).toString())
            return target
        } finally { connection.disconnect(); partial.delete() }
    }

    @Suppress("DEPRECATION")
    fun validateApk(file: File, release: UpdateRelease) {
        check(file.isFile && file.length() == release.size) { "Baixe a atualização novamente" }
        val hash = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) { val count = input.read(buffer); if (count < 0) break; hash.update(buffer, 0, count) }
        }
        check(hash.digest().hex() == release.sha256) { "O APK foi alterado. Baixe novamente." }
        val manager = context.packageManager
        val archive = manager.getPackageArchiveInfo(file.absolutePath, PackageManager.GET_SIGNATURES)
            ?: error("APK inválido")
        check(archive.packageName == context.packageName && archive.versionName == release.version) { "O APK não corresponde ao Servidor DoixP" }
        val code = if (Build.VERSION.SDK_INT >= 28) archive.longVersionCode else archive.versionCode.toLong()
        check(code == release.versionCode.toLong() && code > BuildConfig.VERSION_CODE) { "Versão de APK inválida" }
        val installed = manager.getPackageInfo(context.packageName, PackageManager.GET_SIGNATURES)
        val currentSigners = installed.signatures.orEmpty().map { it.toByteArray().hex() }.toSet()
        val newSigners = archive.signatures.orEmpty().map { it.toByteArray().hex() }.toSet()
        check(currentSigners.isNotEmpty() && newSigners == currentSigners) {
            "A assinatura deste app é diferente da versão oficial. A atualização não pode substituir esta instalação."
        }
    }

    private fun ByteArray.hex() = joinToString("") { "%02x".format(it.toInt() and 0xff) }
}
