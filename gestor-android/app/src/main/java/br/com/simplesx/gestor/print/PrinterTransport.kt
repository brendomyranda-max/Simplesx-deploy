package br.com.simplesx.gestor.print

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.Context
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import br.com.simplesx.gestor.data.ConnectionType
import br.com.simplesx.gestor.data.PrinterConfig
import java.net.InetSocketAddress
import java.net.Socket
import java.util.UUID

data class PairedPrinter(val name: String, val address: String)
data class UsbPrinter(val name: String, val deviceName: String, val vendorId: Int, val productId: Int)

object PrinterTransport {
    private val sppUuid: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

    fun pairedBluetooth(context: Context): List<PairedPrinter> {
        if (Build.VERSION.SDK_INT >= 31 && context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) return emptyList()
        val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter ?: return emptyList()
        return adapter.bondedDevices.orEmpty().map { PairedPrinter(it.name ?: it.address, it.address) }.sortedBy { it.name }
    }

    fun connectedUsb(context: Context): List<UsbPrinter> {
        val manager = context.getSystemService(UsbManager::class.java) ?: return emptyList()
        return manager.deviceList.values.filter { findBulkOut(it) != null }.map { device ->
            UsbPrinter(
                device.productName ?: "USB ${device.vendorId}:${device.productId}",
                device.deviceName, device.vendorId, device.productId,
            )
        }.sortedBy { it.name }
    }

    fun requestUsbPermission(context: Context, config: PrinterConfig) {
        val manager = context.getSystemService(UsbManager::class.java)
            ?: throw IllegalStateException("USB não disponível neste aparelho")
        val device = findUsbDevice(manager, config)
            ?: throw IllegalStateException("Conecte a impressora USB ao Android")
        if (manager.hasPermission(device)) return
        val intent = PendingIntent.getBroadcast(
            context, 9220, Intent(ACTION_USB_PERMISSION).setPackage(context.packageName),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        manager.requestPermission(device, intent)
    }

    fun send(context: Context, config: PrinterConfig, bytes: ByteArray) {
        when (config.connection) {
            ConnectionType.NETWORK -> sendNetwork(config, bytes)
            ConnectionType.BLUETOOTH -> sendBluetooth(context, config, bytes)
            ConnectionType.USB -> sendUsb(context, config, bytes)
        }
    }

    private fun sendNetwork(config: PrinterConfig, bytes: ByteArray) {
        require(config.host.isNotBlank()) { "Informe o IP da impressora" }
        Socket().use { socket ->
            socket.connect(InetSocketAddress(config.host.trim(), config.port), 10_000)
            socket.soTimeout = 10_000
            socket.getOutputStream().use { it.write(bytes); it.flush() }
        }
    }

    private fun sendBluetooth(context: Context, config: PrinterConfig, bytes: ByteArray) {
        if (Build.VERSION.SDK_INT >= 31 && context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            throw SecurityException("Autorize o acesso aos dispositivos Bluetooth")
        }
        require(config.bluetoothAddress.isNotBlank()) { "Selecione uma impressora Bluetooth pareada" }
        val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter
            ?: throw IllegalStateException("Bluetooth não disponível neste aparelho")
        check(adapter.isEnabled) { "Ative o Bluetooth" }
        val device = adapter.getRemoteDevice(config.bluetoothAddress)
        device.createRfcommSocketToServiceRecord(sppUuid).use { socket ->
            socket.connect()
            socket.outputStream.use { it.write(bytes); it.flush() }
        }
    }

    private fun sendUsb(context: Context, config: PrinterConfig, bytes: ByteArray) {
        val manager = context.getSystemService(UsbManager::class.java)
            ?: throw IllegalStateException("USB não disponível neste aparelho")
        val device = findUsbDevice(manager, config)
            ?: throw IllegalStateException("Impressora USB desconectada")
        check(manager.hasPermission(device)) { "Autorize o acesso à impressora USB" }
        val (usbInterface, endpoint) = findBulkOut(device)
            ?: throw IllegalStateException("A impressora não possui uma saída USB compatível")
        val connection = manager.openDevice(device)
            ?: throw IllegalStateException("Não foi possível abrir a impressora USB")
        try {
            check(connection.claimInterface(usbInterface, true)) { "Não foi possível acessar a interface USB" }
            try {
                var offset = 0
                while (offset < bytes.size) {
                    val size = minOf(16_384, bytes.size - offset)
                    val written = connection.bulkTransfer(endpoint, bytes, offset, size, 10_000)
                    check(written > 0) { "Falha ao enviar dados pela USB" }
                    offset += written
                }
            } finally {
                connection.releaseInterface(usbInterface)
            }
        } finally {
            connection.close()
        }
    }

    private fun findUsbDevice(manager: UsbManager, config: PrinterConfig): UsbDevice? =
        manager.deviceList.values.firstOrNull { it.deviceName == config.usbDeviceName }
            ?: manager.deviceList.values.firstOrNull {
                config.usbVendorId != 0 && it.vendorId == config.usbVendorId && it.productId == config.usbProductId
            }

    private fun findBulkOut(device: UsbDevice) = (0 until device.interfaceCount).asSequence()
        .map { device.getInterface(it) }
        .flatMap { usbInterface ->
            (0 until usbInterface.endpointCount).asSequence().map { usbInterface to usbInterface.getEndpoint(it) }
        }
        .firstOrNull { (_, endpoint) ->
            endpoint.type == UsbConstants.USB_ENDPOINT_XFER_BULK && endpoint.direction == UsbConstants.USB_DIR_OUT
        }

    const val ACTION_USB_PERMISSION = "br.com.simplesx.gestor.USB_PERMISSION"
}
