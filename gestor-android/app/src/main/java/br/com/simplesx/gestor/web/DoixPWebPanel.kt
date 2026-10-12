package br.com.simplesx.gestor.web

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceError
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import br.com.simplesx.gestor.nfc.NfcScanActivity
import br.com.simplesx.gestor.nfc.NfcScanRequest

/** A tela web e o leitor NFC pertencem à mesma Activity em primeiro plano. */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun DoixPWebPanel(activity: ComponentActivity, deployUrl: String, nfcStatus: String, reading: NfcWebReading?, onClose: () -> Unit) {
    val base = remember(deployUrl) { doixpAddress(deployUrl) }
    var error by remember { mutableStateOf("") }
    val currentReading by rememberUpdatedState(reading)
    val browser = remember(activity, base) {
        WebView(activity).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.safeBrowsingEnabled = true
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val target = request.url.toString()
                    if (sameDoixPOrigin(base, target)) return false
                    if (request.isForMainFrame && request.hasGesture() && sameDoixPOrigin(base, view.url.orEmpty()) && request.url.scheme in setOf("intent", "doixp")) {
                        runCatching {
                            val data = if (request.url.scheme == "intent") Intent.parseUri(target, Intent.URI_INTENT_SCHEME).data else request.url
                            NfcScanRequest.parse(data.toString(), deployUrl)
                            activity.startActivity(Intent(activity, NfcScanActivity::class.java).setData(data))
                        }.onFailure { error = "Não foi possível abrir o leitor: ${it.message}" }
                        return true
                    }
                    if (request.isForMainFrame && request.url.scheme in setOf("https", "http")) {
                        runCatching { activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(target))) }
                        error = "Link externo aberto. Volte a esta tela para usar cartões NFC."
                    }
                    return true
                }
                override fun onReceivedError(view: WebView, request: WebResourceRequest, failure: WebResourceError) {
                    if (request.isForMainFrame) error = "Não foi possível abrir a DoixP. Confira a internet e toque em Recarregar."
                }
                override fun onPageFinished(view: WebView, url: String) {
                    view.requestFocus()
                    if (sameDoixPOrigin(base, url)) currentReading?.script(System.currentTimeMillis())?.let {
                        view.evaluateJavascript(it, null)
                    }
                }
            }
            loadUrl(base.toString() + "/restaurante")
        }
    }
    DisposableEffect(browser) {
        onDispose { browser.stopLoading(); browser.destroy() }
    }
    LaunchedEffect(browser, reading) {
        if (sameDoixPOrigin(base, browser.url.orEmpty())) reading?.script(System.currentTimeMillis())?.let {
            browser.evaluateJavascript(it, null)
        }
    }
    BackHandler { if (browser.canGoBack()) browser.goBack() else onClose() }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                OutlinedButton(onClick = onClose) { Text("Servidor") }
                OutlinedButton(onClick = { error = ""; browser.reload() }) { Text("Recarregar") }
            }
            Text(nfcStatus, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp))
            if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(8.dp))
            AndroidView(factory = { browser }, modifier = Modifier.fillMaxWidth().weight(1f))
        }
    }
}
