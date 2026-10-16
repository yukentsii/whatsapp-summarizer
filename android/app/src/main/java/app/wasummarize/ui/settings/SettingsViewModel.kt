package app.wasummarize.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.wasummarize.data.Repository
import app.wasummarize.data.SettingsRepository
import app.wasummarize.data.displayServerAddress
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SettingsState(
    val address: String = "",
    val saving: Boolean = false,
    val message: String? = null,
    val error: String? = null,
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val settings: SettingsRepository,
    private val repo: Repository,
) : ViewModel() {
    private val _state = MutableStateFlow(SettingsState())
    val state: StateFlow<SettingsState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            val url = settings.current()
            _state.update { it.copy(address = displayServerAddress(url)) }
        }
    }

    fun setAddress(v: String) = _state.update { it.copy(address = v, message = null, error = null) }

    /** Saves, then checks the connection so a wrong address shows up right away. */
    fun save() {
        val address = _state.value.address
        viewModelScope.launch {
            _state.update { it.copy(saving = true, message = null, error = null) }
            settings.save(address)
            repo.call { status() }
                .onSuccess { _state.update { it.copy(saving = false, message = "Saved. Connected to the server.") } }
                .onFailure { e -> _state.update { it.copy(saving = false, error = e.message) } }
        }
    }
}
