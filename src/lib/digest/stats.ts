import { leagueAverage, type RosterManager } from '../fpl/roster'

/**
 * The computed stats for one gameweek.
 *
 * This is what gets stored in `digests` — structured, not rendered. Blocks are toggled
 * per message, so rendering happens at send time from this payload.
 */
export interface DigestStats {
  gameweek: number
  /** Sorted by rank; pending managers (no scores yet) last. */
  standings: StandingRow[]
  /** All managers on the top score — ties are common. Empty before anyone scores. */
  gwWinners: StandingRow[]
  /** Mean of event_total across scored managers. NOT the global average_entry_score. */
  leagueAverage: number | null
  biggestRiser: Movement | null
  biggestFaller: Movement | null
  /** Managers who have joined but have no scores yet. Pre-season this is everyone. */
  pendingCount: number
}

export interface StandingRow {
  entry: number
  entryName: string
  playerName: string
  rank: number | null
  total: number | null
  eventTotal: number | null
  /** Positive = moved up. Null when there's no previous gameweek to compare against. */
  movement: number | null
  pending: boolean
}

export interface Movement {
  entry: number
  playerName: string
  entryName: string
  places: number
}

function toRow(m: RosterManager): StandingRow {
  return {
    entry: m.entry,
    entryName: m.entryName,
    playerName: m.playerName,
    rank: m.rank,
    total: m.total,
    eventTotal: m.eventTotal,
    // last_rank is null after GW1 (FPL reports 0), so movement is unknowable, not zero.
    movement: m.rank !== null && m.lastRank !== null ? m.lastRank - m.rank : null,
    pending: m.pending,
  }
}

export function computeDigestStats(roster: RosterManager[], gameweek: number): DigestStats {
  const rows = roster.map(toRow).sort((a, b) => {
    if (a.rank === null && b.rank === null) return a.playerName.localeCompare(b.playerName)
    if (a.rank === null) return 1
    if (b.rank === null) return -1
    return a.rank - b.rank
  })

  const scored = rows.filter((r) => r.eventTotal !== null)
  const topScore = scored.length > 0 ? Math.max(...scored.map((r) => r.eventTotal!)) : null
  const gwWinners = topScore === null ? [] : scored.filter((r) => r.eventTotal === topScore)

  const moved = rows
    .filter((r) => r.movement !== null && r.movement !== 0)
    .map((r) => ({
      entry: r.entry,
      playerName: r.playerName,
      entryName: r.entryName,
      places: r.movement!,
    }))

  const risers = moved.filter((m) => m.places > 0).sort((a, b) => b.places - a.places)
  const fallers = moved.filter((m) => m.places < 0).sort((a, b) => a.places - b.places)

  return {
    gameweek,
    standings: rows,
    gwWinners,
    leagueAverage: leagueAverage(roster),
    biggestRiser: risers[0] ?? null,
    biggestFaller: fallers[0] ?? null,
    pendingCount: rows.filter((r) => r.pending).length,
  }
}
