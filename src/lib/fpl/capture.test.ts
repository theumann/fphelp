import { describe, expect, it } from 'vitest'

import { captureDecision, gameweekGate, runVerdict } from './capture'
import type { BootstrapStatic, EventStatus, FplEvent } from './types'

function event(over: Partial<FplEvent> & { id: number }): FplEvent {
  return {
    name: `Gameweek ${over.id}`,
    deadline_time: '2026-08-21T17:30:00Z',
    finished: false,
    data_checked: false,
    average_entry_score: 0,
    is_current: false,
    is_next: false,
    is_previous: false,
    highest_scoring_entry: null,
    ranked_count: 0,
    ...over,
  }
}

const settled = (id: number) => event({ id, finished: true, data_checked: true })

const readyStatus: EventStatus = {
  status: [{ bonus_added: true, date: '2026-08-22', event: 1, points: 'r' }],
  leagues: 'Updated',
}

function decide(over: {
  bootstrap?: BootstrapStatic
  status?: EventStatus
  rosterSize?: number
  captured?: number
  force?: boolean
}) {
  return captureDecision({
    bootstrap: over.bootstrap ?? { events: [settled(1)] },
    status: over.status ?? readyStatus,
    rosterSize: over.rosterSize ?? 18,
    capturedEntries: () => over.captured ?? 0,
    force: over.force,
  })
}

describe('captureDecision', () => {
  it('captures the last finished gameweek once it has settled', () => {
    expect(decide({})).toEqual({ capture: true, gameweek: 1, reason: 'ready' })
  })

  it('skips pre-season, when no gameweek has finished', () => {
    const decision = decide({ bootstrap: { events: [event({ id: 1 })] } })
    expect(decision).toEqual({ capture: false, gameweek: null, reason: 'pre-season' })
  })

  /**
   * Both states skip, so this is about the logged reason rather than the decision. It read
   * `pre-season` for three days of a live, fully-scored GW1 in 2026/27.
   */
  it('names a live gameweek rather than calling it pre-season', () => {
    const bootstrap = { events: [event({ id: 1, is_current: true })] }
    expect(decide({ bootstrap })).toEqual({ capture: false, gameweek: 1, reason: 'not-finished' })
  })

  /** The trap this whole gate exists for: `finished` flips before bonus points apply. */
  it('skips a finished gameweek whose bonus points are still pending', () => {
    const status: EventStatus = {
      ...readyStatus,
      status: [{ bonus_added: false, date: '2026-08-22', event: 1, points: 'l' }],
    }
    expect(decide({ status })).toMatchObject({ capture: false, reason: 'bonus-pending' })
  })

  it('skips when event-status is empty, rather than treating it as all-clear', () => {
    const status: EventStatus = { status: [], leagues: '' }
    expect(decide({ status })).toMatchObject({ capture: false, reason: 'no-event-status' })
  })

  it('skips a gameweek already stored for every manager', () => {
    const decision = decide({ rosterSize: 18, captured: 18 })
    expect(decision).toEqual({ capture: false, gameweek: 1, reason: 'already-captured' })
  })

  it('retries a partial capture', () => {
    expect(decide({ rosterSize: 18, captured: 17 })).toMatchObject({ capture: true })
  })

  /** Departed managers keep their rows, so a shrunken roster must not stall the poll. */
  it('treats more stored entries than the roster as complete', () => {
    expect(decide({ rosterSize: 16, captured: 18 })).toMatchObject({ reason: 'already-captured' })
  })

  it('re-captures a complete gameweek when forced', () => {
    expect(decide({ rosterSize: 18, captured: 18, force: true })).toMatchObject({ capture: true })
  })

  it('does not let force bypass the readiness gate', () => {
    const status: EventStatus = { status: [], leagues: '' }
    expect(decide({ status, force: true })).toMatchObject({ capture: false })
  })

  it('picks the latest finished gameweek, not the first', () => {
    const bootstrap = { events: [settled(1), settled(2), event({ id: 3 })] }
    expect(decide({ bootstrap })).toMatchObject({ gameweek: 2 })
  })
})

/**
 * The global half, split out so the multi-league cron can ask it once per run.
 *
 * These overlap `captureDecision` deliberately — it delegates here, and the point of the
 * split is that this half answers without knowing anything about a league. A regression
 * that made this depend on roster or stored rows would not fail the tests above, because
 * those always supply both.
 */
describe('gameweekGate', () => {
  it('opens on a settled gameweek', () => {
    expect(gameweekGate({ events: [settled(1)] }, readyStatus)).toEqual({
      ready: true,
      gameweek: 1,
      reason: 'ready',
    })
  })

  it('holds shut while bonus has not been applied', () => {
    const status: EventStatus = {
      status: [{ bonus_added: false, date: '2026-08-22', event: 1, points: 'p' }],
      leagues: 'Updating',
    }
    expect(gameweekGate({ events: [settled(1)] }, status)).toMatchObject({ ready: false })
  })

  /**
   * The pair that `lastFinishedGameweek() === null` cannot tell apart on its own. Both
   * skip, and the reason has to differ — a live gameweek reported as `pre-season` is the
   * first field anyone reads when capture fails to fire.
   */
  it('reports a live gameweek as not-finished, not pre-season', () => {
    const live = { events: [event({ id: 1, is_current: true })] }
    expect(gameweekGate(live, { status: [], leagues: '' })).toEqual({
      ready: false,
      gameweek: 1,
      reason: 'not-finished',
    })
  })

  it('reports genuine pre-season as pre-season', () => {
    expect(gameweekGate({ events: [event({ id: 1 })] }, { status: [], leagues: '' })).toEqual({
      ready: false,
      gameweek: null,
      reason: 'pre-season',
    })
  })

  /** `[].every(...)` is true, so an empty status must be refused before it is read. */
  it('does not open on an empty event-status', () => {
    expect(
      gameweekGate({ events: [settled(1)] }, { status: [], leagues: 'Updated' }),
    ).toMatchObject({ ready: false })
  })
})

describe('runVerdict', () => {
  it('is ok when every league captured or skipped', () => {
    expect(runVerdict(['captured', 'skipped', 'captured'])).toBe('ok')
  })

  it('is ok for an empty run, which is a deployment with no leagues yet', () => {
    expect(runVerdict([])).toBe('ok')
  })

  /**
   * The decision this encodes: one league failing out of ten is still an error, because
   * the loss it represents is silent and permanent once a manager leaves.
   */
  it('is an error when any league failed, however many succeeded', () => {
    expect(runVerdict(['captured', 'captured', 'error'])).toBe('error')
  })

  /** A budget cut is normal — the next poll takes it, so alarming would cry wolf. */
  it('is ok when leagues were only deferred', () => {
    expect(runVerdict(['captured', 'deferred', 'deferred'])).toBe('ok')
  })
})
