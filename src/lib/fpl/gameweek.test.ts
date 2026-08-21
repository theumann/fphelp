import { describe, expect, it } from 'vitest'

import {
  gameweekCount,
  isGameweekReady,
  lastFinishedGameweek,
  liveGameweek,
  sendGate,
} from './gameweek'
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

const bootstrap = (e: Partial<FplEvent> & { id: number }): BootstrapStatic => ({
  events: [event(e)],
})

const status = (over: Partial<EventStatus> = {}): EventStatus => ({
  status: [{ date: '2026-08-21', event: 1, bonus_added: true, points: 'r' }],
  leagues: 'Updated',
  ...over,
})

describe('isGameweekReady', () => {
  it('is ready when bonus is added, leagues updated, and data checked', () => {
    const r = isGameweekReady(bootstrap({ id: 1, finished: true, data_checked: true }), status(), 1)
    expect(r).toEqual({ ready: true, reason: 'ready' })
  })

  // The bug this guard exists for: [].every(...) is vacuously true, so without an
  // explicit length check the gate opens outside a live gameweek. This is the real
  // pre-season payload, confirmed live: {"status":[],"leagues":""}.
  it('is NOT ready when event-status is empty, despite every() being vacuously true', () => {
    const empty: EventStatus = { status: [], leagues: '' }
    expect(empty.status.every((d) => d.bonus_added)).toBe(true) // the trap

    const r = isGameweekReady(bootstrap({ id: 1, finished: true, data_checked: true }), empty, 1)
    expect(r).toEqual({ ready: false, reason: 'no-event-status' })
  })

  it('is NOT ready while bonus points are still pending', () => {
    const s = status({
      status: [
        { date: '2026-08-21', event: 1, bonus_added: true, points: 'r' },
        { date: '2026-08-22', event: 1, bonus_added: false, points: 'p' },
      ],
    })
    const r = isGameweekReady(bootstrap({ id: 1, finished: true, data_checked: true }), s, 1)
    expect(r.ready).toBe(false)
    expect(r.reason).toBe('bonus-pending')
  })

  it('is NOT ready when league tables have not been recalculated', () => {
    const r = isGameweekReady(
      bootstrap({ id: 1, finished: true, data_checked: true }),
      status({ leagues: '' }),
      1,
    )
    expect(r.reason).toBe('leagues-not-updated')
  })

  // finished flips before bonus is applied, so it is necessary but never sufficient.
  it('is NOT ready when the gameweek has not finished', () => {
    const r = isGameweekReady(bootstrap({ id: 1, finished: false }), status(), 1)
    expect(r.reason).toBe('not-finished')
  })
})

describe('gameweekCount', () => {
  it('counts events rather than assuming 38', () => {
    expect(gameweekCount({ events: [event({ id: 1 }), event({ id: 2 })] })).toBe(2)
  })
})

/**
 * Telling "nothing has been played" apart from "something is being played".
 *
 * `lastFinishedGameweek()` returns null for both, and the send page used to treat that one
 * answer as pre-season — which is true for fifty-one weeks a year and false during the
 * first gameweek of a season, when nothing has finished and everyone already has a
 * provisional score.
 */
describe('liveGameweek', () => {
  it('is null before a ball is kicked', () => {
    const bootstrap: BootstrapStatic = {
      events: [event({ id: 1, is_next: true }), event({ id: 2 })],
    }

    expect(liveGameweek(bootstrap)).toBeNull()
    expect(lastFinishedGameweek(bootstrap)).toBeNull()
  })

  /** The real GW1 shape, taken from the live API at 2026-08-21T18:09Z. */
  it('names the gameweek in progress, when none has finished yet', () => {
    const bootstrap: BootstrapStatic = {
      events: [
        event({ id: 1, is_current: true, finished: false, data_checked: false }),
        event({ id: 2, is_next: true }),
      ],
    }

    // Both true at once is exactly the state the old bypass mistook for pre-season.
    expect(lastFinishedGameweek(bootstrap)).toBeNull()
    expect(liveGameweek(bootstrap)).toBe(1)
  })

  it('is null once the current gameweek has finished', () => {
    const bootstrap: BootstrapStatic = {
      events: [event({ id: 1, is_current: true, finished: true }), event({ id: 2, is_next: true })],
    }

    expect(liveGameweek(bootstrap)).toBeNull()
    expect(lastFinishedGameweek(bootstrap)).toBe(1)
  })

  /** Mid-season: last week is done and this week is under way. */
  it('names the live gameweek while an earlier one is finished', () => {
    const bootstrap: BootstrapStatic = {
      events: [
        event({ id: 1, finished: true, data_checked: true, is_previous: true }),
        event({ id: 2, is_current: true, finished: false }),
      ],
    }

    expect(lastFinishedGameweek(bootstrap)).toBe(1)
    expect(liveGameweek(bootstrap)).toBe(2)
  })
})

/**
 * The one decision standing between an owner and an irreversible message to their league.
 *
 * The state that matters most here is the first gameweek of a season, because it is the
 * only time "nothing has finished" and "everybody has a score" are true together — and it
 * arrives once a year, on the weekend the app has never been used before.
 */
describe('sendGate', () => {
  const settled: EventStatus = {
    leagues: 'Updated',
    status: [{ bonus_added: true, date: '2026-08-24', event: 1, points: 'r' }],
  }
  const live: EventStatus = {
    leagues: '',
    status: [{ bonus_added: false, date: '2026-08-21', event: 1, points: '' }],
  }
  const empty: EventStatus = { leagues: '', status: [] }

  it('lets a pre-season league use the blocks, since nobody has scored', () => {
    const bootstrap: BootstrapStatic = { events: [event({ id: 1, is_next: true })] }

    expect(sendGate(bootstrap, empty)).toEqual({ gameweek: 1, statsReady: true, reason: 'ready' })
  })

  /**
   * The regression. Exactly the payload the live API returned at 2026-08-21T18:09Z, forty
   * minutes into GW1: nothing finished, GW1 current, managers already carrying points.
   */
  it('withholds the stats while a gameweek is being played right now', () => {
    const bootstrap: BootstrapStatic = {
      events: [event({ id: 1, is_current: true, finished: false }), event({ id: 2, is_next: true })],
    }

    expect(sendGate(bootstrap, live)).toEqual({
      gameweek: 1,
      statsReady: false,
      reason: 'not-finished',
    })
  })

  it('still withholds a finished gameweek whose bonus points have not landed', () => {
    const bootstrap: BootstrapStatic = {
      events: [event({ id: 1, finished: true, data_checked: true, is_current: true })],
    }

    const gate = sendGate(bootstrap, live)
    expect(gate.statsReady).toBe(false)
    expect(gate.gameweek).toBe(1)
  })

  it('opens once the gameweek has settled', () => {
    const bootstrap: BootstrapStatic = {
      events: [event({ id: 1, finished: true, data_checked: true, is_current: true })],
    }

    expect(sendGate(bootstrap, settled)).toEqual({ gameweek: 1, statsReady: true, reason: 'ready' })
  })

  /** Last week is sendable while this week is under way — the ordinary in-season case. */
  it('offers the finished gameweek while the next one is being played', () => {
    const bootstrap: BootstrapStatic = {
      events: [
        event({ id: 1, finished: true, data_checked: true, is_previous: true }),
        event({ id: 2, is_current: true, finished: false }),
      ],
    }

    expect(sendGate(bootstrap, settled)).toEqual({ gameweek: 1, statsReady: true, reason: 'ready' })
  })
})
