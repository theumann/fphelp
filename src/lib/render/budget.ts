/**
 * The WhatsApp payload travels in a URL, so length is measured *encoded*.
 *
 * Newlines and spaces each cost 3 characters (`%0A`, `%20`), and an accented letter in a
 * team name costs 6 (`%C3%AB`). Counting raw characters understates the real cost badly —
 * a standings table is mostly newlines and spaces.
 */

/** Target ceiling for a WhatsApp deep link, URL-encoded. */
export const DEFAULT_BUDGET = 1500

export function encodedLength(text: string): number {
  return encodeURIComponent(text).length
}

export interface BudgetState {
  used: number
  limit: number
  remaining: number
  overBudget: boolean
}

export function budgetFor(text: string, limit = DEFAULT_BUDGET): BudgetState {
  const used = encodedLength(text)
  return { used, limit, remaining: limit - used, overBudget: used > limit }
}
