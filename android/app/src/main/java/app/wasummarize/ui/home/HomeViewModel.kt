package app.wasummarize.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.wasummarize.data.Repository
import app.wasummarize.data.SettingsRepository
import app.wasummarize.data.StatusDto
import app.wasummarize.data.SummaryListItemDto
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class HomeState(
    val configured: Boolean = true,
    val loading: Boolean = true,
    val status: StatusDto? = null,
    val summaries: List<SummaryListItemDto> = emptyList(),
    val loadError: String? = null,
    val summarizing: Boolean = false,
    val summarizeError: String? = null,
    /** Set after a successful summary so the screen can open it once. */
    val openSummaryId: Long? = null,
)

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val repo: Repository,
    settings: SettingsRepository,
) : ViewModel() {
    private val _state = MutableStateFlow(HomeState())
    val state: StateFlow<HomeState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            settings.serverUrl.map { it.isNotBlank() }.distinctUntilChanged().collect { complete ->
                _state.update { it.copy(configured = complete) }
                if (complete) refresh() else _state.update { it.copy(loading = false) }
            }
        }
    }

    fun refresh() {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, loadError = null) }
            val status = async { repo.call { status() } }
            val summaries = async { repo.call { summaries() } }
            val s = status.await()
            val l = summaries.await()
            _state.update {
                it.copy(
                    loading = false,
                    status = s.getOrNull() ?: it.status,
                    summaries = l.getOrNull() ?: it.summaries,
                    loadError = (s.exceptionOrNull() ?: l.exceptionOrNull())?.message,
                )
            }
        }
    }

    fun summarize() {
        if (_state.value.summarizing) return
        viewModelScope.launch {
            _state.update { it.copy(summarizing = true, summarizeError = null) }
            repo.call { summarize() }
                .onSuccess { summary -> _state.update { it.copy(summarizing = false, openSummaryId = summary.id) } }
                .onFailure { e -> _state.update { it.copy(summarizing = false, summarizeError = e.message) } }
            refresh()
        }
    }

    fun summaryOpened() = _state.update { it.copy(openSummaryId = null) }
}
