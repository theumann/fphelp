import type { ClassicLeagueStandings } from './types'

/**
 * One manager, normalised from either collection.
 *
 * `standings.results` and `new_entries.results` have DIFFERENT shapes — split name
 * fields and no scores on new entries — so combining them is a normalisation, not a
 * union. Managers who have joined but aren't yet in standings have no scores at all;
 * pre-season that is the entire league (league 9999999: 0 standings, 14 new entries).
 */
export interface RosterManager {
  entry: number
  entryName: string
  playerName: string
  joinedTime?: string
  /** Null until the manager appears in standings — i.e. until a gameweek is scored. */
  rank: number | null
  lastRank: number | null
  total: number | null
  eventTotal: number | null
  /** True when this manager exists only in new_entries and has no scores yet. */
  pending: boolean
}

/**
 * Combines both collections into one roster.
 *
 * Deduplicates on `entry`, preferring the standings row: a manager can plausibly
 * appear in both during the gameweek that processes them, and the standings row is
 * the one carrying scores.
 */
export function buildRoster(data: ClassicLeagueStandings): RosterManager[] {
  const byEntry = new Map<number, RosterManager>()

  for (const r of data.standings.results) {
    byEntry.set(r.entry, {
      entry: r.entry,
      entryName: r.entry_name,
      playerName: r.player_name,
      rank: r.rank,
      // FPL reports 0 when there is no previous gameweek; that's "no data", not rank 0.
      lastRank: r.last_rank > 0 ? r.last_rank : null,
      total: r.total,
      eventTotal: r.event_total,
      pending: false,
    })
  }

  for (const n of data.new_entries.results) {
    if (byEntry.has(n.entry)) continue
    byEntry.set(n.entry, {
      entry: n.entry,
      entryName: n.entry_name,
      playerName: `${n.player_first_name} ${n.player_last_name}`.trim(),
      joinedTime: n.joined_time,
      rank: null,
      lastRank: null,
      total: null,
      eventTotal: null,
      pending: true,
    })
  }

  return [...byEntry.values()]
}

/**
 * League average for the gameweek — the mean of `event_total` across scored managers.
 *
 * NEVER substitute `events[].average_entry_score`: that is the GLOBAL FPL average and
 * using it is an invisible bug. Returns null when nobody has scored yet.
 */
export function leagueAverage(roster: RosterManager[]): number | null {
  const scores = roster.filter((m) => m.eventTotal !== null).map((m) => m.eventTotal!)
  if (scores.length === 0) return null
  return scores.reduce((a, b) => a + b, 0) / scores.length
}
