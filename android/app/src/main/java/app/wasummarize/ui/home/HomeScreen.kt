package app.wasummarize.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.wasummarize.data.StatusDto
import app.wasummarize.data.SummaryListItemDto
import app.wasummarize.ui.components.AppCard
import app.wasummarize.ui.components.AppTopBar
import app.wasummarize.ui.components.CenteredProgress
import app.wasummarize.ui.components.Dot
import app.wasummarize.ui.components.ErrorBanner
import app.wasummarize.ui.components.PrimaryButton
import app.wasummarize.ui.components.SectionHeader
import app.wasummarize.ui.components.SummaryRow
import app.wasummarize.ui.formatDateTime
import app.wasummarize.ui.formatRange
import app.wasummarize.ui.formatShort
import java.text.NumberFormat

@Composable
fun HomeScreen(
    onOpenSettings: () -> Unit,
    onOpenPairing: () -> Unit,
    onOpenSummary: (Long) -> Unit,
    vm: HomeViewModel = hiltViewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()

    LifecycleResumeEffect(Unit) {
        if (state.configured && !state.summarizing) vm.refresh()
        onPauseOrDispose { }
    }
    LaunchedEffect(state.openSummaryId) {
        state.openSummaryId?.let {
            vm.summaryOpened()
            onOpenSummary(it)
        }
    }

    Column(Modifier.fillMaxSize()) {
        AppTopBar("Summaries", onSettings = onOpenSettings)
        if (!state.configured) {
            NotConfigured(onOpenSettings)
            return@Column
        }
        LazyColumn(
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxSize().navigationBarsPadding(),
        ) {
            item { StatusCard(state.status, state.loadError, onOpenPairing) }
            item {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.padding(top = 12.dp),
                ) {
                    PrimaryButton(
                        label = if (state.summarizing) "Summarizing…" else "Summarize",
                        loading = state.summarizing,
                        onClick = vm::summarize,
                    )
                    Text(
                        if (state.summarizing) "This can take a few minutes" else coverageHint(state.summaries),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            state.summarizeError?.let { item { ErrorBanner("Summary failed", it) } }
            item {
                Column(Modifier.padding(top = 12.dp)) { SectionHeader("Past summaries") }
            }
            if (state.loading && state.summaries.isEmpty()) {
                item { CenteredProgress() }
            } else if (state.summaries.isEmpty()) {
                item {
                    Text(
                        "No summaries yet. Tap Summarize to create the first one.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            items(state.summaries, key = { it.id }) { s ->
                SummaryRow(
                    title = formatRange(s.range.since, s.range.until),
                    subtitle = subtitle(s),
                    onClick = { onOpenSummary(s.id) },
                )
            }
        }
    }
}

@Composable
private fun StatusCard(status: StatusDto?, error: String?, onOpenPairing: () -> Unit) {
    val connected = status?.connection == "open"
    AppCard(onClick = if (status != null && !connected) onOpenPairing else null) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Dot(
                when {
                    error != null && status == null -> MaterialTheme.colorScheme.error
                    connected -> MaterialTheme.colorScheme.tertiary
                    else -> MaterialTheme.colorScheme.onSurfaceVariant
                },
            )
            Text(
                when {
                    status == null && error != null -> "Server unreachable"
                    status == null -> "Connecting…"
                    else -> connectionLabel(status.connection)
                },
                style = MaterialTheme.typography.labelLarge,
            )
        }
        val details = when {
            status == null -> error
            !connected -> "Tap to link WhatsApp"
            else -> buildString {
                append(NumberFormat.getIntegerInstance().format(status.messageCount)).append(" messages")
                status.lastMessageTime?.let { append(" · last at ").append(formatShort(it)) }
            }
        }
        if (details != null) {
            Text(details, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun NotConfigured(onOpenSettings: () -> Unit) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        AppCard {
            Text("Connect to your server", style = MaterialTheme.typography.labelLarge)
            Text(
                "Enter your server's address to get started.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        PrimaryButton("Open settings", onClick = onOpenSettings)
    }
}

private fun connectionLabel(connection: String) = when (connection) {
    "open" -> "Connected"
    "awaiting_pairing" -> "Not linked"
    "logged_out" -> "Logged out"
    "closed" -> "Reconnecting…"
    else -> "Connecting…"
}

/** The default range starts where the last full summary ended. */
private fun coverageHint(summaries: List<SummaryListItemDto>): String {
    val last = summaries.firstOrNull { it.status == "ok" && it.chatIds == null }
    return if (last != null) "Covers messages since ${formatDateTime(last.range.until)}" else "Covers the last 24 hours"
}

private fun subtitle(s: SummaryListItemDto): String =
    if (s.status != "ok") "Failed · ${shortError(s.error)}"
    else listOfNotNull(
        "${s.mustNotMissCount ?: 0} must-not-miss",
        s.chatCount?.let { "$it ${if (it == 1) "chat" else "chats"}" },
    ).joinToString(" · ")

/** One line for the list; the full error is shown on the summary screen. */
private fun shortError(error: String?): String = when {
    error == null -> "unknown error"
    "429" in error || "quota" in error.lowercase() -> "AI provider quota exceeded"
    "503" in error || "high demand" in error -> "AI provider overloaded"
    else -> error.lineSequence().first().take(80)
}
