package app.wasummarize.ui.summary

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.wasummarize.data.Repository
import app.wasummarize.data.SummaryDto
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class SummaryState(val loading: Boolean = true, val summary: SummaryDto? = null, val error: String? = null)

@HiltViewModel
class SummaryViewModel @Inject constructor(private val repo: Repository) : ViewModel() {
    private val _state = MutableStateFlow(SummaryState())
    val state: StateFlow<SummaryState> = _state.asStateFlow()
    private var loadedId: Long? = null

    fun load(id: Long, force: Boolean = false) {
        if (loadedId == id && !force) return
        loadedId = id
        viewModelScope.launch {
            _state.value = SummaryState(loading = true)
            repo.call { summary(id) }
                .onSuccess { _state.value = SummaryState(loading = false, summary = it) }
                .onFailure { _state.value = SummaryState(loading = false, error = it.message) }
        }
    }
}
