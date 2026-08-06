import { toCents } from './digest/money'
import { computePot, rankPrizePool } from './digest/prizes'
import type { PrizeSummary } from './render/blocks'

/**
 * Phase 0: one league, hardcoded. This moves into `leagues` / `prize_rules` once setup
 * and auth exist — it is deliberately the shape those tables will hold.
 */
export const REFERENCE_LEAGUE = {
  /** The numeric FPL league ID, not the invite code (`1xrliv` is the join code). */
  fplLeagueId: 9999999,
  currency: 'USD',
  potTotal: 1800,
  gwWinnerAmount: 15,
  seasonBestGwAmount: 100,
  rankPercentages: [40, 25, 15, 10, 6, 4],
} as const

export function prizeSummary(gameweekCount: number): PrizeSummary {
  const pot = computePot({
    potTotal: REFERENCE_LEAGUE.potTotal,
    gwWinnerAmount: REFERENCE_LEAGUE.gwWinnerAmount,
    seasonBestGwAmount: REFERENCE_LEAGUE.seasonBestGwAmount,
    rankPercentages: [...REFERENCE_LEAGUE.rankPercentages],
    gameweekCount,
  })

  return {
    currency: REFERENCE_LEAGUE.currency,
    potCents: pot.potCents,
    gwWinnerCents: toCents(REFERENCE_LEAGUE.gwWinnerAmount),
    seasonBestGwCents: toCents(REFERENCE_LEAGUE.seasonBestGwAmount),
    rankPrizeCents: rankPrizePool(pot.remainderCents, [...REFERENCE_LEAGUE.rankPercentages]),
  }
}
