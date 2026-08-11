import { describe, expect, it } from 'vitest'

import { captureDecision } from './capture'
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
