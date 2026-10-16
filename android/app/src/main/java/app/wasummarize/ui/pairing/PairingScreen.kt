package app.wasummarize.ui.pairing

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.wasummarize.ui.components.AppCard
import app.wasummarize.ui.components.AppTopBar
import app.wasummarize.ui.components.Dot
import app.wasummarize.ui.components.ErrorBanner
import app.wasummarize.ui.components.LabeledField
import app.wasummarize.ui.components.PrimaryButton

@Composable
fun PairingScreen(onBack: () -> Unit, vm: PairingViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    LifecycleResumeEffect(Unit) {
        vm.startPolling()
        onPauseOrDispose { vm.stopPolling() }
    }
    val linked = state.status == "open"

    Column(Modifier.fillMaxSize()) {
        AppTopBar("Pair WhatsApp", onBack = onBack)
        Column(
            verticalArrangement = Arrangement.spacedBy(20.dp),
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .navigationBarsPadding()
                .padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 24.dp),
        ) {
            StatusPill(state.status, linked)
            state.statusError?.let { ErrorBanner("Server unreachable", it) }
            when {
                linked -> Text(
                    "WhatsApp is linked and messages are being stored. Nothing else to do here.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                state.status == "awaiting_pairing" -> PairingForm(state, vm)
                state.status == "logged_out" -> Text(
                    "The server was unlinked. Delete data/auth on the server and restart it, then come back here.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun StatusPill(status: String?, linked: Boolean) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .padding(horizontal = 12.dp, vertical = 6.dp),
    ) {
        Dot(if (linked) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            when (status) {
                null -> "Checking…"
                "open" -> "Linked"
                "awaiting_pairing" -> "Not linked"
                "logged_out" -> "Logged out"
                else -> "Connecting…"
            },
            style = MaterialTheme.typography.labelLarge,
        )
    }
}

@Composable
private fun PairingForm(state: PairingState, vm: PairingViewModel) {
    LabeledField(
        label = "Your WhatsApp number",
        value = state.phone,
        onValueChange = vm::setPhone,
        keyboardType = KeyboardType.Phone,
        placeholder = "+90 555 123 45 67",
    )
    PrimaryButton(
        label = "Get pairing code",
        loading = state.requesting,
        enabled = state.phone.count { it.isDigit() } >= 8,
        onClick = vm::requestCode,
    )
    state.codeError?.let { ErrorBanner("Could not get a code", it) }
    state.code?.let { code ->
        AppCard {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                Text("Your code", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(
                    code.chunked(4).joinToString("-"),
                    style = MaterialTheme.typography.titleLarge.copy(fontSize = 32.sp, lineHeight = 40.sp, letterSpacing = 4.sp),
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        listOf(
            "1. Open WhatsApp → Settings → Linked devices",
            "2. Tap Link a device",
            "3. Tap Link with phone number instead",
            "4. Enter the code above",
        ).forEach {
            Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
