/**
 * All prize arithmetic runs in integer cents. Floats lose pennies on percentage
 * splits, and a pot that doesn't reconcile is the one bug a treasurer will
 * definitely notice.
 */

export type Cents = number

export function toCents(amount: string | number): Cents {
  const n = typeof amount === 'string' ? Number(amount) : amount
  if (!Number.isFinite(n)) throw new Error(`Not a valid money amount: ${amount}`)
  return Math.round(n * 100)
}

export function formatCents(cents: Cents, currency = 'USD', locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100)
}

/**
 * Splits an amount evenly, conserving every cent.
 *
 * `count` recipients share `total`; the indivisible remainder is handed out one cent
 * at a time in the order given. Callers order by `rank_sort` — the only legitimate use
 * of that field, since it exists purely to impose a stable arbitrary order.
 */
export function splitEvenly(total: Cents, count: number): Cents[] {
  if (count <= 0) throw new Error('Cannot split between zero recipients')

  const base = Math.floor(total / count)
  const remainder = total - base * count
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0))
}
