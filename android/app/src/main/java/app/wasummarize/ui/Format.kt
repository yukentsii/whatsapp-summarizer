package app.wasummarize.ui

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

private val dayFormat = DateTimeFormatter.ofPattern("d MMM", Locale.getDefault())
private val timeFormat = DateTimeFormatter.ofPattern("HH:mm", Locale.getDefault())

private fun local(iso: String): ZonedDateTime = Instant.parse(iso).atZone(ZoneId.systemDefault())

/** "16 Oct · 14:29 – 14:33", or "15 Oct · 09:10 – 16 Oct · 14:29" across days. */
fun formatRange(since: String, until: String): String {
    val a = local(since)
    val b = local(until)
    val start = "${a.format(dayFormat)} · ${a.format(timeFormat)}"
    return if (a.toLocalDate() == b.toLocalDate()) "$start – ${b.format(timeFormat)}"
    else "$start – ${b.format(dayFormat)} · ${b.format(timeFormat)}"
}

/** "16 Oct, 14:29" */
fun formatDateTime(iso: String): String = local(iso).let { "${it.format(dayFormat)}, ${it.format(timeFormat)}" }

/** "14:29" today, otherwise "16 Oct, 14:29". */
fun formatShort(iso: String): String {
    val t = local(iso)
    return if (t.toLocalDate() == LocalDate.now()) t.format(timeFormat) else formatDateTime(iso)
}
