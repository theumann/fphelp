import {
  isGameweekReady,
  lastFinishedGameweek,
  liveGameweek,
  type ReadinessReason,
} from './gameweek'
import type { BootstrapStatic, EventStatus } from './types'

export type CaptureReason = ReadinessReason | 'pre-season' | 'already-captured'

export interface CaptureDecision {
  /** Whether to make the per-manager history calls at all. */
  capture: boolean
  /** The gameweek being captured, or null when there is nothing to capture. */
  gameweek: number | null
  reason: CaptureReason
}

export interface CaptureInput {
  bootstrap: BootstrapStatic
  status: EventStatus
  /** Managers in the league — the roster size a complete capture must reach. */
  rosterSize: number
  /** How many distinct managers already have a stored row for the candidate gameweek. */
  capturedEntries: (gameweek: number) => number
  /** Re-capture even when the gameweek looks complete. For backfills and manual runs. */
  force?: boolean
}

/**
 * Should this poll do the expensive work?
 *
 * The cron runs every 30-60 minutes all season, but there is only ever one gameweek
 * worth capturing and it becomes capturable once a week. So the default answer is no,
 * and this decides that from two cheap calls (`bootstrap-static`, `event-status`)
 * rather than one call per manager.
 *
 * Deliberately the *same* `isGameweekReady` the composer enforces on render, not a
 * looser variant: `finished` flips before bonus points apply, and history captured in
 * that window stores pre-bonus scores that look entirely plausible. The gate belongs
 * in both places.
 *
 * A partial capture — a manager or two lost to a flaky API — leaves fewer stored
 * entries than the roster, so the next poll picks the gameweek up again. That is why
 * this counts entries rather than asking whether the gameweek has "been captured".
 */
export function captureDecision(input: CaptureInput): CaptureDecision {
  const { bootstrap, status, rosterSize, capturedEntries, force = false } = input

  const gameweek = lastFinishedGameweek(bootstrap)
  if (gameweek === null) {
    /**
     * `lastFinishedGameweek() === null` covers two opposite states, and the skip is right
     * for both — but the *reason* is logged, and for three days of GW1 2026/27 it said
     * `pre-season` while a gameweek was live with all 17 managers scored. Nothing captured
     * wrongly; the log simply lied about why, which is the first field anyone would read if
     * capture ever failed to fire when it should. `sendGate` splits the same pair the same
     * way — see `liveGameweek`.
     */
    const live = liveGameweek(bootstrap)
    if (live !== null) return { capture: false, gameweek: live, reason: 'not-finished' }

    // Genuinely pre-season: nobody has scored, so there is no history to miss.
    return { capture: false, gameweek: null, reason: 'pre-season' }
  }

  const readiness = isGameweekReady(bootstrap, status, gameweek)
  if (!readiness.ready) return { capture: false, gameweek, reason: readiness.reason }

  if (force) return { capture: true, gameweek, reason: 'ready' }

  // `>=` not `===`: a manager who left the league shrinks the roster without removing
  // their stored rows, and that must not stall the poll into re-capturing forever.
  if (rosterSize > 0 && capturedEntries(gameweek) >= rosterSize) {
    return { capture: false, gameweek, reason: 'already-captured' }
  }

  return { capture: true, gameweek, reason: 'ready' }
}
