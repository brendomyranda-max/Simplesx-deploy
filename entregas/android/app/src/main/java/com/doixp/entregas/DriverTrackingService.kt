package com.doixp.entregas

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.text.NumberFormat
import java.util.Locale
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Location and offers run only during an explicitly started online session. */
class DriverTrackingService : Service(), LocationListener {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val worker = ScheduledThreadPoolExecutor(1).apply {
        removeOnCancelPolicy = true
        setExecuteExistingDelayedTasksAfterShutdownPolicy(false)
    }
    private val stopping = AtomicBoolean(false)
    private val offlineQueued = AtomicBoolean(false)
    private lateinit var locationManager: LocationManager
    private lateinit var notifications: NotificationManager
    @Volatile private var client: DeliveryHttpClient? = null
    @Volatile private var latestLocation: Location? = null
    @Volatile private var driverVerified = false
    @Volatile private var nextPoll: ScheduledFuture<*>? = null
    private var driverId = ""
    private var sessionStartedAt = 0L
    private var lastSentFixNanos = -1L
    private var failures = 0
    private var lastStatusText = ""
    private val notifiedOffers = LinkedHashSet<String>()
    private val displayedOffers = LinkedHashSet<String>()

    override fun onCreate() {
        super.onCreate()
        locationManager = getSystemService(LocationManager::class.java)
        notifications = getSystemService(NotificationManager::class.java)
        notifications.createNotificationChannel(NotificationChannel(
            TRACKING_CHANNEL, "Entregador online", NotificationManager.IMPORTANCE_LOW,
        ).apply { description = "Localização durante a disponibilidade para entregas." })
        notifications.createNotificationChannel(NotificationChannel(
            OFFERS_CHANNEL, "Novas entregas", NotificationManager.IMPORTANCE_DEFAULT,
        ).apply { description = "Ofertas de entregas enquanto você está online." })
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopTracking(null, markOffline = true)
            return START_NOT_STICKY
        }
        if (intent?.action != ACTION_START || stopping.get()) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (isRunning) return START_NOT_STICKY

