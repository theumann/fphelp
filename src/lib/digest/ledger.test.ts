import { describe, expect, it } from 'vitest'

import type { PrizeSummary } from '../render/blocks'

import { computeLedger, type GameweekScore, type LedgerInput } from './ledger'

/** $15 per gameweek, $100 best gameweek, top 3 at $500 / $300 / $200. */
const prize: PrizeSummary = {
  currency: 'USD',
  potSet: true,
  potCents: 180_000,
  gwWinnerCents: 1_500,
  seasonBestGwCents: 10_000,
  expenses: [],
  rankPrizeCents: [50_000, 30_000, 20_000],
}

/** Rows for one gameweek, one per manager in entry order: `scores(1, [60, 70])`. */
function scores(gameweek: number, points: number[]): GameweekScore[] {
  return points.map((p, i) => ({ entry: i + 1, gameweek, points: p }))
}

function input(over: Partial<LedgerInput> = {}): LedgerInput {
  return {
    history: [...scores(1, [60, 70, 50]), ...scores(2, [80, 40, 55])],
    settledThrough: 2,
    gameweekCount: 38,
    currentEntries: [1, 2, 3],
    standings: [
      { entry: 1, rank: 1, rankSort: 1 },
      { entry: 2, rank: 2, rankSort: 2 },
      { entry: 3, rank: 3, rankSort: 3 },
    ],
    prize,
    ...over,
  }
}

const manager = (ledger: ReturnType<typeof computeLedger>, entry: number) =>
  ledger.managers.find((m) => m.entry === entry)

