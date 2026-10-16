package app.wasummarize.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import app.wasummarize.ui.home.HomeScreen
import app.wasummarize.ui.pairing.PairingScreen
import app.wasummarize.ui.settings.SettingsScreen
import app.wasummarize.ui.summary.SummaryScreen
import kotlinx.serialization.Serializable

@Serializable object HomeRoute
@Serializable object SettingsRoute
@Serializable object PairingRoute
@Serializable data class SummaryRoute(val id: Long)

@Composable
fun AppNavigation() {
    val nav = rememberNavController()
    // Surface sets the content color (onBackground), so text and icons follow light/dark mode.
    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
        NavHost(navController = nav, startDestination = HomeRoute) {
            composable<HomeRoute> {
                HomeScreen(
                    onOpenSettings = { nav.navigate(SettingsRoute) },
                    onOpenPairing = { nav.navigate(PairingRoute) },
                    onOpenSummary = { id -> nav.navigate(SummaryRoute(id)) },
                )
            }
            composable<SettingsRoute> {
                SettingsScreen(onBack = { nav.popBackStack() }, onOpenPairing = { nav.navigate(PairingRoute) })
            }
            composable<PairingRoute> { PairingScreen(onBack = { nav.popBackStack() }) }
            composable<SummaryRoute> { entry ->
                SummaryScreen(id = entry.toRoute<SummaryRoute>().id, onBack = { nav.popBackStack() })
            }
        }
    }
}
