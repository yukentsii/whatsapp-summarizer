package app.wasummarize.ui.summary

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryScrollableTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.wasummarize.data.SummaryDto
import app.wasummarize.data.SummaryItemDto
import app.wasummarize.ui.components.AppTopBar
import app.wasummarize.ui.components.CenteredProgress
import app.wasummarize.ui.components.ErrorBanner
import app.wasummarize.ui.components.ItemCard
import app.wasummarize.ui.components.PrimaryButton
import app.wasummarize.ui.formatDateTime
import kotlinx.coroutines.launch

@Composable
fun SummaryScreen(id: Long, onBack: () -> Unit, vm: SummaryViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    LaunchedEffect(id) { vm.load(id) }

    Column(Modifier.fillMaxSize()) {
        AppTopBar("Summary", onBack = onBack)
        when {
            state.loading -> CenteredProgress()
            state.error != null -> Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                ErrorBanner("Could not load summary", state.error!!)
                PrimaryButton("Retry", onClick = { vm.load(id, force = true) })
            }
            state.summary != null -> SummaryContent(state.summary!!)
        }
    }
}

/** One swipeable page per section, in the order the spec lists them. */
private class Section(val title: String, val count: Int?, val cards: List<Pair<String, String>>, val text: String? = null)

private fun sections(s: SummaryDto): List<Section> {
    fun items(list: List<SummaryItemDto>) = list.map { meta(it) to it.reason }
    return listOf(
        Section("Must not miss", s.mustNotMiss.size, items(s.mustNotMiss)),
        Section("Questions to me", s.questionsToMe.size, items(s.questionsToMe)),
        Section("Mentions", s.mentionsOfMe.size, items(s.mentionsOfMe)),
        Section("Dates & plans", s.datesAndPlans.size, s.datesAndPlans.map { "${it.time} · ${it.chat}" to it.what }),
        Section("Per chat", s.perChat.size, s.perChat.map { "${it.chat} · ${it.messageCount} messages" to it.brief }),
        Section("Overall", null, emptyList(), text = s.overall),
    )
}

@Composable
private fun SummaryContent(s: SummaryDto) {
    Text(
        "${formatDateTime(s.range.since)} – ${formatDateTime(s.range.until)}",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 4.dp),
    )
    if (s.status != "ok") {
        Column(Modifier.padding(16.dp)) { ErrorBanner("Summary failed", s.error ?: "Unknown error") }
        return
    }

    val pages = sections(s)
    val pager = rememberPagerState { pages.size }
    val scope = rememberCoroutineScope()

    PrimaryScrollableTabRow(
        selectedTabIndex = pager.currentPage,
        edgePadding = 16.dp,
        containerColor = MaterialTheme.colorScheme.background,
        contentColor = MaterialTheme.colorScheme.onBackground,
        divider = { HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant) },
    ) {
        pages.forEachIndexed { i, page ->
            Tab(
                selected = pager.currentPage == i,
                onClick = { scope.launch { pager.animateScrollToPage(i) } },
                selectedContentColor = MaterialTheme.colorScheme.onBackground,
                unselectedContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                text = { TabLabel(page.title, page.count) },
            )
        }
    }

    HorizontalPager(state = pager, modifier = Modifier.fillMaxSize()) { index ->
        val page = pages[index]
        LazyColumn(
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxSize().navigationBarsPadding(),
        ) {
            if (page.text != null) {
                item { Text(page.text, style = MaterialTheme.typography.bodyMedium) }
            } else if (page.cards.isEmpty()) {
                item {
                    Text("Nothing here", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            } else {
                items(page.cards) { (meta, body) -> ItemCard(meta = meta, body = body) }
            }
        }
    }
}

@Composable
private fun TabLabel(title: String, count: Int?) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, style = MaterialTheme.typography.labelLarge)
        if (count != null) {
            Text(
                count.toString(),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.surfaceVariant)
                    .padding(horizontal = 6.dp, vertical = 1.dp),
            )
        }
    }
}

/** "Chat · Sender", or just the chat in one-to-one chats and when the sender is unknown. */
private fun meta(item: SummaryItemDto): String =
    if (item.sender == item.chat || item.sender == "?") item.chat else "${item.chat} · ${item.sender}"
