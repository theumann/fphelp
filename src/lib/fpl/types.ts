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

/**
 * ✅ Field names confirmed live 2026-08-21, 18:09Z — 40 minutes into GW1, the first time
 * `status` has ever been non-empty. One row per match day of the gameweek:
 *
 *     {"bonus_added":false,"date":"2026-08-21","event":1,"points":""}
 *
 * `points` is `""` before a day's matches and `"p"` once they are played — observed
 * 2026-08-21. Nothing reads it. `bonus_added` is what the send gate turns on, and it was
 * still `false` on a completed match day, which is the whole reason the gate exists:
 * scores land well before bonus does.
 */
export interface EventStatusDay {
  date: string
  event: number
  bonus_added: boolean
  points: string
}

/**
 * ✅ Envelope confirmed twice: `{status: [], leagues: ""}` pre-season, and a four-element
 * `status` during GW1.
 *
 * ⚠️ `leagues` has three known values and only two have been seen: `""` before a
 * gameweek, and `"Updating"` while one is being played (observed 2026-08-21, 23:29Z).
 * `"Updated"` is what opens the send gate and has **still never been observed** — it is
 * the last unverified thing the trigger depends on. Re-check once GW1 settles.
 *
 * Note what `"Updating"` proves: the field is not a two-state flag. Testing it for
 * anything other than equality with `"Updated"` — truthiness, say — would have opened the
 * gate mid-gameweek.
 */
export interface EventStatus {
  status: EventStatusDay[]
  leagues: string
}

/**
 * ✅ Confirmed live 2026-08-21, once GW1 had scored and the league moved out of
 * `new_entries`. The community-typed shape this was copied from was wrong in two ways:
 *
 * - it declared an `id` that the API does not send. Nothing read it, so nothing broke —
 *   but a required field that is always `undefined` is a trap left lying about;
 * - it omitted `club_badge_src`, which the API does send.
 */
export interface ClassicLeagueEntry {
  entry: number
  entry_name: string
  player_name: string
  rank: number
  /**
   * Previous gameweek's rank. `0` when there is no prior gameweek — observed on every
   * manager after GW1, so rank movement must treat `0` as "no previous rank" and not as
   * a climb from position zero.
   */
  last_rank: number
  /** Arbitrary stable total order. NEVER use this to detect ties — use `rank`. */
  rank_sort: number
  total: number
  event_total: number
  /** Null for every manager in the reference league; unused. */
  club_badge_src: string | null
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
