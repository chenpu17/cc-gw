export function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diffMs = now - timestamp

  const absDiff = Math.abs(diffMs)
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (absDiff < minute) {
    const seconds = Math.max(Math.round(absDiff / 1000), 1)
    return diffMs >= 0 ? `${seconds}s ago` : `in ${seconds}s`
  }
  if (absDiff < hour) {
    const minutes = Math.round(absDiff / minute)
    return diffMs >= 0 ? `${minutes}m ago` : `in ${minutes}m`
  }
  if (absDiff < day) {
    const hours = Math.round(absDiff / hour)
    return diffMs >= 0 ? `${hours}h ago` : `in ${hours}h`
  }
  const days = Math.round(absDiff / day)
  return diffMs >= 0 ? `${days}d ago` : `in ${days}d`
}

export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleString()
}
