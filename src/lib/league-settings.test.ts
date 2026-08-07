import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SETTINGS,
  fromPrizeRules,
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
})
