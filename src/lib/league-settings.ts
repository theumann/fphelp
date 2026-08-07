import type { PrizeConfig } from './digest/prizes'
import { computePot, rankPrizePool, validatePrizeConfig } from './digest/prizes'
import type { PrizeSummary } from './render/blocks'

/** Defaults for a new league. Everything here is editable at setup. */
export const DEFAULT_SETTINGS = {
  currency: 'USD',
  gwWinnerAmount: 15,
  seasonBestGwAmount: 100,
  /** Six paid places. The count IS the number of places — no separate field. */
  rankPercentages: [40, 25, 15, 10, 6, 4],
} as const

/** A prize_rules row, in the shape the database stores. */
export interface PrizeRuleRow {
  kind: 'gw_winner_fixed' | 'season_best_gw_fixed' | 'season_rank_pct'
  rank: number | null
  value: string
}

export interface LeagueSettings {
  potTotal: number
  currency: string
  entryFee?: number
  gwWinnerAmount: number
  seasonBestGwAmount: number
  /** Index 0 = 1st place. Length is the number of paid places. */
  rankPercentages: number[]
}

/** Flattens settings into prize_rules rows. */
export function toPrizeRules(settings: LeagueSettings): PrizeRuleRow[] {
  return [
    { kind: 'gw_winner_fixed', rank: null, value: String(settings.gwWinnerAmount) },
    { kind: 'season_best_gw_fixed', rank: null, value: String(settings.seasonBestGwAmount) },
    ...settings.rankPercentages.map((pct, i) => ({
      kind: 'season_rank_pct' as const,
      rank: i + 1,
      value: String(pct),
    })),
  ]
}

/**
 * Rebuilds settings from prize_rules rows.
 *
 * Rank rows are sorted by `rank` rather than trusted in row order — the database makes
 * no ordering guarantee, and silently mis-ordered percentages would pay the wrong
 * amounts to the wrong places.
 */
export function fromPrizeRules(
  rows: PrizeRuleRow[],
  base: { potTotal: number; currency: string; entryFee?: number },
): LeagueSettings {
  const gwWinner = rows.find((r) => r.kind === 'gw_winner_fixed')
  const bestGw = rows.find((r) => r.kind === 'season_best_gw_fixed')

  const rankPercentages = rows
    .filter((r) => r.kind === 'season_rank_pct')
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
    .map((r) => Number(r.value))

  return {
    ...base,
    gwWinnerAmount: Number(gwWinner?.value ?? DEFAULT_SETTINGS.gwWinnerAmount),
    seasonBestGwAmount: Number(bestGw?.value ?? DEFAULT_SETTINGS.seasonBestGwAmount),
    rankPercentages:
      rankPercentages.length > 0 ? rankPercentages : [...DEFAULT_SETTINGS.rankPercentages],
  }
}

export function toPrizeConfig(settings: LeagueSettings, gameweekCount: number): PrizeConfig {
  return {
    potTotal: settings.potTotal,
    gwWinnerAmount: settings.gwWinnerAmount,
    seasonBestGwAmount: settings.seasonBestGwAmount,
    rankPercentages: settings.rankPercentages,
    gameweekCount,
  }
}

/** Validation for the setup form. Must also run server-side — the client's is only UX. */
export function validateSettings(
  settings: LeagueSettings,
  gameweekCount: number,
  managerCount?: number,
) {
  return validatePrizeConfig(toPrizeConfig(settings, gameweekCount), managerCount)
}

export function summarise(settings: LeagueSettings, gameweekCount: number): PrizeSummary {
  const config = toPrizeConfig(settings, gameweekCount)
  const pot = computePot(config)

  return {
    currency: settings.currency,
    potCents: pot.potCents,
    gwWinnerCents: Math.round(settings.gwWinnerAmount * 100),
    seasonBestGwCents: Math.round(settings.seasonBestGwAmount * 100),
    rankPrizeCents: rankPrizePool(pot.remainderCents, settings.rankPercentages),
  }
}
