// Drafts from Compose/content plans use local wall time; imported dates may include an offset.
// Preserve wall time without guessing a timezone, and show absolute dates in the viewer's timezone.
export function formatDraftDate(value: string, locale = 'en', timezone = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  if (!value) return ''
  const wallTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value)
  const date = new Date(wallTime ? value + 'Z' : value)
  if (!Number.isFinite(date.getTime())) return ''
  return new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    timeZone: wallTime ? 'UTC' : timezone,
    ...(wallTime ? {} : { timeZoneName: 'short' as const }),
  }).format(date)
}