        // Enter the foreground immediately, before network work or requesting GPS.
        try {
            val notification = trackingNotification("Iniciando acompanhamento de entregas…")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(TRACKING_NOTIFICATION, notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
            } else {
                startForeground(TRACKING_NOTIFICATION, notification)
            }
        } catch (_: RuntimeException) {
            stopSelf()
            return START_NOT_STICKY
        }
        val baseUrl = intent.getStringExtra(EXTRA_BASE_URL)
        val cookie = intent.getStringExtra(EXTRA_COOKIE)
        // Remove the token from the Intent as soon as it has been copied to memory.
        intent.removeExtra(EXTRA_COOKIE)
        if (!hasLocationPermission() || baseUrl.isNullOrBlank() || cookie.isNullOrBlank()) {
            stopTracking("Abra o aplicativo e autorize sua localização para ficar online.", false)
            return START_NOT_STICKY
        }
        client = runCatching { DeliveryHttpClient(baseUrl, cookie) }.getOrNull()
        if (client == null) {
            stopTracking("Endereço do servidor inválido. Confira a configuração no aplicativo.", false)
            return START_NOT_STICKY
        }
        sessionStartedAt = SystemClock.elapsedRealtime()
        notifications.cancel(STOPPED_NOTIFICATION)
        isRunning = true
        submit { initialiseSession() }
        return START_NOT_STICKY
    }

    private fun initialiseSession() {
        if (stopping.get()) return
        try {
            val api = client ?: return
            val user = api.get("/api/me").optJSONObject("user")
            if (user?.optString("role") != "driver" || user.optString("id").isBlank()) {
                stopTracking("Entre em uma conta de entregador para receber corridas.", false)
                return
            }
            driverId = user.getString("id")
            driverVerified = true
            if (stopping.get()) return
            // A location heartbeat must never implicitly place an offline driver online.
            val state = api.get("/api/state")
            if (!checkDriver(state)) return
            failures = 0
            mainHandler.post { subscribeToLocation() }
            announceOffers(state)
            updateStatus("Você está online. Aguardando novas entregas.")
            schedulePoll(NORMAL_POLL_SECONDS)
        } catch (error: Exception) {
            handleFailure(error, initialising = true)
        }
    }

    // Both permission variants are checked immediately before subscribing, and a
    // revocation between that check and the framework call is handled below.
    @SuppressLint("MissingPermission")
    private fun subscribeToLocation() {
        if (stopping.get()) return
        if (!hasLocationPermission()) {
            stopTracking("Permissão de localização removida. Você ficou offline.", true)
            return
        }
        var subscribed = false
        try {
            for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
                if (!locationManager.isProviderEnabled(provider)) continue
                try {
                    locationManager.requestLocationUpdates(provider, 15_000L, 0f, this, Looper.getMainLooper())
                    subscribed = true
                    locationManager.getLastKnownLocation(provider)?.let { acceptLocation(it) }
                } catch (_: SecurityException) {
                    // Approximate location may allow NETWORK while GPS requires FINE.
                } catch (_: IllegalArgumentException) {
                    // Some devices do not expose both providers.
                }
            }
        } catch (_: SecurityException) {
            // Permissions may have changed between checking and subscribing.
        }
        if (!subscribed) stopTracking("Ative a localização do aparelho para ficar online.", true)
    }

    override fun onLocationChanged(location: Location) { acceptLocation(location) }

    private fun acceptLocation(location: Location) {
        if (stopping.get() || !location.latitude.isFinite() || !location.longitude.isFinite() ||
            location.latitude !in -90.0..90.0 || location.longitude !in -180.0..180.0) return
        val age = fixAgeMillis(location)
        if (age !in 0..MAX_FIX_AGE_MILLIS) return
        val previous = latestLocation
        if (previous == null || location.elapsedRealtimeNanos > previous.elapsedRealtimeNanos) {
            latestLocation = Location(location)
        }
    }

    override fun onProviderDisabled(provider: String) {
        val locationEnabled = runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                locationManager.isLocationEnabled
            } else {
                locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
                    locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
            }
        }.getOrDefault(false)
        if (!stopping.get() && !locationEnabled) {
            stopTracking("Localização do aparelho desativada. Você ficou offline.", true)
        }
    }

    override fun onProviderEnabled(provider: String) = Unit

    @Deprecated("Required for compatibility with older Android versions")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit

    private fun poll() {
        if (stopping.get()) return
        if (!hasLocationPermission()) {
            stopTracking("Permissão de localização removida. Você ficou offline.", true)
            return
        }
        val fix = latestLocation
        val locationSilence = fix?.let { fixAgeMillis(it) }
            ?: (SystemClock.elapsedRealtime() - sessionStartedAt)
        if (locationSilence > MAX_LOCATION_SILENCE_MILLIS) {
            stopTracking("Não foi possível atualizar sua localização. Abra o app para ficar online novamente.", true)
            return
        }
        try {
            val api = client ?: return
            if (fix != null && fixAgeMillis(fix) in 0..MAX_FIX_AGE_MILLIS &&
                fix.elapsedRealtimeNanos > lastSentFixNanos) {
                val profile = api.post("/api/location", JSONObject()
                    .put("lat", fix.latitude).put("lng", fix.longitude))
                if (!checkProfile(profile)) return
                lastSentFixNanos = fix.elapsedRealtimeNanos
            }
            if (stopping.get()) return
            val state = api.get("/api/state")
            if (!checkDriver(state)) return
            failures = 0
            announceOffers(state)
            updateStatus(if (fix == null || fixAgeMillis(fix) > MAX_FIX_AGE_MILLIS)
                "Aguardando uma localização atualizada…"
            else "Você está online. Aguardando novas entregas.")
            schedulePoll(NORMAL_POLL_SECONDS)
        } catch (error: Exception) {
            handleFailure(error, initialising = false)
        }
    }

    private fun checkDriver(state: JSONObject): Boolean {
        val drivers = state.optJSONArray("drivers")
        if (drivers != null) {
            for (index in 0 until drivers.length()) {
                val profile = drivers.optJSONObject(index) ?: continue
                if (profile.optString("id") == driverId) return checkProfile(profile)
            }
        }
        stopTracking("Cadastro de entregador indisponível. Entre novamente no aplicativo.", true)
        return false
    }

    private fun checkProfile(profile: JSONObject): Boolean {
        if (stopping.get()) return false
        if (profile.optBoolean("suspended", false)) {
            stopTracking("Cadastro suspenso. Procure o suporte no aplicativo.", true)
            return false
        }
        if (!profile.optBoolean("online", false)) {
            stopTracking("Você está offline. Abra o aplicativo para ficar online novamente.", false)
            return false
        }
        return true
    }

    private fun handleFailure(error: Exception, initialising: Boolean) {
        if (stopping.get()) return
        if (error is DeliveryHttpException && error.statusCode in listOf(401, 403)) {
            stopTracking("Sessão encerrada ou acesso indisponível. Entre novamente no aplicativo.", false)
            return
        }
        failures = (failures + 1).coerceAtMost(2)
        updateStatus("Sem conexão com o servidor. Tentando reconectar…")
        val delay = if (failures == 1) 30L else 60L
        nextPoll = worker.schedule({
            if (initialising) initialiseSession() else poll()
        }, delay, TimeUnit.SECONDS)
    }

    private fun schedulePoll(delaySeconds: Long) {
        if (!stopping.get()) nextPoll = worker.schedule({ poll() }, delaySeconds, TimeUnit.SECONDS)
    }

    private fun announceOffers(state: JSONObject) {
        if (stopping.get()) return
        val orders = state.optJSONArray("orders")
        if (orders == null) {
            clearOfferNotification()
            return
        }
        for (index in 0 until orders.length()) {
            val order = orders.optJSONObject(index) ?: continue
            if (order.optString("driverId") == driverId &&
                order.optString("status") in ACTIVE_DELIVERY_STATES) {
                // An assigned delivery must be finished before another can be accepted.
                // Clear remembered offers so current offers can be announced afterward.
                notifiedOffers.clear()
                clearOfferNotification()
                return
            }
        }
        val newOffers = mutableListOf<JSONObject>()
        val currentOffers = LinkedHashSet<String>()
        for (index in 0 until orders.length()) {
            val order = orders.optJSONObject(index) ?: continue
            val id = order.optString("id")
            if (id.isBlank() || order.optString("status") != "searching" || order.optBoolean("held")) continue
            // The API orders newest first. Limit the visible offer window to bound
            // memory without repeatedly announcing an overflowing snapshot.
            if (currentOffers.size == MAX_REMEMBERED_OFFERS) break
            if (currentOffers.add(id) && !notifiedOffers.contains(id)) newOffers.add(order)
        }
        notifiedOffers.clear()
        notifiedOffers.addAll(currentOffers)
        if (currentOffers.isEmpty() || displayedOffers.any { it !in currentOffers }) {
            clearOfferNotification()
        }
        if (newOffers.isEmpty()) return
        displayedOffers.clear()
        newOffers.forEach { displayedOffers.add(it.getString("id")) }
        val first = newOffers.first()
        val money = NumberFormat.getCurrencyInstance(Locale.forLanguageTag("pt-BR"))
            .format(first.optLong("totalCents", 0L) / 100.0)
        val title = if (newOffers.size == 1) "Nova entrega • $money"
            else "${newOffers.size} novas entregas disponíveis"
        val detail = if (newOffers.size == 1) "Abra o aplicativo para ver a rota e aceitar."
            else "Uma das ofertas: $money. Abra o aplicativo para conferir."
        notifySafely(OFFERS_NOTIFICATION, Notification.Builder(this, OFFERS_CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(detail)
            .setContentIntent(openAppIntent())
            .setAutoCancel(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setCategory(Notification.CATEGORY_EVENT)
            .build())
    }

    private fun clearOfferNotification() {
        displayedOffers.clear()
        notifications.cancel(OFFERS_NOTIFICATION)
    }

    private fun updateStatus(message: String) {
        if (stopping.get() || lastStatusText == message) return
        lastStatusText = message
        notifySafely(TRACKING_NOTIFICATION, trackingNotification(message))
    }

    private fun trackingNotification(message: String): Notification {
        val stopIntent = PendingIntent.getService(this, 2,
            Intent(this, DriverTrackingService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, TRACKING_CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("DoixP Entregas • Entregador online")
            .setContentText(message)
            .setContentIntent(openAppIntent())
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setCategory(Notification.CATEGORY_SERVICE)
            .addAction(Notification.Action.Builder(null, "Ficar offline", stopIntent).build())
            .build()
    }

    private fun openAppIntent(): PendingIntent = PendingIntent.getActivity(this, 1,
        Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    private fun notifySafely(id: Int, notification: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED) return
        try {
            notifications.notify(id, notification)
        } catch (_: SecurityException) {
            // Notification permission can be revoked while the service is active.
        }
    }

    private fun stopTracking(reason: String?, markOffline: Boolean) {
        if (!stopping.compareAndSet(false, true)) return
        isRunning = false
        nextPoll?.cancel(false)
        client?.cancelPending()
        if (markOffline) queueOffline()
        else offlineQueued.set(true)
        mainHandler.post {
            removeLocationUpdates()
            stopForeground(STOP_FOREGROUND_REMOVE)
            notifications.cancel(OFFERS_NOTIFICATION)
            if (reason != null) notifySafely(STOPPED_NOTIFICATION,
                Notification.Builder(this, TRACKING_CHANNEL)
                    .setSmallIcon(R.drawable.ic_notification)
                    .setContentTitle("Acompanhamento de entregas encerrado")
                    .setContentText(reason)
                    .setStyle(Notification.BigTextStyle().bigText(reason))
                    .setContentIntent(openAppIntent())
                    .setAutoCancel(true)
                    .setVisibility(Notification.VISIBILITY_PRIVATE)
                    .build())
            stopSelf()
        }
    }

    private fun queueOffline() {
        if (!driverVerified || !offlineQueued.compareAndSet(false, true)) return
        val api = client ?: return
        submit { runCatching { api.post("/api/availability", JSONObject().put("online", false)) } }
    }

    private fun removeLocationUpdates() {
        try { locationManager.removeUpdates(this) } catch (_: SecurityException) { }
        latestLocation = null
    }

    private fun submit(block: () -> Unit) {
        try { worker.execute(block) } catch (_: RejectedExecutionException) { }
    }

    private fun hasLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun fixAgeMillis(location: Location): Long =
        (SystemClock.elapsedRealtimeNanos() - location.elapsedRealtimeNanos) / 1_000_000L

    override fun onDestroy() {
        val wasStopping = stopping.getAndSet(true)
        isRunning = false
        nextPoll?.cancel(false)
        if (!wasStopping) client?.cancelPending()
        removeLocationUpdates()
        queueOffline()
        // Put shutdown behind the offline request in the same FIFO executor.
        // This preserves the attempt even on implementations that discard queued
        // execute() tasks when delayed-task execution after shutdown is disabled.
        try {
            worker.execute { worker.shutdown() }
        } catch (_: RejectedExecutionException) {
            worker.shutdown()
        }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        @Volatile var isRunning: Boolean = false
            private set
        private const val ACTION_START = "com.doixp.entregas.START_TRACKING"
        private const val ACTION_STOP = "com.doixp.entregas.STOP_TRACKING"
        private const val EXTRA_BASE_URL = "server_url"
        private const val EXTRA_COOKIE = "session_cookie"
        private const val TRACKING_CHANNEL = "driver_tracking"
        private const val OFFERS_CHANNEL = "delivery_offers"
        private const val TRACKING_NOTIFICATION = 1001
        private const val OFFERS_NOTIFICATION = 1002
        private const val STOPPED_NOTIFICATION = 1003
        private const val NORMAL_POLL_SECONDS = 20L
        private const val MAX_FIX_AGE_MILLIS = 60_000L
        private const val MAX_LOCATION_SILENCE_MILLIS = 90_000L
        private const val MAX_REMEMBERED_OFFERS = 256
        private val ACTIVE_DELIVERY_STATES = setOf("accepted", "in_transit", "incident")

        /** Call while the Activity is visible, after permissions and online confirmation. */
        fun start(context: Context, baseUrl: String, cookie: String) {
            ContextCompat.startForegroundService(context,
                Intent(context, DriverTrackingService::class.java)
                    .setAction(ACTION_START)
                    .putExtra(EXTRA_BASE_URL, baseUrl)
                    .putExtra(EXTRA_COOKIE, cookie))
        }

        fun stop(context: Context) {
            if (isRunning) context.startService(
                Intent(context, DriverTrackingService::class.java).setAction(ACTION_STOP))
        }
    }
}
