import java.net.URI

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val configuredServer = providers.gradleProperty("entregasServerUrl")
    .orElse(providers.environmentVariable("ENTREGAS_SERVER_URL")).getOrElse("").trim().trimEnd('/')
if (configuredServer.isNotEmpty()) {
    val server = URI(configuredServer)
    require(server.scheme == "https" && !server.host.isNullOrBlank() && server.userInfo == null &&
        server.path.isNullOrEmpty() && server.query == null && server.fragment == null) {
        "ENTREGAS_SERVER_URL deve ser uma origem HTTPS, sem caminho, credenciais ou parâmetros."
    }
}
val signingPath = providers.environmentVariable("ENTREGAS_KEYSTORE_PATH").orNull
val signingStorePassword = providers.environmentVariable("ENTREGAS_STORE_PASSWORD").orNull
val signingAlias = providers.environmentVariable("ENTREGAS_KEY_ALIAS").orNull
val signingKeyPassword = providers.environmentVariable("ENTREGAS_KEY_PASSWORD").orNull
val signingProvided = listOf(signingPath, signingStorePassword, signingAlias, signingKeyPassword)
require(signingProvided.all { it.isNullOrBlank() } || signingProvided.all { !it.isNullOrBlank() }) {
    "Informe todas as quatro variáveis ENTREGAS de assinatura ou nenhuma delas."
}

android {
    namespace = "com.doixp.entregas"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.doixp.entregas"
        minSdk = 26
        targetSdk = 36
        versionCode = providers.gradleProperty("entregasVersionCode").getOrElse("1").toInt()
        versionName = providers.gradleProperty("entregasVersionName").getOrElse("0.1.0")
        buildConfigField("String", "SERVER_URL", "\"$configuredServer\"")
    }
    buildFeatures { buildConfig = true }
    signingConfigs {
        if (!signingPath.isNullOrBlank()) create("release") {
            storeFile = file(signingPath)
            storePassword = signingStorePassword
            keyAlias = signingAlias
            keyPassword = signingKeyPassword
        }
    }
    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            resValue("string", "app_name", "DoixP Entregas Teste")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            signingConfig = signingConfigs.findByName("release")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            resValue("string", "app_name", "DoixP Entregas")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    lint { abortOnError = true; checkReleaseBuilds = true }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.webkit:webkit:1.12.1")
    testImplementation("junit:junit:4.13.2")
}

tasks.register("verifyPlayRelease") {
    group = "verification"
    description = "Confere endereço público e assinatura antes de preparar um envio ao Google Play."
    doLast {
        check(configuredServer.isNotBlank()) { "Defina ENTREGAS_SERVER_URL para a publicação no Google Play." }
        check(!signingPath.isNullOrBlank()) { "Defina a chave de upload nas variáveis ENTREGAS_* de assinatura." }
        check(file(signingPath).isFile) { "Arquivo da chave de upload não encontrado." }
    }
}
