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

/**
 * The gameweek currently being played, or `null` between them.
 *
 * Exists to tell two states apart that `lastFinishedGameweek() === null` collapses into
 * one: nothing has been played yet, and something is being played right now. Before the
 * first gameweek of a season those look identical from `finished` alone, and they are
 * opposites — pre-season nobody has a score, mid-gameweek everybody has a provisional one
 * that will change before the day is out.
 *
 * Observed live on 2026-08-21: forty minutes after the GW1 deadline, `is_current` was true
 * on GW1 with `finished` still false, and the league's managers already carried points.
 */
export function liveGameweek(bootstrap: BootstrapStatic): number | null {
  const current = bootstrap.events.find((e) => e.is_current)
  return current && !current.finished ? current.id : null
}

export interface SendGate {
  gameweek: number
  /**
   * Whether the generated blocks may be included — the standings table, the gameweek
   * results, the prize figures.
   *
   * Not whether the owner may compose. Writing to the group mid-week is a normal thing to
   * do and nothing about it is unsafe; what cannot be undone is attaching a table of
   * provisional scores to it, so that is the narrow thing this withholds.
   */
  statsReady: boolean
  /** `'ready'` when they may. Otherwise what FPL is still doing. */
  reason: ReadinessReason
}

/**
 * Whether the composer may be opened, and for which gameweek.
 *
 * A pure function rather than a branch inside the page, because it is the single decision
 * standing between an owner and an irreversible message to their league, and a page is the
 * one place in this codebase that cannot be tested. Everything it needs is in two payloads.
 *
 * Three states, and the middle one is the one that was missing:
 *
 *   - **something has finished** — gate on `isGameweekReady`, which is the real check:
 *     `finished` flips before bonus points apply, so a finished gameweek can still be
 *     carrying provisional scores;
 *   - **nothing has finished but something is being played** — block. Everyone has a score
 *     and every one of them will change before the day is out;
 *   - **nothing has finished and nothing is being played** — pre-season. Nobody has scored,
 *     so there are no stale numbers to render and the roster shows score-less, which is a
 *     documented state.
 */
export function sendGate(bootstrap: BootstrapStatic, status: EventStatus): SendGate {
  const finished = lastFinishedGameweek(bootstrap)

  if (finished !== null) {
    const readiness = isGameweekReady(bootstrap, status, finished)
    return { gameweek: finished, statsReady: readiness.ready, reason: readiness.reason }
  }

  const live = liveGameweek(bootstrap)
  if (live !== null) return { gameweek: live, statsReady: false, reason: 'not-finished' }

  /**
   * Pre-season. The blocks are allowed: nobody has scored, so the table renders every
   * manager as score-less rather than as a wrong number, which is a documented state and
   * the one the whole league is in before GW1.
   */
  return { gameweek: 1, statsReady: true, reason: 'ready' }
}

/** Total gameweeks in the season. Never hardcode 38 — a shortened season would over-commit the pot. */
export function gameweekCount(bootstrap: BootstrapStatic): number {
  return bootstrap.events.length
}
