import { describe, expect, it } from 'vitest'

import type { RosterManager } from '../fpl/roster'
import { computeDigestStats } from './stats'

function manager(over: Partial<RosterManager> & { entry: number }): RosterManager {
  return {
    entryName: `Team ${over.entry}`,
    playerName: `Player ${over.entry}`,
    rank: 1,
    lastRank: 1,
    total: 100,
    eventTotal: 50,
    pending: false,
    ...over,
  }
}

function pending(entry: number): RosterManager {
  return manager({
    entry,
    rank: null,
    lastRank: null,
    total: null,
    eventTotal: null,
    pending: true,
  })
}

describe('computeDigestStats', () => {
  it('sorts by rank and puts managers with no scores last', () => {
    const stats = computeDigestStats(
      [pending(9), manager({ entry: 2, rank: 2 }), manager({ entry: 1, rank: 1 })],
      1,
    )
    expect(stats.standings.map((r) => r.entry)).toEqual([1, 2, 9])
  })

  it('returns every manager on the top score, not just one', () => {
    const stats = computeDigestStats(
      [
        manager({ entry: 1, rank: 1, eventTotal: 80 }),
        manager({ entry: 2, rank: 2, eventTotal: 80 }),
        manager({ entry: 3, rank: 3, eventTotal: 60 }),
      ],
      5,
    )
    expect(stats.gwWinners.map((w) => w.entry)).toEqual([1, 2])
  })

  it('computes movement from last_rank, positive meaning moved up', () => {
    const stats = computeDigestStats(
      [
        manager({ entry: 1, rank: 1, lastRank: 5 }),
        manager({ entry: 2, rank: 8, lastRank: 3 }),
        manager({ entry: 3, rank: 4, lastRank: 4 }),
      ],
      6,
    )
    expect(stats.biggestRiser).toMatchObject({ entry: 1, places: 4 })
    expect(stats.biggestFaller).toMatchObject({ entry: 2, places: -5 })
  })

  // After GW1 there is no previous rank, so movement is unknown rather than zero —
  // otherwise every manager appears to have rocketed up the table.
  it('reports no movement after the first gameweek rather than inventing it', () => {
    const stats = computeDigestStats(
      [manager({ entry: 1, rank: 1, lastRank: null }), manager({ entry: 2, rank: 2, lastRank: null })],
      1,
    )
    expect(stats.standings.every((r) => r.movement === null)).toBe(true)
    expect(stats.biggestRiser).toBeNull()
    expect(stats.biggestFaller).toBeNull()
  })

  // The real pre-season state: 14 managers, none scored. The digest must not claim a
  // winner or an average of zero.
  it('handles a league where nobody has scored yet', () => {
    const stats = computeDigestStats([pending(1), pending(2), pending(3)], 1)

    expect(stats.pendingCount).toBe(3)
    expect(stats.gwWinners).toEqual([])
    expect(stats.leagueAverage).toBeNull()
    expect(stats.standings).toHaveLength(3)
  })

  it('averages only scored managers, so joiners do not drag it down', () => {
    const stats = computeDigestStats(
      [
        manager({ entry: 1, rank: 1, eventTotal: 60 }),
        manager({ entry: 2, rank: 2, eventTotal: 40 }),
        pending(3),
      ],
      4,
    )
    expect(stats.leagueAverage).toBe(50)
  })
})
