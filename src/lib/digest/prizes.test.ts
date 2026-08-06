import { describe, expect, it } from 'vitest'

import { splitEvenly, toCents } from './money'
import {
  allocateGameweekPrize,
  allocateRankPrizes,
  computePot,
  rankPrizePool,
  validatePrizeConfig,
  type PrizeConfig,
} from './prizes'

/** The reference league: $100 x 18, $15 per GW winner, $100 best GW, top 6 at 40/25/15/10/6/4. */
const reference: PrizeConfig = {
  potTotal: 1800,
  gwWinnerAmount: 15,
  seasonBestGwAmount: 100,
  rankPercentages: [40, 25, 15, 10, 6, 4],
  gameweekCount: 38,
}

describe('computePot', () => {
  it('takes fixed prizes off the top before percentages apply', () => {
    const pot = computePot(reference)
    expect(pot.potCents).toBe(180_000)
    expect(pot.committedFixedCents).toBe(67_000) // 38 x $15 + $100
    expect(pot.remainderCents).toBe(113_000) // $1,130
  })

  it('grows only the remainder as managers join, since fixed prizes are constant', () => {
    const at20 = computePot({ ...reference, potTotal: 2000 })
    expect(at20.committedFixedCents).toBe(67_000)
    expect(at20.remainderCents).toBe(133_000)
  })

  it('uses the real gameweek count rather than assuming 38', () => {
    expect(computePot({ ...reference, gameweekCount: 30 }).committedFixedCents).toBe(55_000)
  })
})

describe('validatePrizeConfig', () => {
  it('accepts the reference league', () => {
    expect(validatePrizeConfig(reference, 18)).toEqual([])
  })

  // Below 7 managers the fixed prizes exceed the pot.
  it('rejects a pot smaller than the fixed commitments', () => {
    const errors = validatePrizeConfig({ ...reference, potTotal: 600 })
    expect(errors.map((e) => e.code)).toContain('fixed-exceeds-pot')
  })

  it('rejects percentages that do not sum to 100', () => {
    const errors = validatePrizeConfig({ ...reference, rankPercentages: [40, 25, 15, 10, 6] })
    expect(errors.map((e) => e.code)).toContain('percentages-not-100')
  })

  it('accepts fractional percentages that do sum to 100', () => {
    expect(
      validatePrizeConfig({ ...reference, rankPercentages: [33.34, 33.33, 33.33] }),
    ).toEqual([])
  })

  it('rejects a place worth nothing', () => {
    const errors = validatePrizeConfig({ ...reference, rankPercentages: [40, 25, 15, 10, 10, 0] })
    expect(errors.map((e) => e.code)).toContain('non-positive-percentage')
  })

  it('rejects more paid places than managers', () => {
    const errors = validatePrizeConfig(reference, 4)
    expect(errors.map((e) => e.code)).toContain('more-places-than-managers')
  })
})

describe('rankPrizePool', () => {
  it('splits the reference remainder exactly', () => {
    const prizes = rankPrizePool(113_000, reference.rankPercentages)
    expect(prizes).toEqual([45_200, 28_250, 16_950, 11_300, 6_780, 4_520])
  })

  it('always conserves the remainder, even when percentages do not divide cleanly', () => {
    // Thirds of an odd amount: the naive approach loses a cent here.
    const prizes = rankPrizePool(100_001, [33.33, 33.33, 33.34])
    expect(prizes.reduce((a, b) => a + b, 0)).toBe(100_001)
  })

  it('conserves the pot across a range of awkward remainders', () => {
    for (const remainder of [1, 7, 99, 100_003, 999_999]) {
      const prizes = rankPrizePool(remainder, reference.rankPercentages)
      expect(prizes.reduce((a, b) => a + b, 0)).toBe(remainder)
    }
  })
})

