package br.com.simplesx.gestor.update

data class UpdateRelease(val version: String, val versionCode: Int, val url: String, val sha256: String, val size: Long) {
    fun validate(): UpdateRelease {
        require(Regex("[0-9]+\\.[0-9]+\\.[0-9]+").matches(version) && versionCode > 0) { "Versão de atualização inválida" }
        require(url == "https://github.com/brendomyranda-max/Simplesx-deploy/releases/download/gestor-v$version/servidor-doixp-android.apk") {
            "Endereço de atualização não autorizado"
        }
        require(Regex("[a-f0-9]{64}").matches(sha256) && size in 1..100_000_000L) { "Arquivo de atualização inválido" }
        return this
    }
}
