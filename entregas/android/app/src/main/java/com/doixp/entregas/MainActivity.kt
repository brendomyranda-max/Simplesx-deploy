package com.doixp.entregas

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.os.SystemClock
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.net.URI

class MainActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private val prefs by lazy { getSharedPreferences("doixp_connection", MODE_PRIVATE) }
    private var serverOrigin = ""
    private var webView: WebView? = null
    private var statusPanel: LinearLayout? = null
    private var statusText: TextView? = null
    private var progress: ProgressBar? = null
    private var connectionLabel: TextView? = null
    private var resumed = false
    private var pageFailed = false
    private var bridgeReady = false
    private var preparingTracking = false
    private var preparedForTracking = false
    private var permissionResult: ((Boolean) -> Unit)? = null
    private var locationListener: LocationListener? = null
    private var locationTimeout: Runnable? = null
    private var locationResult: ((Location?, String?) -> Unit)? = null
    private var activeDialog: AlertDialog? = null
    private var backCallback: OnBackInvokedCallback? = null
    private var backNavigationPending = false
    private var trackingStartGeneration = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 30) window.setDecorFitsSystemWindows(false)
        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = OnBackInvokedCallback { handleBack() }.also {
                onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, it)
            }
        }
        val configured = BuildConfig.SERVER_URL.ifBlank { prefs.getString("server", "") ?: "" }
        val normalized = runCatching { ServerAddress.normalize(configured, BuildConfig.DEBUG) }.getOrNull()
        if (normalized == null) showSetup() else openPlatform(normalized)
    }

    override fun onResume() {
        super.onResume()
        resumed = true
        webView?.onResume()
    }

    override fun onPause() {
        resumed = false
        webView?.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        if (Build.VERSION.SDK_INT >= 33) backCallback?.let { onBackInvokedDispatcher.unregisterOnBackInvokedCallback(it) }
        finishLocation(null, "A tela foi fechada. Tente novamente.")
        permissionResult?.invoke(false)
        permissionResult = null
        activeDialog?.dismiss()
        webView?.let { (it.parent as? ViewGroup)?.removeView(it); it.destroy() }
        webView = null
        // Online tracking belongs to the foreground service, not this screen.
        super.onDestroy()
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun text(value: String, size: Float = 16f) = TextView(this).apply {
        text = value
        textSize = size
        setTextColor(Color.rgb(24, 35, 47))
    }

    private fun button(value: String, action: () -> Unit) = Button(this).apply {
        text = value
        isAllCaps = false
        setOnClickListener { action() }
    }

    private fun installContent(root: View) {
        root.setBackgroundColor(Color.rgb(248, 250, 252))
        root.setOnApplyWindowInsetsListener { view, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout() or WindowInsets.Type.ime())
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            } else {
                // Older Android versions already fit the Activity content to the system bars.
                view.setPadding(0, 0, 0, 0)
            }
            insets
        }
        setContentView(root)
        root.requestApplyInsets()
    }

    private fun showSetup() {
        val outer = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER }
        val form = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(24), dp(24), dp(24), dp(24)) }
        form.addView(text("DoixP Entregas", 28f))
        form.addView(text("Conecte o aplicativo à sua plataforma de entregas.").apply { setPadding(0, dp(16), 0, dp(16)) })
        val address = EditText(this).apply {
            hint = "https://entregas.seudominio.com.br"
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine(true)
            setText(prefs.getString("server", ""))
        }
        form.addView(address)
        val error = text("", 14f).apply { setTextColor(Color.rgb(153, 27, 27)) }
        form.addView(error)
        form.addView(button("Entrar na plataforma") {
            try {
                val origin = ServerAddress.normalize(address.text.toString(), BuildConfig.DEBUG)
                prefs.edit().putString("server", origin).apply()
                openPlatform(origin)
            } catch (failure: IllegalArgumentException) {
                error.text = failure.message
            }
        })
        if (BuildConfig.DEBUG) form.addView(text("Desenvolvimento: use o IP local do computador ou http://10.0.2.2:3100 no emulador.", 13f))
        outer.addView(form, LinearLayout.LayoutParams(-1, -2))
        installContent(outer)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun openPlatform(origin: String) {
        webView?.let { (it.parent as? ViewGroup)?.removeView(it); it.destroy() }
        serverOrigin = origin
        bridgeReady = false
        preparedForTracking = false
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val toolbar = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL; setPadding(dp(12), dp(4), dp(8), dp(4)) }
        connectionLabel = text("DoixP Entregas", 15f)
        toolbar.addView(connectionLabel, LinearLayout.LayoutParams(0, -2, 1f))
        toolbar.addView(button("Recarregar") { loadHome() })
        if (BuildConfig.DEBUG || BuildConfig.SERVER_URL.isBlank()) toolbar.addView(button("Conexão") {
            if (DriverTrackingService.isRunning) {
                Toast.makeText(this, "Fique offline antes de alterar a conexão.", Toast.LENGTH_LONG).show()
            } else {
                activeDialog = AlertDialog.Builder(this).setTitle("Conexão da plataforma")
                    .setMessage(serverOrigin).setPositiveButton("Alterar") { _, _ ->
                        webView?.let { (it.parent as? ViewGroup)?.removeView(it); it.destroy() }
                        webView = null
                        showSetup()
                    }.setNegativeButton("Fechar", null).show()
            }
        })
        root.addView(toolbar)
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { max = 100 }
        root.addView(progress, LinearLayout.LayoutParams(-1, dp(3)))
        val frame = FrameLayout(this)
        val browser = WebView(this)
        webView = browser
        browser.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            @Suppress("DEPRECATION")
            allowFileAccessFromFileURLs = false
            @Suppress("DEPRECATION")
            allowUniversalAccessFromFileURLs = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setGeolocationEnabled(true)
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(true)
            safeBrowsingEnabled = true
            mediaPlaybackRequiresUserGesture = true
            userAgentString = "$userAgentString DoixPAndroid/${BuildConfig.VERSION_NAME}"
        }
        CookieManager.getInstance().apply { setAcceptCookie(true); setAcceptThirdPartyCookies(browser, false) }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        browser.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (sameOrigin(request.url.toString())) return false
                if (request.isForMainFrame && request.hasGesture()) openExternal(request.url)
                return true
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                if (url == null || !sameOrigin(url)) {
                    view.stopLoading()
                    showError("A navegação foi bloqueada porque saiu da plataforma configurada.")
                    return
                }
                pageFailed = false
                statusPanel?.visibility = View.GONE
                progress?.visibility = View.VISIBLE
                connectionLabel?.text = "Conectando…"
            }

            override fun onPageFinished(view: WebView, url: String?) {
                progress?.visibility = View.GONE
                if (!pageFailed) connectionLabel?.text = "DoixP Entregas"
                CookieManager.getInstance().flush()
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) showError("Não foi possível conectar à plataforma. Confira sua internet e tente novamente.")
            }

            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, error: WebResourceResponse) {
                if (request.isForMainFrame) showError("A plataforma respondeu com erro ${error.statusCode}. Tente novamente em instantes.")
            }

            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
                handler.cancel()
                showError("A conexão segura não pôde ser verificada. Confira o endereço e o certificado do servidor.")
            }
        }
        browser.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) { progress?.progress = newProgress }

            override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
                if (!sameOrigin(origin) || preparingTracking || !resumed) { callback.invoke(origin, false, false); return }
                requestLocationPermission(false) { granted -> callback.invoke(origin, granted, false) }
            }

            override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult): Boolean {
                if (!sameOrigin(url)) { result.cancel(); return true }
                activeDialog = AlertDialog.Builder(this@MainActivity).setMessage(message)
                    .setPositiveButton("OK") { _, _ -> result.confirm() }.setOnCancelListener { result.cancel() }.show()
                return true
            }

            override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult): Boolean {
                if (!sameOrigin(url)) { result.cancel(); return true }
                activeDialog = AlertDialog.Builder(this@MainActivity).setMessage(message)
                    .setPositiveButton("Confirmar") { _, _ -> result.confirm() }
                    .setNegativeButton("Cancelar") { _, _ -> result.cancel() }.setOnCancelListener { result.cancel() }.show()
                return true
            }

            override fun onJsPrompt(view: WebView, url: String, message: String, defaultValue: String?, result: JsPromptResult): Boolean {
                if (!sameOrigin(url)) { result.cancel(); return true }
                val input = EditText(this@MainActivity).apply { setText(defaultValue ?: "") }
                activeDialog = AlertDialog.Builder(this@MainActivity).setMessage(message).setView(input)
                    .setPositiveButton("Confirmar") { _, _ -> result.confirm(input.text.toString()) }
                    .setNegativeButton("Cancelar") { _, _ -> result.cancel() }.setOnCancelListener { result.cancel() }.show()
                return true
            }

            override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
                if (!isUserGesture || !sameOrigin(view.url ?: "")) return false
                val popup = WebView(this@MainActivity)
                popup.settings.apply { javaScriptEnabled = false; allowFileAccess = false; allowContentAccess = false }
                popup.webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(popupView: WebView, request: WebResourceRequest): Boolean {
                        if (request.isForMainFrame) {
                            // This callback cannot prove which opener frame was clicked.
                            // Keep popups on our origin; external links use the main frame client.
                            if (sameOrigin(request.url.toString())) browser.loadUrl(request.url.toString())
                        }
                        popup.destroy()
                        return true
                    }
                }
                (resultMsg.obj as WebView.WebViewTransport).webView = popup
                resultMsg.sendToTarget()
                handler.postDelayed({ runCatching { popup.destroy() } }, 10_000)
                return true
            }
        }
        frame.addView(browser, FrameLayout.LayoutParams(-1, -1))
        statusText = text("", 17f)
        statusPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(24), dp(24), dp(24), dp(24))
            setBackgroundColor(Color.rgb(248, 250, 252))
            visibility = View.GONE
            addView(statusText)
            addView(button("Tentar novamente") { loadHome() })
        }
        frame.addView(statusPanel, FrameLayout.LayoutParams(-1, -1))
        root.addView(frame, LinearLayout.LayoutParams(-1, 0, 1f))
        installContent(root)
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            showError("Atualize o Android System WebView na Google Play para usar este aplicativo.")
            return
        }
        WebViewCompat.addWebMessageListener(browser, "DoixPNative", setOf(origin)) { _, message, sourceOrigin, isMainFrame, reply ->
            if (isMainFrame && message.type == WebMessageCompat.TYPE_STRING && sameOrigin(sourceOrigin.toString())) {
                runOnUiThread { handleNativeMessage(message.data ?: "", reply) }
            }
        }
        bridgeReady = true
        loadHome()
    }

    private fun loadHome() {
        if (!bridgeReady) { showError("Atualize o Android System WebView na Google Play para usar este aplicativo."); return }
        pageFailed = false
        statusPanel?.visibility = View.GONE
        webView?.loadUrl("$serverOrigin/driver")
    }

    private fun showError(message: String) {
        pageFailed = true
        progress?.visibility = View.GONE
        connectionLabel?.text = "Sem conexão"
        statusText?.text = message
        statusPanel?.visibility = View.VISIBLE
    }

    private fun sameOrigin(value: String): Boolean = runCatching {
        val uri = URI(value)
        if (uri.rawUserInfo != null || uri.host == null) return@runCatching false
        ServerAddress.normalize("${uri.scheme}://${uri.rawAuthority}", BuildConfig.DEBUG) == serverOrigin
    }.getOrDefault(false)

    private fun openExternal(uri: Uri) {
        if (uri.scheme?.lowercase() !in setOf("https", "tel", "geo")) return
        if (uri.scheme == "https" && (uri.host.isNullOrBlank() || uri.userInfo != null)) return
        try { startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)) }
        catch (_: ActivityNotFoundException) { Toast.makeText(this, "Nenhum aplicativo disponível para abrir este link.", Toast.LENGTH_SHORT).show() }
    }

    private fun handleNativeMessage(raw: String, reply: JavaScriptReplyProxy) {
        if (raw.length > 16_384 || !sameOrigin(webView?.url ?: "")) return
        val request = runCatching { JSONObject(raw) }.getOrNull() ?: return
        val id = request.optString("id").takeIf { it.isNotBlank() && it.length <= 128 } ?: return
        val originAtRequest = serverOrigin
        fun respond(result: JSONObject? = null, error: String? = null) {
            if (isDestroyed || originAtRequest != serverOrigin || !sameOrigin(webView?.url ?: "")) return
            val response = JSONObject().put("id", id).put("ok", error == null)
            if (error != null) response.put("error", error) else response.put("result", result ?: JSONObject())
            runCatching { reply.postMessage(response.toString()) }
        }
        val args = request.optJSONObject("args") ?: JSONObject()
        when (request.optString("command")) {
            "prepareTracking" -> {
                if (!resumed || preparingTracking || permissionResult != null) { respond(error = "Aguarde a solicitação atual e mantenha o aplicativo aberto."); return }
                preparingTracking = true
                preparedForTracking = false
                activeDialog = AlertDialog.Builder(this).setTitle("Localização durante as entregas")
                    .setMessage("Enquanto você estiver online, o DoixP Entregas coleta e envia sua localização ao servidor da plataforma para disponibilizar ofertas e acompanhar suas entregas, inclusive em segundo plano, quando você usa outro aplicativo ou bloqueia a tela. Uma notificação mostrará esse acompanhamento. Para parar a coleta e o envio, toque em Ficar offline no aplicativo ou na notificação.\n\nPermitir a coleta e o envio da localização enquanto estiver online?")
                    .setPositiveButton("Permitir e continuar") { _, _ ->
                        requestLocationPermission(true) { granted ->
                            if (!granted) {
                                preparingTracking = false
                                respond(error = "Autorize a localização e as notificações para ficar online e receber ofertas de entregas.")
                            } else findFreshLocation { location, error ->
                                preparingTracking = false
                                if (location == null) respond(error = error ?: "Não foi possível obter sua localização.")
                                else {
                                    preparedForTracking = true
                                    respond(JSONObject().put("lat", location.latitude).put("lng", location.longitude))
                                }
                            }
                        }
                    }.setNegativeButton("Agora não") { _, _ -> preparingTracking = false; respond(error = "Localização não autorizada.") }
                    .setOnCancelListener { preparingTracking = false; respond(error = "Localização não autorizada.") }.show()
            }
            "startTracking" -> {
                if (!resumed || !preparedForTracking || !hasLocationPermission()) { respond(error = "Abra o aplicativo e autorize a localização antes de ficar online."); return }
                val cookie = CookieManager.getInstance().getCookie(serverOrigin)
                if (cookie.isNullOrBlank()) { respond(error = "Entre na sua conta novamente antes de ficar online."); return }
                try {
                    DriverTrackingService.start(this, serverOrigin, cookie)
                    preparedForTracking = false
                    val generation = ++trackingStartGeneration
                    val deadline = SystemClock.uptimeMillis() + 6_000L
                    fun confirmStarted() {
                        if (isDestroyed) return
                        if (generation != trackingStartGeneration) {
                            respond(error = "O início do acompanhamento foi cancelado.")
                        } else if (DriverTrackingService.isRunning) {
                            respond(JSONObject().put("tracking", true))
                        } else if (SystemClock.uptimeMillis() >= deadline) {
                            // The service may reject startForeground after start() returns.
                            // Report failure so the web app rolls its online status back.
                            stopService(Intent(this, DriverTrackingService::class.java))
                            respond(error = "O Android não iniciou o acompanhamento. Mantenha o aplicativo aberto e tente novamente.")
                        } else handler.postDelayed({ confirmStarted() }, 100L)
                    }
                    confirmStarted()
                } catch (_: Exception) { respond(error = "Não foi possível iniciar o acompanhamento. Mantenha o aplicativo aberto e tente novamente.") }
            }
            "stopTracking" -> {
                trackingStartGeneration++
                if (DriverTrackingService.isRunning) DriverTrackingService.stop(this)
                else stopService(Intent(this, DriverTrackingService::class.java))
                preparedForTracking = false
                respond(JSONObject().put("tracking", false))
            }
            "trackingStatus" -> respond(JSONObject().put("tracking", DriverTrackingService.isRunning))
            "share" -> {
                val value = args.optString("text")
                val urls = Regex("https?://[^\\s]+").findAll(value).map { it.value }.toList()
                if (value.isBlank() || value.length > 4000 || urls.isEmpty() || urls.any { !sameOrigin(it) }) {
                    respond(error = "Só é possível compartilhar links da sua plataforma."); return
                }
                try {
                    startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, value), "Compartilhar entrega"))
                    respond()
                } catch (_: ActivityNotFoundException) { respond(error = "Nenhum aplicativo disponível para compartilhar.") }
            }
            "navigate" -> {
                val lat = args.optDouble("lat", Double.NaN)
                val lng = args.optDouble("lng", Double.NaN)
                if (!lat.isFinite() || !lng.isFinite() || lat !in -90.0..90.0 || lng !in -180.0..180.0) { respond(error = "O endereço não tem coordenadas válidas."); return }
                val label = args.optString("label", "Entrega DoixP").take(120)
                val uri = Uri.parse("geo:$lat,$lng?q=$lat,$lng(${Uri.encode(label)})")
                try { startActivity(Intent(Intent.ACTION_VIEW, uri)); respond() }
                catch (_: ActivityNotFoundException) { respond(error = "Instale um aplicativo de mapas para iniciar a rota.") }
            }
            else -> respond(error = "Comando do aplicativo não reconhecido.")
        }
    }

    private fun hasLocationPermission() = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
        checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun requestLocationPermission(notifications: Boolean, callback: (Boolean) -> Unit) {
        if (permissionResult != null) { callback(false); return }
        val missing = mutableListOf<String>()
        if (!hasLocationPermission()) {
            missing += Manifest.permission.ACCESS_COARSE_LOCATION
            missing += Manifest.permission.ACCESS_FINE_LOCATION
        }
        if (notifications && Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) missing += Manifest.permission.POST_NOTIFICATIONS
        if (missing.isEmpty()) { callback(true); return }
        permissionResult = { locationGranted ->
            val notificationsGranted = !notifications || Build.VERSION.SDK_INT < 33 ||
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
            callback(locationGranted && notificationsGranted)
        }
        requestPermissions(missing.toTypedArray(), 201)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 201) {
            val callback = permissionResult
            permissionResult = null
            callback?.invoke(hasLocationPermission())
        }
    }

    @SuppressLint("MissingPermission")
    private fun findFreshLocation(callback: (Location?, String?) -> Unit) {
        if (locationResult != null) { callback(null, "Aguarde a localização atual."); return }
        val manager = getSystemService(LocationManager::class.java)
        val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).filter {
            runCatching { manager.isProviderEnabled(it) }.getOrDefault(false)
        }
        if (providers.isEmpty()) { callback(null, "Ative a localização do celular para ficar online."); return }
        val cached = providers.mapNotNull { runCatching { manager.getLastKnownLocation(it) }.getOrNull() }
            .filter { isFresh(it) }.minByOrNull { it.accuracy }
        if (cached != null) { callback(cached, null); return }
        locationResult = callback
        val listener = object : LocationListener {
            override fun onLocationChanged(location: Location) { if (isFresh(location)) finishLocation(location, null) }
            override fun onProviderEnabled(provider: String) = Unit
            override fun onProviderDisabled(provider: String) = Unit
            @Deprecated("Deprecated in Android")
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
        }
        locationListener = listener
        var requested = false
        providers.forEach { provider ->
            runCatching { manager.requestLocationUpdates(provider, 1_000L, 0f, listener, Looper.getMainLooper()) }.onSuccess { requested = true }
        }
        if (!requested) { finishLocation(null, "Autorize a localização e tente novamente."); return }
        locationTimeout = Runnable { finishLocation(null, "Não foi possível obter uma localização recente. Verifique o GPS e tente novamente.") }.also { handler.postDelayed(it, 20_000) }
    }

    private fun isFresh(location: Location): Boolean {
        val age = SystemClock.elapsedRealtimeNanos() - location.elapsedRealtimeNanos
        return age in 0..60_000_000_000L && location.latitude.isFinite() && location.longitude.isFinite() &&
            location.latitude in -90.0..90.0 && location.longitude in -180.0..180.0
    }

    private fun finishLocation(location: Location?, error: String?) {
        locationTimeout?.let { handler.removeCallbacks(it) }
        locationTimeout = null
        locationListener?.let { runCatching { getSystemService(LocationManager::class.java).removeUpdates(it) } }
        locationListener = null
        val callback = locationResult
        locationResult = null
        callback?.invoke(location, error)
    }

    @Deprecated("Uses platform back dispatch for the WebView history")
    override fun onBackPressed() = handleBack()

    private fun handleBack() {
        if (isDestroyed || isFinishing || permissionResult != null || backNavigationPending) return
        if (activeDialog?.isShowing == true) { activeDialog?.cancel(); return }
        val browser = webView
        if (browser == null || !sameOrigin(browser.url ?: "")) {
            finish()
            return
        }
        backNavigationPending = true
        browser.evaluateJavascript("""
            (() => {
                const dialogs = document.querySelectorAll('dialog[open]');
                const dialog = dialogs[dialogs.length - 1];
                if (!dialog) return false;
                dialog.close();
                return true;
            })()
        """.trimIndent()) { closedDialog ->
            backNavigationPending = false
            if (isDestroyed || isFinishing || webView !== browser || permissionResult != null ||
                !sameOrigin(browser.url ?: "")) return@evaluateJavascript
            if (closedDialog == "true") return@evaluateJavascript
            if (browser.canGoBack()) browser.goBack() else finish()
        }
    }
}