describe('allocateRankPrizes', () => {
  const pool = rankPrizePool(113_000, reference.rankPercentages)

  it('pays each rank its own prize when there are no ties', () => {
    const managers = [1, 2, 3, 4, 5, 6, 7].map((rank) => ({
      entry: rank,
      rank,
      rankSort: rank,
    }))
    const allocations = allocateRankPrizes(managers, pool)

    expect(allocations).toHaveLength(6) // 7th is unpaid
    expect(allocations.find((a) => a.rank === 1)!.amountCents).toBe(45_200)
    expect(allocations.find((a) => a.rank === 6)!.amountCents).toBe(4_520)
  })

  // The user's first example: two tied for 1st share 1st + 2nd, next manager gets 3rd.
  it('pools 1st and 2nd for a tie at the top, and the next manager takes 3rd', () => {
    const managers = [
      { entry: 1, rank: 1, rankSort: 1 },
      { entry: 2, rank: 1, rankSort: 2 },
      { entry: 3, rank: 3, rankSort: 3 },
    ]
    const allocations = allocateRankPrizes(managers, pool)

    const tied = allocations.filter((a) => a.rank === 1)
    expect(tied.map((a) => a.amountCents)).toEqual([36_725, 36_725]) // ($452 + $282.50) / 2
    expect(allocations.find((a) => a.rank === 3)!.amountCents).toBe(16_950)
  })

  // The user's second example: two tied for 6th share only 6th, since 7th pays nothing.
  it('shares just the last paid prize when the tie straddles the cut-off', () => {
    const managers = [
      { entry: 6, rank: 6, rankSort: 6 },
      { entry: 7, rank: 6, rankSort: 7 },
    ]
    const allocations = allocateRankPrizes(managers, pool)

    expect(allocations.map((a) => a.amountCents)).toEqual([2_260, 2_260]) // $45.20 / 2
  })

  it('never pays out more than the pool', () => {
    const managers = [
      { entry: 1, rank: 1, rankSort: 1 },
      { entry: 2, rank: 1, rankSort: 2 },
      { entry: 3, rank: 1, rankSort: 3 },
      { entry: 4, rank: 4, rankSort: 4 },
      { entry: 5, rank: 5, rankSort: 5 },
      { entry: 6, rank: 6, rankSort: 6 },
    ]
    const total = allocateRankPrizes(managers, pool).reduce((a, b) => a + b.amountCents, 0)
    expect(total).toBe(113_000)
  })

  // Detecting ties on rank_sort would make this look resolved and pay 1st in full to one.
  it('treats managers sharing a rank as tied even though rank_sort orders them', () => {
    const managers = [
      { entry: 1, rank: 1, rankSort: 1 },
      { entry: 2, rank: 1, rankSort: 2 },
    ]
    const allocations = allocateRankPrizes(managers, pool)
    expect(allocations[0].amountCents).toBe(allocations[1].amountCents)
  })
})

describe('allocateGameweekPrize', () => {
  it('pays the single highest scorer', () => {
    const allocations = allocateGameweekPrize(
      [
        { entry: 1, eventTotal: 60, rankSort: 1 },
        { entry: 2, eventTotal: 72, rankSort: 2 },
      ],
      15,
    )
    expect(allocations).toEqual([{ entry: 2, rank: 1, amountCents: 1_500 }])
  })

  // $15 between three is $5 each; $10 between three is where rounding bites.
  it('splits between tied winners rather than paying each in full', () => {
    const scores = [1, 2, 3].map((entry) => ({ entry, eventTotal: 80, rankSort: entry }))

    expect(allocateGameweekPrize(scores, 15).map((a) => a.amountCents)).toEqual([500, 500, 500])

    const awkward = allocateGameweekPrize(scores, 10)
    expect(awkward.map((a) => a.amountCents)).toEqual([334, 333, 333])
    expect(awkward.reduce((a, b) => a + b.amountCents, 0)).toBe(1_000)
  })

  it('ignores managers with no score yet', () => {
    const allocations = allocateGameweekPrize(
      [
        { entry: 1, eventTotal: null, rankSort: 1 },
        { entry: 2, eventTotal: 40, rankSort: 2 },
      ],
      15,
    )
    expect(allocations.map((a) => a.entry)).toEqual([2])
  })

  it('returns nothing before anyone has scored', () => {
    expect(allocateGameweekPrize([{ entry: 1, eventTotal: null, rankSort: 1 }], 15)).toEqual([])
  })
})

describe('splitEvenly', () => {
  it('conserves every cent', () => {
    for (const [total, count] of [
      [1_000, 3],
      [1, 2],
      [113_000, 7],
      [45_201, 4],
    ] as const) {
      expect(splitEvenly(total, count).reduce((a, b) => a + b, 0)).toBe(total)
    }
  })

  it('hands the indivisible remainder to the earliest recipients', () => {
    expect(splitEvenly(1_000, 3)).toEqual([334, 333, 333])
  })
})

describe('toCents', () => {
  it('survives amounts that float arithmetic mangles', () => {
    expect(toCents(1.15)).toBe(115)
    expect(toCents('0.07')).toBe(7)
    expect(toCents(1129.99)).toBe(112_999)
  })
})
