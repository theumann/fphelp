import type { PrizeConfig } from './digest/prizes'
import { toCents } from './digest/money'
import { computePot, rankPrizePool, validatePrizeConfig } from './digest/prizes'
import type { PrizeSummary } from './render/blocks'

/** Defaults for a new league. Everything here is editable at setup. */
export const DEFAULT_SETTINGS = {
  currency: 'USD',
  gwWinnerAmount: 15,
  seasonBestGwAmount: 100,
  /** Six paid places. The count IS the number of places — no separate field. */
  rankPercentages: [40, 25, 15, 10, 6, 4],
  /** No league starts with costs; the reference league's engraving is entered by hand. */
  expenses: [] as LeagueExpense[],
} as const

/** A league_expenses row. The label is member-facing — the digest prints it. */
export interface LeagueExpense {
  label: string
  amount: number
}

/** A prize_rules row, in the shape the database stores. */
export interface PrizeRuleRow {
  kind: 'gw_winner_fixed' | 'season_best_gw_fixed' | 'season_rank_pct'
  rank: number | null
  value: string
}

export interface LeagueSettings {
  /**
   * `undefined` means nobody has set it yet, which is not the same as zero.
   *
   * The distinction is load-bearing rather than tidy: a league handed over unconfigured
   * would otherwise validate as "fixed prizes exceed the pot" and render `Pot: $0.00` into
   * the digest, both of which state something false about the league's money instead of
   * admitting the figure is unknown.
   */
  potTotal: number | undefined
  currency: string
  entryFee?: number
  gwWinnerAmount: number
  seasonBestGwAmount: number
  /** Index 0 = 1st place. Length is the number of paid places. */
  rankPercentages: number[]
  /**
   * Costs paid out of the pot before any prize.
   *
   * Part of the settings rather than a list that saves on each click, because they are
   * one of the terms in the pot arithmetic: adding an expense can push a league past
   * `fixed-exceeds-pot`, and that has to be validated with the pot and the fixed prizes
   * as one set, behind one Save.
   */
  expenses: LeagueExpense[]
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
  base: {
    potTotal: number | undefined
    currency: string
    entryFee?: number
    /** From `league_expenses`, which is its own table rather than a prize rule kind. */
    expenses?: LeagueExpense[]
  },
): LeagueSettings {
  const gwWinner = rows.find((r) => r.kind === 'gw_winner_fixed')
  const bestGw = rows.find((r) => r.kind === 'season_best_gw_fixed')

  const rankPercentages = rows
    .filter((r) => r.kind === 'season_rank_pct')
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
    .map((r) => Number(r.value))

  return {
    ...base,
    expenses: base.expenses ?? [],
    gwWinnerAmount: Number(gwWinner?.value ?? DEFAULT_SETTINGS.gwWinnerAmount),
    seasonBestGwAmount: Number(bestGw?.value ?? DEFAULT_SETTINGS.seasonBestGwAmount),
    rankPercentages:
      rankPercentages.length > 0 ? rankPercentages : [...DEFAULT_SETTINGS.rankPercentages],
  }
}

/**
 * Curated splits for common numbers of paid places. Each totals exactly 100.
 *
 * Hand-picked rather than generated: these are the shapes leagues actually use, and a
 * formula produces defensible-looking but odd numbers (20.4%, 13.7%) that owners then
 * have to tidy by hand.
 */
const CURATED_SPLITS: Record<number, number[]> = {
  1: [100],
  2: [65, 35],
  3: [50, 30, 20],
  4: [45, 27, 18, 10],
  5: [42, 26, 16, 10, 6],
  6: [40, 25, 15, 10, 6, 4],
  7: [38, 24, 15, 9, 6, 5, 3],
  8: [36, 23, 14, 9, 6, 5, 4, 3],
}

/**
 * A sensible descending split for N paid places, totalling exactly 100.
 *
 * Beyond the curated sizes it decays geometrically, with the remainder folded into last
 * place so the total is exact rather than 99.97.
 */
export function suggestPercentages(places: number): number[] {
  if (places <= 0) return []
  if (CURATED_SPLITS[places]) return [...CURATED_SPLITS[places]]

  const weights = Array.from({ length: places }, (_, i) => 0.68 ** i)
  const totalWeight = weights.reduce((a, b) => a + b, 0)

  // Work in hundredths of a percent so the total can be made exact.
  const bp = weights.map((w) => Math.round((w / totalWeight) * 10_000))
  const drift = 10_000 - bp.reduce((a, b) => a + b, 0)
  bp[bp.length - 1] += drift

  return bp.map((v) => Math.round(v) / 100)
}

export function toPrizeConfig(settings: LeagueSettings, gameweekCount: number): PrizeConfig {
  return {
    potTotal: settings.potTotal,
    gwWinnerAmount: settings.gwWinnerAmount,
    seasonBestGwAmount: settings.seasonBestGwAmount,
    rankPercentages: settings.rankPercentages,
    expenses: settings.expenses,
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
    potSet: pot.potSet,
    potCents: pot.potCents,
    gwWinnerCents: Math.round(settings.gwWinnerAmount * 100),
    seasonBestGwCents: Math.round(settings.seasonBestGwAmount * 100),
    // Carried itemised, not as a total: the digest names each cost, which is the whole
    // reason expenses are a list rather than one number.
    expenses: settings.expenses.map((e) => ({ label: e.label, amountCents: toCents(e.amount) })),
    rankPrizeCents: rankPrizePool(pot.remainderCents, settings.rankPercentages),
  }
}
