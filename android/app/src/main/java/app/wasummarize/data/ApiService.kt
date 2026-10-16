package app.wasummarize.data

import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

interface ApiService {
    @GET("status")
    suspend fun status(): StatusDto

    @GET("pairing")
    suspend fun pairing(): PairingDto

    @POST("pairing/code")
    suspend fun pairingCode(@Body body: PairingCodeRequest): PairingCodeDto

    @GET("summaries")
    suspend fun summaries(): List<SummaryListItemDto>

    @GET("summaries/{id}")
    suspend fun summary(@Path("id") id: Long): SummaryDto

    @POST("summaries")
    suspend fun summarize(@Body body: SummarizeRequest = SummarizeRequest()): SummaryDto
}
