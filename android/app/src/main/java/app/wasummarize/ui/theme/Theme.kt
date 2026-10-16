package app.wasummarize.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

// Colors mirror the "Tokens" variables in the Figma file; dark values are the same roles inverted.
private val Light = lightColorScheme(
    primary = Color(0xFF18181B),
    onPrimary = Color(0xFFFFFFFF),
    background = Color(0xFFFAFAF9),
    onBackground = Color(0xFF18181B),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF18181B),
    surfaceVariant = Color(0xFFF2F2F0),
    onSurfaceVariant = Color(0xFF71717A),
    outline = Color(0xFFD4D4D1),
    outlineVariant = Color(0xFFE6E6E3),
    tertiary = Color(0xFF1F6F5C),
    error = Color(0xFFB3261E),
    errorContainer = Color(0xFFFBEAE8),
    onErrorContainer = Color(0xFFB3261E),
)

private val Dark = darkColorScheme(
    primary = Color(0xFFF4F4F5),
    onPrimary = Color(0xFF18181B),
    background = Color(0xFF111112),
    onBackground = Color(0xFFF4F4F5),
    surface = Color(0xFF1A1A1C),
    onSurface = Color(0xFFF4F4F5),
    surfaceVariant = Color(0xFF26262A),
    onSurfaceVariant = Color(0xFFA1A1AA),
    outline = Color(0xFF3F3F46),
    outlineVariant = Color(0xFF2E2E33),
    tertiary = Color(0xFF5FBF9F),
    error = Color(0xFFF2B8B5),
    errorContainer = Color(0xFF3B1513),
    onErrorContainer = Color(0xFFF2B8B5),
)

// Text styles mirror Figma: Title, Heading, Body, Label, Caption (Roboto is the platform default).
private val AppTypography = Typography(
    titleLarge = TextStyle(fontSize = 22.sp, lineHeight = 28.sp, fontWeight = FontWeight.Medium),
    titleMedium = TextStyle(fontSize = 16.sp, lineHeight = 24.sp, fontWeight = FontWeight.Medium),
    bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Normal),
    labelLarge = TextStyle(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium),
    bodySmall = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Normal),
)

@Composable
fun AppTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) Dark else Light,
        typography = AppTypography,
        content = content,
    )
}
