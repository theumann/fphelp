import { describe, expect, it } from 'vitest'

import { gameweekCount, isGameweekReady } from './gameweek'
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
