import { splitEvenly, toCents, type Cents } from './money'

/** A cost paid out of the pot before any prize, e.g. trophy engraving. */
export interface Expense {
  /** Member-facing: the digest prints this. */
  label: string
  amount: string | number
}

export interface PrizeConfig {
  /** `undefined` when the league has not set one. See `LeagueSettings.potTotal`. */
  potTotal: string | number | undefined
  /** Fixed amount to each gameweek's winner. */
  gwWinnerAmount: string | number
  /** Fixed amount for the season's single highest gameweek score. */
  seasonBestGwAmount: string | number
  /** League costs, deducted off the top alongside the fixed prizes. */
  expenses: Expense[]
  /** Percentages by final rank, index 0 = 1st place. Length IS the number of paid places. */
  rankPercentages: number[]
  /** From events.length — never hardcode 38, a shortened season would over-commit. */
  gameweekCount: number
}

export interface PotBreakdown {
  /**
   * Whether the league has actually set a pot.
   *
   * Carried alongside the figures rather than encoded as a null `potCents`, so callers
   * that only want to do arithmetic keep working and callers that show the number to
   * somebody are made to decide what "unknown" looks like.
   */
  potSet: boolean
  /** Zero when unset — check `potSet` before showing this to anyone. */
  potCents: Cents
  /** Fixed commitments, which come off the top. */
  committedFixedCents: Cents
  /** League costs, which come off the top too. Zero when there are none. */
  expensesCents: Cents
  /** What the rank percentages actually apply to. */
  remainderCents: Cents
}

/** Total of a league's expenses. Kept separate so callers can show the deduction. */
export function expensesTotal(expenses: Expense[]): Cents {
  return expenses.reduce((sum, e) => sum + toCents(e.amount), 0)
}

/**
 * Fixed prizes and league expenses come off the top; percentages apply to what's left.
 *
 * Applying the percentages to the whole pot instead over-commits it, and the shortfall
 * only surfaces at season end when the treasurer pays out. Expenses are the same trap
 * one step further along: $100 of engraving left out of this subtraction is $100 of
 * prizes the league has promised and cannot pay.
 */
export function computePot(config: PrizeConfig): PotBreakdown {
  // Narrowed by the condition rather than asserted, so a future change to the type is
  // caught here instead of being waved through by a cast.
  const potSet = config.potTotal !== undefined && config.potTotal !== ''
  const potCents =
    config.potTotal !== undefined && config.potTotal !== '' ? toCents(config.potTotal) : 0
  const committedFixedCents =
    toCents(config.gwWinnerAmount) * config.gameweekCount + toCents(config.seasonBestGwAmount)
  const expensesCents = expensesTotal(config.expenses)

  return {
    potSet,
    potCents,
    committedFixedCents,
    expensesCents,
    // Negative when unset, which is why `potSet` exists: a remainder of minus the fixed
    // commitments is arithmetically true and meaningless to show.
    remainderCents: potCents - committedFixedCents - expensesCents,
  }
}

export type ValidationError =
  | { code: 'fixed-exceeds-pot'; committedCents: Cents; expensesCents: Cents; potCents: Cents }
  | { code: 'expense-missing-label'; index: number }
  | { code: 'non-positive-expense'; label: string }
  | { code: 'percentages-not-100'; sum: number }
  | { code: 'no-paid-places' }
  | { code: 'non-positive-percentage'; rank: number }
  | { code: 'more-places-than-managers'; places: number; managers: number }

/**
 * Setup-time validation. These belong in the UI as the owner types, not only in tests —
 * every one of them silently misallocates money rather than throwing.
 */
