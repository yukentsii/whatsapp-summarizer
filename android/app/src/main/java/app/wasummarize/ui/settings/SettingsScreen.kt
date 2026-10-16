package app.wasummarize.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.wasummarize.ui.components.AppTopBar
import app.wasummarize.ui.components.ErrorBanner
import app.wasummarize.ui.components.LabeledField
import app.wasummarize.ui.components.PrimaryButton
import app.wasummarize.ui.components.SectionHeader
import app.wasummarize.ui.components.SummaryRow

@Composable
fun SettingsScreen(onBack: () -> Unit, onOpenPairing: () -> Unit, vm: SettingsViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()

    Column(Modifier.fillMaxSize()) {
        AppTopBar("Settings", onBack = onBack)
        Column(
            verticalArrangement = Arrangement.spacedBy(20.dp),
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .navigationBarsPadding()
                .padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 24.dp),
        ) {
            LabeledField(
                label = "Server address",
                value = state.address,
                onValueChange = vm::setAddress,
                keyboardType = KeyboardType.Uri,
                placeholder = "100.x.y.z",
            )
            PrimaryButton(
                label = "Save",
                loading = state.saving,
                enabled = state.address.isNotBlank(),
                onClick = vm::save,
            )
            state.message?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.tertiary)
            }
            state.error?.let { ErrorBanner("Could not connect", it) }
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SectionHeader("WhatsApp")
                SummaryRow("Pair WhatsApp", "Link the server with a pairing code", onClick = onOpenPairing)
            }
        }
    }
}
