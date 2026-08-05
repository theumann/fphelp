/**
 * FPL API response shapes.
 *
 * ✅ = confirmed against live calls. ⚠️ = taken from a typed community client and
 * NOT yet observed, because the collection is empty pre-season. See
 * docs/GW1-VERIFICATION.md — re-check these after GW1 is scored (21 Aug 2026).
 */

/** ✅ Confirmed live 2026-08-03. */
export interface FplEvent {
  id: number
  name: string
  deadline_time: string
  /** Flips BEFORE bonus points are applied — not safe to send on. */
  finished: boolean
  data_checked: boolean
  /** GLOBAL FPL average, not the league's. Never use this as the league average. */
  average_entry_score: number
  is_current: boolean
  is_next: boolean
  is_previous: boolean
  highest_scoring_entry: number | null
  ranked_count: number
}

/** ✅ Confirmed live: top-level keys. */
export interface BootstrapStatic {
  events: FplEvent[]
}

/** ⚠️ `status` is empty outside a live gameweek, so element fields are unobserved. */
export interface EventStatusDay {
  date: string
  event: number
  bonus_added: boolean
  points: string
}

/**
 * ⚠️ Envelope confirmed (`{status: [], leagues: ""}` pre-season). The `leagues`
 * value `"Updated"` is NOT yet observed — the send trigger depends on it.
 */
export interface EventStatus {
  status: EventStatusDay[]
  leagues: string
}

/** ⚠️ Element fields unobserved — standings.results is empty pre-season. */
export interface ClassicLeagueEntry {
  id: number
  entry: number
  entry_name: string
  player_name: string
  rank: number
  /** Previous gameweek's rank; 0 when there is no prior gameweek. */
  last_rank: number
  /** Arbitrary stable total order. NEVER use this to detect ties — use `rank`. */
  rank_sort: number
  total: number
  event_total: number
}

/**
 * ✅ Confirmed live. Note this shape DIFFERS from ClassicLeagueEntry: split name
 * fields and no score fields at all.
 */
export interface NewLeagueEntry {
  entry: number
  entry_name: string
  joined_time: string
  player_first_name: string
  player_last_name: string
}

/** ✅ Confirmed live — both standings and new_entries carry this envelope. */
export interface Paged<T> {
  has_next: boolean
  page: number
  results: T[]
}

/** ✅ Confirmed live 2026-08-05 against league 9999999. */
export interface LeagueInfo {
  id: number
  name: string
  created: string
  closed: boolean
  start_event: number
  /** 'x' = private/invitational. */
  league_type: string
  /** 'c' = classic. */
  scoring: string
  admin_entry: number | null
}

export interface ClassicLeagueStandings {
  league: LeagueInfo
  standings: Paged<ClassicLeagueEntry>
  /** An OBJECT with a pagination envelope, not a bare array. */
  new_entries: Paged<NewLeagueEntry>
  last_updated_data: string | null
}

/** ⚠️ `current[]` element fields unobserved — empty pre-season. */
export interface EntryHistoryEvent {
  event: number
  points: number
  total_points: number
  rank: number | null
  overall_rank: number | null
  points_on_bench: number
  event_transfers_cost: number
}

/** ✅ Confirmed live: `past[]` fields and the top-level keys. */
export interface EntryHistory {
  current: EntryHistoryEvent[]
  past: { season_name: string; total_points: number; rank: number; rank_percentage?: number }[]
  chips: unknown[]
}
