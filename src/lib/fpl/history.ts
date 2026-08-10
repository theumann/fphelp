import type { EntryHistory } from './types'

/** One manager's result for one gameweek, ready to persist. */
export interface HistoryRow {
  entry: number
  gameweek: number
  points: number
  totalPoints: number
  rank: number | null
  overallRank: number | null
  pointsOnBench: number | null
  eventTransfersCost: number | null
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Absent or malformed optional fields are stored as null, never coerced to a number. */
const optional = (v: unknown): number | null => (isNumber(v) ? v : null)

/**
 * Every gameweek `current[]` reports for one manager.
 *
 * Returns the whole array rather than just the latest gameweek, for two reasons. It
 * makes a missed run self-healing — the next capture backfills whatever was skipped —
 * and if `current[]` turns out to carry the full season (see docs/GW1-VERIFICATION.md
 * item 1, unanswerable until GW1 is scored) then a single run captures everything and
 * the "must snapshot from GW1" ordering constraint quietly disappears. Both behaviours
 * come free from not assuming which gameweeks are present.
 *
 * ⚠️ These element fields are unobserved pre-season, so this validates rather than
 * trusts. `points` and `total_points` are NOT NULL in the schema, and a row missing
 * either is dropped instead of defaulted: a stored zero is indistinguishable from a
 * real score of zero, and this project's characteristic bug is silently wrong output,
 * not a crash. Dropping is recoverable — the next run re-reads the same gameweek.
 */
export function historyRows(entry: number, history: EntryHistory): HistoryRow[] {
  if (!Array.isArray(history?.current)) return []

  const rows: HistoryRow[] = []

  for (const e of history.current) {
    if (!isNumber(e?.event) || !isNumber(e?.points) || !isNumber(e?.total_points)) continue

    rows.push({
      entry,
      gameweek: e.event,
      points: e.points,
      totalPoints: e.total_points,
      rank: optional(e.rank),
      overallRank: optional(e.overall_rank),
      pointsOnBench: optional(e.points_on_bench),
      eventTransfersCost: optional(e.event_transfers_cost),
    })
  }

  return rows
}

/** Gameweeks dropped as malformed — surfaced by the job so silent data loss is visible. */
export function droppedGameweeks(history: EntryHistory): number[] {
  if (!Array.isArray(history?.current)) return []

  return history.current
    .filter((e) => !isNumber(e?.points) || !isNumber(e?.total_points))
    .map((e) => (isNumber(e?.event) ? e.event : -1))
}
