package app.wasummarize.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private const val DEFAULT_PORT = 3000

/**
 * Turns what the user typed into a base URL: "100.64.0.1" → "http://100.64.0.1:3000".
 * A full URL (with scheme, and optionally a port) is kept as typed.
 */
fun normalizeServerAddress(input: String): String {
    val raw = input.trim().trimEnd('/')
    if (raw.isEmpty()) return ""
    if ("://" in raw) return raw
    val hostPart = raw.substringBefore('/')
    return if (':' in hostPart) "http://$raw" else "http://$hostPart:$DEFAULT_PORT" + raw.removePrefix(hostPart)
}

/** Shows a stored URL the way the user typed it ("http://1.2.3.4:3000" → "1.2.3.4"). */
fun displayServerAddress(url: String): String =
    url.removePrefix("http://").removeSuffix(":$DEFAULT_PORT")

@Singleton
class SettingsRepository @Inject constructor(private val dataStore: DataStore<Preferences>) {
    /** Base URL of the server, or "" if not set yet. */
    val serverUrl: Flow<String> = dataStore.data.map { it[URL].orEmpty() }

    suspend fun current(): String = serverUrl.first()

    suspend fun save(address: String) {
        dataStore.edit { it[URL] = normalizeServerAddress(address) }
    }

    private companion object {
        val URL = stringPreferencesKey("server_url")
    }
}
