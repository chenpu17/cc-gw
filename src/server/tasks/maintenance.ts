import { cleanupLogsBefore } from '../logging/queries.js'
import { getConfig } from '../config/manager.js'

const DAY_MS = 24 * 60 * 60 * 1000

let timersStarted = false

export function startMaintenanceTimers(): void {
  if (timersStarted) return
  timersStarted = true
  scheduleCleanup()
}

function scheduleCleanup(): void {
  const run = () => {
    try {
      const retentionDays = getConfig().logRetentionDays ?? 30
      const cutoff = Date.now() - retentionDays * DAY_MS
      const deleted = cleanupLogsBefore(cutoff)
      if (deleted > 0) {
        console.info(`[maintenance] cleaned ${deleted} old log entries`)
      }
    } catch (err) {
      console.error('[maintenance] cleanup failed', err)
    }
  }
  setInterval(run, DAY_MS)
}
