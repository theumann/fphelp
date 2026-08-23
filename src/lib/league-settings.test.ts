import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SETTINGS,
  fromPrizeRules,
  suggestPercentages,
  summarise,
  toPrizeRules,
  validateSettings,
  type LeagueSettings,
  type PrizeRuleRow,
} from './league-settings'

const settings: LeagueSettings = {
  potTotal: 1800,
  currency: 'USD',
  gwWinnerAmount: 15,
  seasonBestGwAmount: 100,
  rankPercentages: [40, 25, 15, 10, 6, 4],
  expenses: [],
}

describe('toPrizeRules / fromPrizeRules', () => {
  it('round-trips settings through the row shape', () => {
    const rows = toPrizeRules(settings)
    const back = fromPrizeRules(rows, {
      potTotal: settings.potTotal,
      currency: settings.currency,
    })
    expect(back).toEqual(settings)
  })

  it('stores one row per paid place, so the count is the number of places', () => {
    const rows = toPrizeRules({ ...settings, rankPercentages: [50, 30, 20] })
    expect(rows.filter((r) => r.kind === 'season_rank_pct')).toHaveLength(3)
  })

  // Row order from the database is not guaranteed; mis-ordered percentages would pay
  // the wrong amount to the wrong place, with nothing to signal it.
  it('sorts rank rows by rank rather than trusting row order', () => {
    const shuffled: PrizeRuleRow[] = [
      { kind: 'season_rank_pct', rank: 3, value: '15' },
      { kind: 'season_rank_pct', rank: 1, value: '40' },
      { kind: 'season_rank_pct', rank: 2, value: '25' },
      { kind: 'gw_winner_fixed', rank: null, value: '15' },
      { kind: 'season_best_gw_fixed', rank: null, value: '100' },
    ]
    const back = fromPrizeRules(shuffled, { potTotal: 1800, currency: 'USD' })
    expect(back.rankPercentages).toEqual([40, 25, 15])
  })

  it('falls back to defaults when a league has no rules yet', () => {
    const back = fromPrizeRules([], { potTotal: 0, currency: 'USD' })
    expect(back.rankPercentages).toEqual([...DEFAULT_SETTINGS.rankPercentages])
    expect(back.gwWinnerAmount).toBe(DEFAULT_SETTINGS.gwWinnerAmount)
  })
})

describe('validateSettings', () => {
  it('accepts the reference configuration', () => {
    expect(validateSettings(settings, 38, 18)).toEqual([])
  })

  it('rejects percentages that do not total 100', () => {
    const errors = validateSettings({ ...settings, rankPercentages: [50, 30] }, 38)
    expect(errors.map((e) => e.code)).toContain('percentages-not-100')
  })

  it('rejects fixed prizes that exceed the pot', () => {
    const errors = validateSettings({ ...settings, potTotal: 500 }, 38)
    expect(errors.map((e) => e.code)).toContain('fixed-exceeds-pot')
  })

  // A shortened season changes the commitment, so the count must come from the API.
  // A $600 pot cannot cover 38 x $15 + $100 = $670, but does cover 30 x $15 + $100 = $550.
  it('uses the real gameweek count', () => {
    expect(validateSettings({ ...settings, potTotal: 600 }, 38).map((e) => e.code)).toContain(
      'fixed-exceeds-pot',
    )
    expect(validateSettings({ ...settings, potTotal: 600 }, 30)).toEqual([])
  })
})

describe('suggestPercentages', () => {
  it('always totals exactly 100', () => {
    for (let n = 1; n <= 20; n++) {
      const total = suggestPercentages(n).reduce((a, b) => a + b, 0)
      expect(total, `for ${n} places`).toBeCloseTo(100, 6)
    }
  })

  it('returns one value per place', () => {
    expect(suggestPercentages(4)).toHaveLength(4)
    expect(suggestPercentages(12)).toHaveLength(12)
  })

  it('descends — first place is never worth less than last', () => {
    for (const n of [3, 6, 9, 15]) {
      const pcts = suggestPercentages(n)
      const sorted = [...pcts].sort((a, b) => b - a)
      expect(pcts).toEqual(sorted)
    }
  })

  it('keeps the agreed default for six places', () => {
    expect(suggestPercentages(6)).toEqual([40, 25, 15, 10, 6, 4])
  })

  it('produces a valid configuration for any size', () => {
    for (const n of [1, 3, 7, 11]) {
      const errors = validateSettings({ ...settings, rankPercentages: suggestPercentages(n) }, 38)
      expect(errors, `for ${n} places`).toEqual([])
    }
  })

  it('returns nothing for zero places', () => {
    expect(suggestPercentages(0)).toEqual([])
  })
})

describe('summarise', () => {
  it('derives the payout table from the remainder', () => {
    const summary = summarise(settings, 38)
    expect(summary.potCents).toBe(180_000)
    expect(summary.rankPrizeCents).toEqual([45_200, 28_250, 16_950, 11_300, 6_780, 4_520])
  })

  it('conserves the remainder for any number of places', () => {
    const summary = summarise({ ...settings, rankPercentages: [33.34, 33.33, 33.33] }, 38)
    const total = summary.rankPrizeCents.reduce((a, b) => a + b, 0)
    expect(total).toBe(180_000 - 67_000)
  })

  it('shrinks the payout table by the league expenses', () => {
    const summary = summarise(
      { ...settings, expenses: [{ label: 'Trophy engraving', amount: 100 }] },
      38,
    )
    const total = summary.rankPrizeCents.reduce((a, b) => a + b, 0)

    // $1,130 remainder less $100 of engraving — the whole point of the feature.
    expect(total).toBe(103_000)
    expect(summary.potCents).toBe(180_000)
  })

  it('carries the costs itemised, since the digest names each one', () => {
    const summary = summarise(
      { ...settings, expenses: [{ label: 'Trophy engraving', amount: 100 }] },
      38,
    )
    expect(summary.expenses).toEqual([{ label: 'Trophy engraving', amountCents: 10_000 }])
  })
})
