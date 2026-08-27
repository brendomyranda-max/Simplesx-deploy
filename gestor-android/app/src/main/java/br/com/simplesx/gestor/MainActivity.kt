package br.com.simplesx.gestor

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import br.com.simplesx.gestor.data.AppConfig
import br.com.simplesx.gestor.data.ConnectionType
import br.com.simplesx.gestor.data.PrinterConfig
import br.com.simplesx.gestor.data.PrinterProtocol
import br.com.simplesx.gestor.data.TsplPaperMode
import br.com.simplesx.gestor.network.SimplesXApi
import br.com.simplesx.gestor.network.DeviceCategory
import br.com.simplesx.gestor.print.PrinterCommands
import br.com.simplesx.gestor.print.PrinterTransport
import br.com.simplesx.gestor.print.UsbPrinter
import br.com.simplesx.gestor.sync.PrintSyncService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val config = AppConfig(this)
        if (config.deviceToken.isNotBlank()) PrintSyncService.start(this)
        setContent { MaterialTheme { GestorScreen() } }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun GestorScreen() {
    val context = LocalContext.current
    val config = remember { AppConfig(context) }
    var deployUrl by remember { mutableStateOf(config.deployUrl) }
    var deviceName by remember { mutableStateOf(config.deviceName) }
    var pairingId by remember { mutableStateOf("") }
    var pairingCode by remember { mutableStateOf("") }
    var printers by remember { mutableStateOf(config.printers) }
    var selectedPrinterIndex by remember { mutableStateOf(0) }
    var printer by remember { mutableStateOf(printers.first()) }
    var dpiInput by remember { mutableStateOf(printer.dpi.toString()) }
    var serviceEnabled by remember { mutableStateOf(config.serviceEnabled) }
    var message by remember { mutableStateOf(config.lastStatus) }
    var bluetoothPrinters by remember { mutableStateOf(PrinterTransport.pairedBluetooth(context)) }
    var bluetoothExpanded by remember { mutableStateOf(false) }
    var usbPrinters by remember { mutableStateOf(PrinterTransport.connectedUsb(context)) }
    var usbExpanded by remember { mutableStateOf(false) }
    var deployCategories by remember { mutableStateOf<List<DeviceCategory>>(emptyList()) }
    var openBluetoothAfterPermission by remember { mutableStateOf(false) }

    val permissions = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        val bluetoothAllowed = Build.VERSION.SDK_INT < 31 ||
            context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
        if (bluetoothAllowed) {
            bluetoothPrinters = PrinterTransport.pairedBluetooth(context)
            if (openBluetoothAfterPermission) bluetoothExpanded = true
        } else {
            message = "Permissão Bluetooth negada. Autorize Dispositivos próximos nas configurações do aplicativo."
        }
        openBluetoothAfterPermission = false
    }
    fun requestPermissions(openBluetoothPicker: Boolean = false) {
        val required = buildList {
            if (Build.VERSION.SDK_INT >= 31) add(Manifest.permission.BLUETOOTH_CONNECT)
            if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
        }.filter { context.checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (required.isNotEmpty()) {
            openBluetoothAfterPermission = openBluetoothPicker
            permissions.launch(required.toTypedArray())
        } else if (openBluetoothPicker) {
            bluetoothPrinters = PrinterTransport.pairedBluetooth(context)
            bluetoothExpanded = true
        }
    }

    fun background(block: () -> String) {
        CoroutineScope(Dispatchers.IO).launch {
            val result = runCatching(block).fold({ it }, { "Erro: ${it.message}" })
            withContext(Dispatchers.Main) { message = result }
        }
    }

    fun refreshCategories() {
        if (config.deviceToken.isBlank()) return
        CoroutineScope(Dispatchers.IO).launch {
            val result = runCatching { SimplesXApi(config).printCategories() }
            withContext(Dispatchers.Main) {
                result.fold({ categories ->
                    deployCategories = categories
                    val synced = printers.map { saved ->
                        saved.copy(categoryIds = categories.filter { it.printer.equals(saved.name, ignoreCase = true) }.map { it.id })
                    }
                    printers = synced
                    config.printers = synced
                    if (selectedPrinterIndex in synced.indices) printer = synced[selectedPrinterIndex]
                }, { message = "Erro ao carregar categorias: ${it.message}" })
            }
        }
    }

    LaunchedEffect(config.deviceToken) { refreshCategories() }

    Scaffold(topBar = { TopAppBar(title = { Text("SimplesX Gestor") }) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            StatusCard(serviceEnabled, config.deviceToken.isNotBlank(), message, config.lastJob)

            Section("Conexão com o SimplesX") {
                OutlinedTextField(deployUrl, { deployUrl = it }, label = { Text("Endereço do SimplesX") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(deviceName, { deviceName = it }, label = { Text("Nome deste gestor") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                if (config.deviceToken.isBlank()) {
                    OutlinedTextField(pairingId, { pairingId = it }, label = { Text("ID do pareamento") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(pairingCode, { pairingCode = it.uppercase() }, label = { Text("Código de pareamento") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Button(onClick = {
                        config.deployUrl = deployUrl; config.deviceName = deviceName
                        background {
                            SimplesXApi(config).pair(pairingId, pairingCode)
                            PrintSyncService.start(context)
                            "Pareamento concluído e recepção iniciada"
                        }
                    }, modifier = Modifier.fillMaxWidth()) { Text("Parear aparelho") }
                } else Text("Aparelho pareado · ${config.deviceId}", color = MaterialTheme.colorScheme.primary)
            }

            Section("Impressoras") {
                Text("Cadastre uma rota para cada impressora. O nome deve ser igual ao nome configurado no SimplesX (ex.: Cozinha, Bar ou Caixa).", style = MaterialTheme.typography.bodySmall)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    printers.forEachIndexed { index, item ->
                        OutlinedButton(onClick = {
                            selectedPrinterIndex = index
                            printer = item
                            dpiInput = item.dpi.toString()
                        }, modifier = Modifier.weight(1f)) {
                            Text(item.name, maxLines = 1)
                        }
                    }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = {
                        selectedPrinterIndex = -1
                        printer = PrinterConfig(name = "Nova rota", connection = ConnectionType.BLUETOOTH, widthMm = 58)
                        dpiInput = printer.dpi.toString()
                    }, modifier = Modifier.weight(1f)) { Text("Adicionar") }
                    if (printers.size > 1 && selectedPrinterIndex >= 0) {
                        OutlinedButton(onClick = {
                            printers = printers.filterIndexed { index, _ -> index != selectedPrinterIndex }
                            config.printers = printers
                            selectedPrinterIndex = 0
                            printer = printers.first()
                            dpiInput = printer.dpi.toString()
                        }, modifier = Modifier.weight(1f)) { Text("Excluir") }
                    }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { printer = printer.copy(connection = ConnectionType.NETWORK) }, modifier = Modifier.weight(1f)) { Text("Rede") }
                    Button(onClick = {
                        printer = printer.copy(connection = ConnectionType.BLUETOOTH)
                        requestPermissions(openBluetoothPicker = true)
                    }, modifier = Modifier.weight(1f)) { Text("Bluetooth") }
                    Button(onClick = {
                        printer = printer.copy(connection = ConnectionType.USB)
                        usbPrinters = PrinterTransport.connectedUsb(context)
                        usbExpanded = true
                    }, modifier = Modifier.weight(1f)) { Text("USB") }
                }
                OutlinedTextField(printer.name, { printer = printer.copy(name = it) }, label = { Text("Nome da rota no SimplesX") }, modifier = Modifier.fillMaxWidth())
                Text("Protocolo", fontWeight = FontWeight.Bold)
                Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    PrinterProtocol.entries.chunked(2).forEach { row ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            row.forEach { protocol ->
                                if (printer.protocol == protocol) {
                                    Button(onClick = { printer = printer.copy(protocol = protocol) }, modifier = Modifier.weight(1f)) {
                                        Text(protocol.name.replace('_', '/'))
                                    }
                                } else {
                                    OutlinedButton(onClick = { printer = printer.copy(protocol = protocol) }, modifier = Modifier.weight(1f)) {
                                        Text(protocol.name.replace('_', '/'))
                                    }
                                }
                            }
                            if (row.size == 1) Spacer(Modifier.weight(1f))
                        }
                    }
                }
                Text("Selecionado: ${PrinterCommands.displayName(printer.protocol)}", style = MaterialTheme.typography.bodySmall)
                if (printer.protocol != PrinterProtocol.ESC_POS) {
                    Text("Tipo de papel/etiqueta", fontWeight = FontWeight.Bold)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        OutlinedButton(onClick = { printer = printer.copy(tsplPaperMode = TsplPaperMode.CONTINUOUS) }, modifier = Modifier.weight(1f)) { Text("Contínuo") }
                        OutlinedButton(onClick = { printer = printer.copy(tsplPaperMode = TsplPaperMode.GAP) }, modifier = Modifier.weight(1f)) { Text("Etiqueta") }
                        OutlinedButton(onClick = { printer = printer.copy(tsplPaperMode = TsplPaperMode.BLACK_MARK) }, modifier = Modifier.weight(1f)) { Text("Marca") }
                    }
                    Text(
                        when (printer.tsplPaperMode) {
                            TsplPaperMode.CONTINUOUS -> "Contínuo selecionado: a altura acompanha somente o conteúdo."
                            TsplPaperMode.GAP -> "Etiqueta com espaço selecionada: informe a altura física e o espaço."
                            TsplPaperMode.BLACK_MARK -> "Papel com marca preta selecionado: informe a altura e o tamanho da marca."
                        }, style = MaterialTheme.typography.bodySmall,
                    )
                    if (printer.tsplPaperMode != TsplPaperMode.CONTINUOUS) {
                        OutlinedTextField(
                            printer.labelHeightMm.toString(),
                            { value -> value.toIntOrNull()?.takeIf { it in 10..500 }?.let { printer = printer.copy(labelHeightMm = it) } },
                            label = { Text("Altura da etiqueta (mm)") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                        )
                        OutlinedTextField(
                            printer.gapMm.toString(),
                            { value -> value.toIntOrNull()?.takeIf { it in 1..20 }?.let { printer = printer.copy(gapMm = it) } },
                            label = { Text(if (printer.tsplPaperMode == TsplPaperMode.GAP) "Espaço entre etiquetas (mm)" else "Tamanho da marca preta (mm)") },
                            singleLine = true, modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
                if (printer.connection == ConnectionType.NETWORK) {
                    OutlinedTextField(printer.host, { printer = printer.copy(host = it) }, label = { Text("IP da impressora") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(printer.port.toString(), { printer = printer.copy(port = it.toIntOrNull() ?: 9100) }, label = { Text("Porta") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                } else if (printer.connection == ConnectionType.BLUETOOTH) {
                    ExposedDropdownMenuBox(expanded = bluetoothExpanded, onExpandedChange = { expand ->
                        if (expand) requestPermissions(openBluetoothPicker = true) else bluetoothExpanded = false
                    }) {
                        OutlinedTextField(printer.bluetoothName.ifBlank { "Selecione um dispositivo pareado" }, {}, readOnly = true,
                            label = { Text("Impressora Bluetooth") }, trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(bluetoothExpanded) },
                            modifier = Modifier.menuAnchor().fillMaxWidth())
                        ExposedDropdownMenu(bluetoothExpanded, { bluetoothExpanded = false }) {
                            bluetoothPrinters.forEach { item -> DropdownMenuItem(text = { Text("${item.name} · ${item.address}") }, onClick = {
                                printer = printer.copy(bluetoothName = item.name, bluetoothAddress = item.address); bluetoothExpanded = false
                            }) }
                        }
                    }
                    Text("A impressora deve estar pareada nas configurações do Android.", style = MaterialTheme.typography.bodySmall)
                } else {
                    ExposedDropdownMenuBox(expanded = usbExpanded, onExpandedChange = { expand ->
                        usbPrinters = PrinterTransport.connectedUsb(context)
                        usbExpanded = expand
                    }) {
                        OutlinedTextField(
                            printer.usbDeviceName.ifBlank { "Selecione uma impressora USB" }, {}, readOnly = true,
                            label = { Text("Impressora USB conectada") },
                            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(usbExpanded) },
                            modifier = Modifier.menuAnchor().fillMaxWidth(),
                        )
                        ExposedDropdownMenu(usbExpanded, { usbExpanded = false }) {
                            usbPrinters.forEach { item: UsbPrinter -> DropdownMenuItem(
                                text = { Text("${item.name} · ${item.vendorId}:${item.productId}") },
                                onClick = {
                                    printer = printer.copy(
                                        usbDeviceName = item.deviceName,
                                        usbVendorId = item.vendorId,
                                        usbProductId = item.productId,
                                    )
                                    usbExpanded = false
                                    runCatching { PrinterTransport.requestUsbPermission(context, printer) }
                                        .onFailure { message = "Erro: ${it.message}" }
                                },
                            ) }
                        }
                    }
                    OutlinedButton(onClick = {
                        usbPrinters = PrinterTransport.connectedUsb(context)
                        runCatching { PrinterTransport.requestUsbPermission(context, printer) }
                            .fold({ message = "Confirme a autorização USB do Android" }, { message = "Erro: ${it.message}" })
                    }, modifier = Modifier.fillMaxWidth()) { Text("Autorizar impressora USB") }
                    Text("Use um adaptador USB OTG. O Android solicitará autorização para acessar a impressora.", style = MaterialTheme.typography.bodySmall)
                }
                Text("⚙ Tamanho do papel", fontWeight = FontWeight.Bold)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(58, 76, 80).forEach { width ->
                        OutlinedButton(onClick = { printer = printer.copy(widthMm = width) }, modifier = Modifier.weight(1f)) { Text("$width mm") }
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(100, 102).forEach { width ->
                        OutlinedButton(onClick = { printer = printer.copy(widthMm = width) }, modifier = Modifier.weight(1f)) { Text("$width mm") }
                    }
                }
                OutlinedTextField(
                    value = printer.widthMm.toString(),
                    onValueChange = { value -> value.toIntOrNull()?.takeIf { it in 20..320 }?.let { printer = printer.copy(widthMm = it) } },
                    label = { Text("Largura personalizada (20 a 320 mm)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Text("Resolução da cabeça", fontWeight = FontWeight.Bold)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(203, 300, 600).forEach { dpi ->
                        if (printer.dpi == dpi) {
                            Button(onClick = { printer = printer.copy(dpi = dpi); dpiInput = dpi.toString() }, modifier = Modifier.weight(1f)) { Text("$dpi DPI") }
                        } else {
                            OutlinedButton(onClick = { printer = printer.copy(dpi = dpi); dpiInput = dpi.toString() }, modifier = Modifier.weight(1f)) { Text("$dpi DPI") }
                        }
                    }
                }
                OutlinedTextField(
                    value = dpiInput,
                    onValueChange = { value ->
                        if (value.length <= 4 && value.all(Char::isDigit)) {
                            dpiInput = value
                            value.toIntOrNull()?.takeIf { it in 100..1200 }?.let { printer = printer.copy(dpi = it) }
                        }
                    },
                    isError = dpiInput.toIntOrNull() !in 100..1200,
                    label = { Text("DPI personalizado (100 a 1200)") },
                    supportingText = {
                        Text(if (printer.protocol == PrinterProtocol.ESC_POS) "ESC/POS em modo texto não depende do DPI." else "O DPI altera largura, altura, margens e espaçamento em pontos.")
                    },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Text("O comprimento acompanha somente o conteúdo impresso.", style = MaterialTheme.typography.bodySmall)
                if (config.deviceToken.isNotBlank()) {
                    Text("Categorias do deploy", fontWeight = FontWeight.Bold)
                    Text("Os produtos destas categorias serão enviados para esta impressora.", style = MaterialTheme.typography.bodySmall)
                    OutlinedButton(onClick = { refreshCategories() }, modifier = Modifier.fillMaxWidth()) { Text("Atualizar categorias do deploy") }
                    if (deployCategories.isEmpty()) {
                        Text("Nenhuma categoria carregada.", style = MaterialTheme.typography.bodySmall)
                    } else {
                        Column(Modifier.fillMaxWidth()) {
                            deployCategories.forEach { category ->
                                Row(Modifier.fillMaxWidth().padding(start = if (category.parentId == null) 0.dp else 20.dp)) {
                                    Checkbox(
                                        checked = category.id in printer.categoryIds,
                                        onCheckedChange = { checked ->
                                            val ids = if (checked) printer.categoryIds + category.id else printer.categoryIds - category.id
                                            printer = printer.copy(categoryIds = ids.distinct())
                                        },
                                    )
                                    Text(if (category.parentId == null) category.name else "↳ ${category.name}", modifier = Modifier.padding(top = 12.dp))
                                }
                            }
                        }
                    }
                }
                Button(onClick = {
                    val customDpi = dpiInput.toIntOrNull()
                    if (customDpi == null || customDpi !in 100..1200) {
                        message = "Informe um DPI entre 100 e 1200"
                        return@Button
                    }
                    printer = printer.copy(dpi = customDpi)
                    if (printer.name.isBlank()) {
                        message = "Informe o nome da rota da impressora"
                        return@Button
                    }
                    val updated = printers.toMutableList()
                    val duplicate = updated.indices.firstOrNull { index ->
                        index != selectedPrinterIndex && updated[index].name.equals(printer.name, ignoreCase = true)
                    } ?: -1
                    if (duplicate >= 0) {
                        message = "Já existe uma rota com esse nome"
                        return@Button
                    }
                    if (selectedPrinterIndex in updated.indices) updated[selectedPrinterIndex] = printer
                    else { updated.add(printer); selectedPrinterIndex = updated.lastIndex }
                    printers = updated
                    config.printers = updated
                    if (config.defaultPrinterName.isBlank()) config.defaultPrinterName = printer.name
                    val bluetoothAllowed = Build.VERSION.SDK_INT < 31 ||
                        context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
                    if (printer.connection == ConnectionType.BLUETOOTH && !bluetoothAllowed) {
                        message = "Autorize Dispositivos próximos para imprimir por Bluetooth"
                        requestPermissions(openBluetoothPicker = true)
                    } else if (printer.connection == ConnectionType.USB && printer.usbDeviceName.isBlank()) {
                        message = "Selecione e autorize uma impressora USB"
                    } else {
                        background {
                            if (config.deviceToken.isNotBlank()) SimplesXApi(config).updatePrinterCategories(printer)
                            val test = "SIMPLESX - TESTE DE IMPRESSAO\n${printer.protocol.name} · ${printer.dpi} DPI\nRede/Bluetooth OK"
                            val bytes = PrinterCommands.document(test, printer)
                            PrinterTransport.send(context, printer, bytes)
                            "Dados ${printer.protocol.name} enviados. Confirme o texto no papel; a conexão Bluetooth não confirma se a impressora entendeu o protocolo."
                        }
                    }
                }, modifier = Modifier.fillMaxWidth()) { Text("Salvar rota e imprimir teste") }
                OutlinedButton(onClick = {
                    config.defaultPrinterName = printer.name
                    message = "${printer.name} definida como rota padrão"
                }, modifier = Modifier.fillMaxWidth()) {
                    Text(if (config.defaultPrinterName.equals(printer.name, ignoreCase = true)) "Rota padrão" else "Definir como padrão")
                }
            }

            Section("Serviço em segundo plano") {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Column { Text("Receber impressões"); Text("Mantém uma notificação ativa", style = MaterialTheme.typography.bodySmall) }
                    Switch(serviceEnabled, onCheckedChange = {
                        requestPermissions(); config.deployUrl = deployUrl; config.deviceName = deviceName; config.printers = printers
                        serviceEnabled = it
                        if (it) PrintSyncService.start(context) else PrintSyncService.stop(context)
                    })
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable private fun Section(title: String, content: @Composable () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(title, fontWeight = FontWeight.Bold); content()
        }
    }
}

@Composable private fun StatusCard(active: Boolean, paired: Boolean, status: String, lastJob: String) {
    Card(colors = CardDefaults.cardColors(containerColor = if (active) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant)) {
        Column(Modifier.fillMaxWidth().padding(16.dp)) {
            Text(if (active) "Serviço ativo" else "Serviço parado", fontWeight = FontWeight.Bold)
            Text(if (paired) status else "Aguardando pareamento")
            Text("Último trabalho: $lastJob", style = MaterialTheme.typography.bodySmall)
        }
    }
}
