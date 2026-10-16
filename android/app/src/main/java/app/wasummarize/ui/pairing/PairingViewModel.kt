package app.wasummarize.ui.pairing

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.wasummarize.data.PairingCodeRequest
import app.wasummarize.data.Repository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

data class PairingState(
    val status: String? = null,
    val statusError: String? = null,
    val phone: String = "",
    val requesting: Boolean = false,
    val code: String? = null,
    val codeError: String? = null,
)

@HiltViewModel
class PairingViewModel @Inject constructor(private val repo: Repository) : ViewModel() {
    private val _state = MutableStateFlow(PairingState())
    val state: StateFlow<PairingState> = _state.asStateFlow()
    private var polling: Job? = null

    /** Polls the connection status every 3 seconds while the screen is visible. */
    fun startPolling() {
        if (polling?.isActive == true) return
        polling = viewModelScope.launch {
            while (isActive) {
                repo.call { pairing() }
                    .onSuccess { p -> _state.update { it.copy(status = p.status, statusError = null, code = it.code ?: p.pairingCode) } }
                    .onFailure { e -> _state.update { it.copy(statusError = e.message) } }
                delay(3_000)
            }
        }
    }

    fun stopPolling() {
        polling?.cancel()
    }

    fun setPhone(value: String) = _state.update { it.copy(phone = value, codeError = null) }

    fun requestCode() {
        val phone = _state.value.phone
        viewModelScope.launch {
            _state.update { it.copy(requesting = true, codeError = null) }
            repo.call { pairingCode(PairingCodeRequest(phone)) }
                .onSuccess { r -> _state.update { it.copy(requesting = false, code = r.pairingCode) } }
                .onFailure { e -> _state.update { it.copy(requesting = false, codeError = e.message) } }
        }
    }
}
