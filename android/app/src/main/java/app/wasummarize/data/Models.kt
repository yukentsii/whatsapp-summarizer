package app.wasummarize.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class StatusDto(
    val connection: String,
    val me: String? = null,
    @SerialName("message_count") val messageCount: Long = 0,
    @SerialName("last_message_time") val lastMessageTime: String? = null,
)

@Serializable
data class PairingDto(
    val status: String,
    @SerialName("pairing_code") val pairingCode: String? = null,
)

@Serializable
data class PairingCodeRequest(val phone: String)

@Serializable
data class PairingCodeDto(@SerialName("pairing_code") val pairingCode: String)

@Serializable
data class RangeDto(val since: String, val until: String)

@Serializable
data class SummaryListItemDto(
    val id: Long,
    @SerialName("created_at") val createdAt: String,
    val range: RangeDto,
    val status: String,
    val provider: String,
    val model: String,
    @SerialName("chat_ids") val chatIds: List<String>? = null,
    @SerialName("must_not_miss_count") val mustNotMissCount: Int? = null,
    @SerialName("chat_count") val chatCount: Int? = null,
    val error: String? = null,
)

@Serializable
data class SummaryItemDto(
    val chat: String,
    val sender: String,
    @SerialName("message_id") val messageId: String,
    val reason: String,
)

@Serializable
data class PlanDto(
    val what: String,
    @SerialName("when") val time: String,
    val chat: String,
)

@Serializable
data class ChatBriefDto(
    val chat: String,
    val brief: String,
    @SerialName("message_count") val messageCount: Int,
)

/** Returned by POST /summaries and GET /summaries/:id (failed rows carry only `error`). */
@Serializable
data class SummaryDto(
    val id: Long,
    @SerialName("created_at") val createdAt: String,
    val range: RangeDto,
    val status: String = "ok",
    val error: String? = null,
    @SerialName("must_not_miss") val mustNotMiss: List<SummaryItemDto> = emptyList(),
    @SerialName("questions_to_me") val questionsToMe: List<SummaryItemDto> = emptyList(),
    @SerialName("mentions_of_me") val mentionsOfMe: List<SummaryItemDto> = emptyList(),
    @SerialName("dates_and_plans") val datesAndPlans: List<PlanDto> = emptyList(),
    @SerialName("per_chat") val perChat: List<ChatBriefDto> = emptyList(),
    val overall: String = "",
)

@Serializable
data class SummarizeRequest(val since: String? = null)

@Serializable
data class ErrorDto(val error: String)
