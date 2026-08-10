import { describe, expect, it } from 'vitest'

import { droppedGameweeks, historyRows } from './history'
import type { EntryHistory } from './types'

// Overrides are deliberately untyped: these tests feed the shapes an unofficial API
// might actually return, including ones the declared type says are impossible.
const event = (over: Record<string, unknown> = {}) => ({
  event: 1,
  points: 62,
  total_points: 62,
  rank: 3,
  overall_rank: 1_250_000,
  points_on_bench: 5,
  event_transfers_cost: 0,
  ...over,
})

const history = (current: unknown[]): EntryHistory =>
  ({ current, past: [], chips: [] }) as unknown as EntryHistory

describe('historyRows', () => {
  it('maps every gameweek in current[], not just the latest', () => {
    const rows = historyRows(42, history([event({ event: 1 }), event({ event: 2 })]))

    expect(rows.map((r) => r.gameweek)).toEqual([1, 2])
    expect(rows.every((r) => r.entry === 42)).toBe(true)
  })

  it('maps the snake_case API fields onto the camelCase row', () => {
    const [row] = historyRows(42, history([event()]))

    expect(row).toEqual({
      entry: 42,
      gameweek: 1,
      points: 62,
      totalPoints: 62,
      rank: 3,
      overallRank: 1_250_000,
      pointsOnBench: 5,
      eventTransfersCost: 0,
    })
  })

  it('keeps a genuine zero score rather than treating it as missing', () => {
    const [row] = historyRows(42, history([event({ points: 0, total_points: 0 })]))

    expect(row.points).toBe(0)
    expect(row.totalPoints).toBe(0)
  })

  // The schema requires points and total_points. Defaulting a missing one to zero would
  // store a fabricated score indistinguishable from a real one.
  it.each(['points', 'total_points'])('drops a row missing %s', (field) => {
    const rows = historyRows(42, history([event({ [field]: undefined })]))

    expect(rows).toEqual([])
  })

  it('drops a row with no gameweek number, since it cannot be keyed', () => {
    expect(historyRows(42, history([event({ event: undefined })]))).toEqual([])
  })

  it('keeps good gameweeks when a sibling is malformed', () => {
    const rows = historyRows(
      42,
      history([event({ event: 1 }), event({ event: 2, points: null }), event({ event: 3 })]),
    )

    expect(rows.map((r) => r.gameweek)).toEqual([1, 3])
  })

  it('nulls absent optional fields instead of coercing them to zero', () => {
    const [row] = historyRows(
      42,
      history([event({ rank: null, overall_rank: undefined, points_on_bench: undefined })]),
    )

    expect(row.rank).toBeNull()
    expect(row.overallRank).toBeNull()
    expect(row.pointsOnBench).toBeNull()
  })

  // Pre-season every manager is in this state, and it must not throw.
  it('returns nothing for an empty season', () => {
    expect(historyRows(42, history([]))).toEqual([])
  })

  it('survives current[] being absent or the wrong type', () => {
    expect(historyRows(42, {} as EntryHistory)).toEqual([])
    expect(historyRows(42, history(null as unknown as unknown[]))).toEqual([])
  })
})

describe('droppedGameweeks', () => {
  it('reports skipped gameweeks so data loss is visible, not silent', () => {
    expect(droppedGameweeks(history([event({ event: 1 }), event({ event: 2, points: null })]))).toEqual([
      2,
    ])
  })

  it('is empty when everything parsed', () => {
    expect(droppedGameweeks(history([event()]))).toEqual([])
  })
})