export function validatePrizeConfig(config: PrizeConfig, managerCount?: number): ValidationError[] {
  const errors: ValidationError[] = []
  const { potSet, potCents, committedFixedCents, expensesCents } = computePot(config)

  /**
   * Only meaningful once there is a pot to exceed.
   *
   * Without this guard a league nobody has configured yet greets its new owner with
   * "fixed prizes cost more than the pot holds" and a disabled Save button — an error
   * about a decision they have not made, blocking them from making it.
   */
  if (potSet && committedFixedCents + expensesCents > potCents) {
    errors.push({
      code: 'fixed-exceeds-pot',
      committedCents: committedFixedCents,
      expensesCents,
      potCents,
    })
  }

  config.expenses.forEach((expense, i) => {
    // The label is printed to the league, so an unlabelled deduction is money the digest
    // subtracts without saying what for.
    if (expense.label.trim() === '') errors.push({ code: 'expense-missing-label', index: i })
    if (toCents(expense.amount) <= 0) {
      errors.push({ code: 'non-positive-expense', label: expense.label.trim() })
    }
  })

  const places = config.rankPercentages.length
  if (places === 0) errors.push({ code: 'no-paid-places' })

  config.rankPercentages.forEach((pct, i) => {
    if (pct <= 0) errors.push({ code: 'non-positive-percentage', rank: i + 1 })
  })

  // Compare in basis points so 40 + 25 + 15 + 10 + 6 + 4 doesn't fail on float error.
  const sumBp = config.rankPercentages.reduce((a, p) => a + Math.round(p * 100), 0)
  if (places > 0 && sumBp !== 10_000) {
    errors.push({ code: 'percentages-not-100', sum: sumBp / 100 })
  }

  if (managerCount !== undefined && places > managerCount) {
    errors.push({ code: 'more-places-than-managers', places, managers: managerCount })
  }

  return errors
}

/**
 * Amount attached to each paid position, index 0 = 1st place.
 *
 * The last place is derived as `remainder - sum(others)` so rounding can never make the
 * payouts miss the pot.
 */
export function rankPrizePool(remainderCents: Cents, rankPercentages: number[]): Cents[] {
  if (rankPercentages.length === 0) return []

  const prizes = rankPercentages
    .slice(0, -1)
    .map((pct) => Math.round((remainderCents * Math.round(pct * 100)) / 10_000))

  const allocated = prizes.reduce((a, b) => a + b, 0)
  prizes.push(remainderCents - allocated)
  return prizes
}

export interface RankedManager {
  entry: number
  /** Tied managers share a rank. Detect ties on THIS, never on rankSort. */
  rank: number
  /** Arbitrary stable order; used only to place indivisible remainder cents. */
  rankSort: number
}

export interface Allocation {
  entry: number
  rank: number
  amountCents: Cents
}

/**
 * Allocates the season-end rank prizes, handling ties.
 *
 * N managers tied at rank R occupy positions R…R+N−1. Pool the prizes attached to those
 * positions and split equally. Unpaid positions contribute zero, so a tie at the last
 * paid place naturally shares just that one prize — and the pot is conserved by
 * construction, which paying each tied manager in full is not.
 */
export function allocateRankPrizes(
  managers: RankedManager[],
  prizePool: Cents[],
): Allocation[] {
  const allocations: Allocation[] = []

  // Group by rank — ties share one.
  const byRank = new Map<number, RankedManager[]>()
  for (const m of managers) {
    const group = byRank.get(m.rank)
    if (group) group.push(m)
    else byRank.set(m.rank, [m])
  }

  for (const [rank, group] of byRank) {
    // Positions rank … rank + group.length - 1, 1-indexed into the prize pool.
    const pooled = group.reduce((sum, _, i) => sum + (prizePool[rank - 1 + i] ?? 0), 0)
    if (pooled === 0) continue

    const ordered = [...group].sort((a, b) => a.rankSort - b.rankSort)
    const shares = splitEvenly(pooled, ordered.length)

    ordered.forEach((m, i) => {
      allocations.push({ entry: m.entry, rank, amountCents: shares[i] })
    })
  }

  return allocations
}

/**
 * Gameweek winners: the managers on the highest `event_total`.
 *
 * Returns all of them — ties are common here, and paying each tied winner in full
 * quietly overdraws the pot, so the prize is pooled and split.
 */
export function allocateGameweekPrize(
  scores: { entry: number; eventTotal: number | null; rankSort: number }[],
  gwWinnerAmount: string | number,
): Allocation[] {
  const scored = scores.filter((s) => s.eventTotal !== null)
  if (scored.length === 0) return []

  const top = Math.max(...scored.map((s) => s.eventTotal!))
  const winners = scored.filter((s) => s.eventTotal === top).sort((a, b) => a.rankSort - b.rankSort)

  const shares = splitEvenly(toCents(gwWinnerAmount), winners.length)
  return winners.map((w, i) => ({ entry: w.entry, rank: 1, amountCents: shares[i] }))
}