describe('computeLedger', () => {
  it('pays each settled gameweek to its highest scorer, as a final amount', () => {
    const ledger = computeLedger(input())

    expect(ledger.gameweeks).toEqual([
      { gameweek: 1, status: 'paid', points: 70, winners: [{ entry: 2, amountCents: 1_500 }] },
      { gameweek: 2, status: 'paid', points: 80, winners: [{ entry: 1, amountCents: 1_500 }] },
    ])
    expect(manager(ledger, 1)?.gameweeksWon).toEqual([2])
    expect(manager(ledger, 2)?.finalCents).toBe(1_500)
    expect(ledger.finalTotalCents).toBe(3_000)
  })

  it('splits a tied gameweek and conserves every cent', () => {
    // Three-way tie on $10: $3.34 + $3.33 + $3.33, never three lots of $3.33.
    const ledger = computeLedger(
      input({
        history: scores(1, [70, 70, 70]),
        settledThrough: 1,
        prize: { ...prize, gwWinnerCents: 1_000 },
      }),
    )

    const winners = ledger.gameweeks[0].winners
    expect(winners.map((w) => w.amountCents)).toEqual([334, 333, 333])
    expect(ledger.finalTotalCents).toBe(1_000)
  })

  it('ignores rows past the settled gameweek — a live gameweek pays nobody', () => {
    const ledger = computeLedger(
      input({ history: [...scores(1, [60, 70, 50]), ...scores(2, [99, 40, 55])], settledThrough: 1 }),
    )

    expect(ledger.gameweeks.map((g) => g.gameweek)).toEqual([1])
    // Entry 1's 99 is still provisional, so it neither wins GW2 nor sets the season best.
    expect(ledger.bestGw?.points).toBe(70)
    expect(manager(ledger, 1)?.gameweeksWon ?? []).toEqual([])
  })

  it('withholds the newest gameweek while its capture is partial', () => {
    // Manager 3 has not been captured for GW2 yet, and may be the one who won it.
    const ledger = computeLedger(
      input({ history: [...scores(1, [60, 70, 50]), ...scores(2, [80, 40])] }),
    )

    expect(ledger.gameweeks[1]).toEqual({
      gameweek: 2,
      status: 'capturing',
      points: null,
      winners: [],
    })
    expect(ledger.finalTotalCents).toBe(1_500)
    // Nor does a half-captured gameweek get to set the season's best.
    expect(ledger.bestGw?.points).toBe(70)
  })

  it('does not wait on a manager who joined for the gameweek now being played', () => {
    // Entry 4 is in standings because GW3 is live and they joined for it. They will never
    // have a GW2 row, and must not hold GW2 at "still being captured" all week.
    const ledger = computeLedger(
      input({
        history: [
          ...scores(1, [60, 70, 50]),
          ...scores(2, [80, 40, 55]),
          { entry: 4, gameweek: 3, points: 95 },
        ],
        currentEntries: [1, 2, 3, 4],
      }),
    )

    expect(ledger.gameweeks[1]).toMatchObject({ gameweek: 2, status: 'paid', points: 80 })
  })

  it('reports a settled gameweek with no history instead of skipping it', () => {
    const ledger = computeLedger(input({ history: scores(2, [80, 40, 55]) }))

    expect(ledger.gameweeks[0]).toEqual({ gameweek: 1, status: 'missing', points: null, winners: [] })
    expect(ledger.gameweeks[1].status).toBe('paid')
  })

  it('pays a manager who has since left the league for the gameweeks they won', () => {
    // Entry 9 won GW1 and is no longer in standings or the expected count.
    const ledger = computeLedger(
      input({
        history: [...scores(1, [60, 70]), { entry: 9, gameweek: 1, points: 90 }, ...scores(2, [80, 40, 55])],
      }),
    )

    expect(manager(ledger, 9)?.finalCents).toBe(1_500)
    expect(manager(ledger, 9)?.rankPrize).toBeNull()
  })

  it('gives the season best to the highest single score, provisionally', () => {
    const ledger = computeLedger(input())

    expect(ledger.bestGw).toEqual({ points: 80, gameweeks: [{ entry: 1, gameweek: 2 }] })
    expect(manager(ledger, 1)?.bestGw).toEqual({ amountCents: 10_000 })
  })

  it('splits a tied season best between managers, not between occurrences', () => {
    // Entry 1 scores 80 twice, entry 2 once: two holders, so $50 each.
    const ledger = computeLedger(
      input({
        history: [...scores(1, [80, 80, 50]), ...scores(2, [80, 40, 55])],
      }),
    )

    expect(manager(ledger, 1)?.bestGw).toEqual({ amountCents: 5_000 })
    expect(manager(ledger, 2)?.bestGw).toEqual({ amountCents: 5_000 })
    expect(ledger.bestGw?.gameweeks).toHaveLength(3)
  })

  it('projects rank prizes from standings, pooling a tie on rank', () => {
    const ledger = computeLedger(
      input({
        standings: [
          { entry: 1, rank: 1, rankSort: 1 },
          { entry: 2, rank: 1, rankSort: 2 },
          { entry: 3, rank: 3, rankSort: 3 },
        ],
      }),
    )

    // 1st + 2nd pooled and split: ($500 + $300) / 2.
    expect(manager(ledger, 1)?.rankPrize).toEqual({ rank: 1, amountCents: 40_000 })
    expect(manager(ledger, 2)?.rankPrize).toEqual({ rank: 1, amountCents: 40_000 })
    expect(manager(ledger, 3)?.rankPrize).toEqual({ rank: 3, amountCents: 20_000 })
  })

  it('keeps final and provisional totals apart', () => {
    const ledger = computeLedger(input())
    const m1 = manager(ledger, 1)!

    expect(m1.finalCents).toBe(1_500) // GW2
    expect(m1.provisionalCents).toBe(10_000 + 50_000) // best GW + 1st place
    expect(ledger.provisionalTotalCents).toBe(10_000 + 100_000)
  })

  it('leaves rank prizes out when the pot is unset, rather than paying $0', () => {
    const ledger = computeLedger(input({ prize: { ...prize, potSet: false, potCents: 0 } }))

    expect(ledger.rankPrizesKnown).toBe(false)
    expect(ledger.managers.every((m) => m.rankPrize === null)).toBe(true)
    // Fixed prizes are amounts per winner, not shares of the pot, so they still accrue.
    expect(ledger.finalTotalCents).toBe(3_000)
  })

  it('is empty before any gameweek has settled', () => {
    const ledger = computeLedger(input({ history: [], settledThrough: 0, standings: [] }))

    expect(ledger.gameweeks).toEqual([])
    expect(ledger.managers).toEqual([])
    expect(ledger.bestGw).toBeNull()
  })

  it('orders managers by total, largest first', () => {
    const ledger = computeLedger(input())
    const totals = ledger.managers.map((m) => m.finalCents + m.provisionalCents)
    expect(totals).toEqual([...totals].sort((a, b) => b - a))
  })

  it('marks the season complete once the last gameweek settles', () => {
    expect(computeLedger(input()).seasonComplete).toBe(false)
    expect(computeLedger(input({ gameweekCount: 2 })).seasonComplete).toBe(true)
  })
})
