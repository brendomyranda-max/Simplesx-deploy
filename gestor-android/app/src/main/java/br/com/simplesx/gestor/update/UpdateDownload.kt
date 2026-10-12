package br.com.simplesx.gestor.update

import java.io.File

data class UpdateDownload(val release: UpdateRelease, val file: File)

/** Um clique novo consulta a publicação; voltar da permissão pode reutilizar o APK. */
fun prepareUpdateDownload(installedCode: Int, reuseDownloaded: Boolean, check: () -> UpdateRelease,
    cached: () -> UpdateDownload?, download: (UpdateRelease) -> File): UpdateDownload? {
    val saved = cached()?.takeIf { it.release.versionCode > installedCode }
    val release = (if (reuseDownloaded) saved?.release ?: check() else check()).validate()
    if (release.versionCode <= installedCode) return null
    return if (saved?.release == release) saved else UpdateDownload(release, download(release))
}
