package app.wasummarize.data

import app.wasummarize.BuildConfig
import java.io.IOException
import java.net.SocketTimeoutException
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.HttpException
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

class ApiError(message: String) : Exception(message)

private class NotConfiguredException : Exception()

/** Talks to the server configured in Settings; every call returns a Result with a readable error. */
@Singleton
class Repository @Inject constructor(
    private val settings: SettingsRepository,
    private val client: OkHttpClient,
    private val json: Json,
) {
    @Volatile
    private var cached: Pair<String, ApiService>? = null

    private suspend fun api(): ApiService {
        val url = settings.current()
        if (url.isBlank()) throw NotConfiguredException()
        cached?.let { (key, api) -> if (key == url) return api }
        val http = client.newBuilder()
            .addInterceptor { chain ->
                chain.proceed(chain.request().newBuilder().header("Authorization", "Bearer ${BuildConfig.API_TOKEN}").build())
            }
            .build()
        val api = Retrofit.Builder()
            .baseUrl("$url/")
            .client(http)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(ApiService::class.java)
        cached = url to api
        return api
    }

    suspend fun <T> call(block: suspend ApiService.() -> T): Result<T> = withContext(Dispatchers.IO) {
        try {
            Result.success(api().block())
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Result.failure(toApiError(e))
        }
    }

    private fun toApiError(e: Exception): ApiError = when (e) {
        is NotConfiguredException -> ApiError("Enter the server address in Settings.")
        is HttpException -> {
            val serverMessage = e.response()?.errorBody()?.string()?.let { body ->
                runCatching { json.decodeFromString<ErrorDto>(body).error }.getOrNull()
            }
            ApiError(if (e.code() == 401) "The server rejected this app's token. Rebuild the app with the server's API_TOKEN." else serverMessage ?: "Server error ${e.code()}.")
        }
        is SocketTimeoutException -> ApiError("The server took too long to respond.")
        is IOException -> ApiError("Could not reach the server. Check the address in Settings and that Tailscale is on.")
        is IllegalArgumentException -> ApiError("The server address is not valid.")
        else -> ApiError(e.message ?: "Something went wrong.")
    }
}
