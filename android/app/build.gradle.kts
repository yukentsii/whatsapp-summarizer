import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
}

// Per-install settings live in the git-ignored local.properties, never in the repository.
val localProps = Properties().apply {
    rootProject.file("local.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) }
}

// The server's API_TOKEN, so it is never typed into the app.
val apiToken: String = localProps.getProperty("api.token")
    ?: error("Add api.token=<API_TOKEN from the server .env> to local.properties")

// Hosts the app may reach over plain HTTP (e.g. the server's Tailscale IP); everything else is HTTPS-only.
val cleartextHosts: List<String> = localProps.getProperty("cleartext.hosts").orEmpty()
    .split(',').map { it.trim() }.filter { it.isNotEmpty() }

/** Writes res/xml/network_security_config.xml from the cleartext.hosts list. */
abstract class NetworkSecurityConfigTask : DefaultTask() {
    @get:Input
    abstract val hosts: ListProperty<String>

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun write() {
        val domains = hosts.get().joinToString("\n") { host ->
            val isIp = host.all { it.isDigit() || it == '.' || it == ':' }
            "        <domain includeSubdomains=\"${!isIp}\">$host</domain>"
        }
        val domainConfig = if (domains.isEmpty()) "" else
            "    <domain-config cleartextTrafficPermitted=\"true\">\n$domains\n    </domain-config>\n"
        val file = outputDir.get().file("xml/network_security_config.xml").asFile
        file.parentFile.mkdirs()
        file.writeText(
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n" +
                "<!-- Generated from cleartext.hosts in local.properties. -->\n" +
                "<network-security-config>\n" +
                "    <base-config cleartextTrafficPermitted=\"false\" />\n" +
                domainConfig +
                "</network-security-config>\n",
        )
    }
}

val networkSecurityConfig = tasks.register<NetworkSecurityConfigTask>("generateNetworkSecurityConfig") {
    hosts.set(cleartextHosts)
}

android {
    namespace = "app.wasummarize"
    compileSdk = 37

    defaultConfig {
        applicationId = "app.wasummarize"
        minSdk = 26
        targetSdk = 37
        versionCode = 1
        versionName = "1.0"
        buildConfigField("String", "API_TOKEN", "\"$apiToken\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

androidComponents {
    onVariants { variant ->
        variant.sources.res?.addGeneratedSourceDirectory(networkSecurityConfig, NetworkSecurityConfigTask::outputDir)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.navigation.compose)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)

    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.hilt.navigation.compose)

    implementation(libs.retrofit)
    implementation(libs.retrofit.kotlinx.serialization)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.datastore.preferences)
}
