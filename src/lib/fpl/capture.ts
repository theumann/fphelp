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
 * The half of the decision that is the same for every league.
 *
 * A union rather than a struct with a nullable field, so `ready` proves `gameweek` is a
 * number and callers cannot reach for a cast — the whole point of this type is that the
 * run loop can trust it before making per-league calls.
 */
export type GameweekGate =
  | { ready: true; gameweek: number; reason: 'ready' }
  | { ready: false; gameweek: number | null; reason: CaptureReason }

/**
 * Is there a settled gameweek at all? Asked once per run, before any league is touched.
 *
 * This split is what keeps the cron's cost flat as leagues are added. `bootstrap-static`
 * and `event-status` are **global** — they say nothing about a particular league — so a
 * run that finds no settled gameweek can stop after two FPL calls whether it serves one
 * league or fifty. Only when this opens does the run pay per-league costs: a standings
 * call plus one history call per manager, which is where the ~20-calls-a-league figure
 * comes from.
 *
 * That matters more than ordinary efficiency here. The API is behind Cloudflare, which
 * blocks on reputation and did block this deployment on 2026-09-01; roughly 95 of every
 * 96 weekly runs skip, so this gate is most of what keeps the request rate low enough not
 * to invite it. ARCHITECTURE.md "Egress and Cloudflare" has the incident.
 *
 * The cost of the split, stated plainly: **rosters are no longer refreshed on a skipped
 * poll.** `upsertManagers` used to run every hour off the standings call this now avoids,
 * so a manager who joins mid-week is recorded in `managers` when the next gameweek
 * settles rather than within the hour. Nothing user-facing reads that table — pages build
 * the roster live from standings — and its job is to record who was in the league at
 * capture time, which is exactly when it is now written.
 */
export function gameweekGate(bootstrap: BootstrapStatic, status: EventStatus): GameweekGate {
  const gameweek = lastFinishedGameweek(bootstrap)

  if (gameweek === null) {
    // See the note in `captureDecision`: null covers pre-season and a live gameweek, and
    // the reason has to tell them apart even though the verdict is the same.
    const live = liveGameweek(bootstrap)
    if (live !== null) return { ready: false, gameweek: live, reason: 'not-finished' }
    return { ready: false, gameweek: null, reason: 'pre-season' }
  }

  const readiness = isGameweekReady(bootstrap, status, gameweek)
  if (!readiness.ready) return { ready: false, gameweek, reason: readiness.reason }

  return { ready: true, gameweek, reason: 'ready' }
}

/** One league's outcome in a run, as far as the monitor is concerned. */
export type LeagueOutcome = 'captured' | 'skipped' | 'deferred' | 'error'

/**
 * Is the run as a whole healthy?
 *
 * **Any league failing makes the run an error**, even when the others succeeded. A league
 * that cannot be captured is losing `entry/{id}/history` that cannot be recovered once a
 * manager leaves, which is the silent, permanent loss this monitor exists for — and it
 * would be invisible if one league out of ten could fail while the check-in stayed green.
 *
 * `deferred` is not a failure. A league the run ran out of budget for is picked up by the
 * next poll, because a partial capture leaves fewer stored entries than the roster and
 * `captureDecision` sees the gameweek as outstanding again.
 */
export function runVerdict(outcomes: LeagueOutcome[]): 'ok' | 'error' {
  return outcomes.includes('error') ? 'error' : 'ok'
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

  /**
   * The global half, which is also asked once per run by the multi-league cron.
   *
   * `lastFinishedGameweek() === null` covers two opposite states, and the skip is right
   * for both — but the *reason* is logged, and for three days of GW1 2026/27 it said
   * `pre-season` while a gameweek was live with all 17 managers scored. Nothing captured
   * wrongly; the log simply lied about why, which is the first field anyone would read if
   * capture ever failed to fire when it should. `sendGate` splits the same pair the same
   * way — see `liveGameweek`.
   */
  const gate = gameweekGate(bootstrap, status)
  if (!gate.ready) return { capture: false, gameweek: gate.gameweek, reason: gate.reason }

  const { gameweek } = gate

  if (force) return { capture: true, gameweek, reason: 'ready' }

  // `>=` not `===`: a manager who left the league shrinks the roster without removing
  // their stored rows, and that must not stall the poll into re-capturing forever.
  if (rosterSize > 0 && capturedEntries(gameweek) >= rosterSize) {
    return { capture: false, gameweek, reason: 'already-captured' }
  }

  return { capture: true, gameweek, reason: 'ready' }
}
