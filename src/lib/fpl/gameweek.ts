import type { BootstrapStatic, EventStatus } from './types'

export type ReadinessReason =
  | 'ready'
  | 'no-event-status'
  | 'bonus-pending'
  | 'leagues-not-updated'
  | 'data-not-checked'
  | 'not-finished'

export interface Readiness {
  ready: boolean
  reason: ReadinessReason
}

/** ⚠️ Unconfirmed: the live value of `event-status.leagues` when a GW completes. */
const LEAGUES_UPDATED = 'Updated'

/**
 * Is this gameweek safe to build a digest from?
 *
 * `events[].finished` flips BEFORE bonus points are applied, and league tables are
 * recalculated on a separate schedule, so `finished` alone can produce a digest with
 * stale standings.
 *
 * The `status.length > 0` guard is load-bearing, not defensive padding: outside a live
 * gameweek the API returns `{"status":[],"leagues":""}` (confirmed live pre-season),
 * and `[].every(...)` is vacuously true — so without it the gate opens on nothing.
 */
export function isGameweekReady(
  bootstrap: BootstrapStatic,
  status: EventStatus,
  gameweek: number,
): Readiness {
  const event = bootstrap.events.find((e) => e.id === gameweek)

  if (!event?.finished) return { ready: false, reason: 'not-finished' }
  if (status.status.length === 0) return { ready: false, reason: 'no-event-status' }
  if (!status.status.every((d) => d.bonus_added)) return { ready: false, reason: 'bonus-pending' }
  if (status.leagues !== LEAGUES_UPDATED) return { ready: false, reason: 'leagues-not-updated' }
  if (!event.data_checked) return { ready: false, reason: 'data-not-checked' }

  return { ready: true, reason: 'ready' }
}

/** The most recently finished gameweek, or null pre-season. */
export function lastFinishedGameweek(bootstrap: BootstrapStatic): number | null {
  const finished = bootstrap.events.filter((e) => e.finished)
  return finished.length > 0 ? Math.max(...finished.map((e) => e.id)) : null
}

/** Total gameweeks in the season. Never hardcode 38 — a shortened season would over-commit the pot. */
export function gameweekCount(bootstrap: BootstrapStatic): number {
  return bootstrap.events.length
}
