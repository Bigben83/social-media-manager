// Resolve local wall time with offsets on either side of a DST change.
// Gaps are rejected; during a repeated hour the earlier instant is selected.
function naiveDatetimeToUtc(localStr, timezone) {
  if (!localStr) return localStr
  const match = localStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
  if (!match) throw new Error('Enter a valid date and time')
  const [year, month, day, hour, minute] = match.slice(1).map(Number)
  const desired = Date.UTC(year, month - 1, day, hour, minute)
  if (new Date(desired).toISOString().slice(0, 16) !== localStr) throw new Error('Enter a valid date and time')
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const wallTime = (epoch) => {
    const parts = {}
    for (const { type, value } of formatter.formatToParts(new Date(epoch))) if (type !== 'literal') parts[type] = Number(value)
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute)
  }
  const offsets = new Set()
  for (let delta = -36; delta <= 36; delta += 6) { const epoch = desired + delta * 3600000; offsets.add(wallTime(epoch) - epoch) }
  const candidates = [...offsets].map(offset => desired - offset).filter(epoch => wallTime(epoch) === desired).sort((a, b) => a - b)
  if (!candidates.length) throw new Error('This local time does not exist because the clocks move forward; choose another time')
  return new Date(candidates[0]).toISOString()
}

module.exports = { naiveDatetimeToUtc };
