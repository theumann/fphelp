/**
 * FPL API response shapes.
 *
 * ✅ = confirmed against live calls. Every shape here was re-checked against a settled
 * gameweek on 2026-08-25 and the payloads recorded to `./recorded/`, which
 * `recorded.test.ts` parses on every run — so these types now have a change detector
 * behind them rather than only a comment. See docs/GW1-VERIFICATION.md §2 and §4.
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
 * `points` is `""` before a day's matches, `"p"` while they are provisional, and `"r"` once
 * final (2026-08-25). Nothing reads it. `bonus_added` is what the send gate turns on, and
 * it stayed `false` for three days while scores were plainly visible — the whole reason the
 * gate exists. Bonus was worth ~0.8 points per manager when it landed.
 */
export interface EventStatusDay {
  date: string
  event: number
  bonus_added: boolean
  points: string
}

/**
 * ✅ Envelope confirmed: `{status: [], leagues: ""}` pre-season, a four-element `status`
 * during GW1, and the settled shape recorded 2026-08-25.
 *
 * `leagues` has three values, all now observed: `"Updating"` while a gameweek is
 * recalculating, `"Updated"` once it is final (2026-08-25 — this is what opens the send
 * gate), and `""` otherwise. `""` is **not** "before a gameweek": it was the value
 * throughout a live GW1 with every manager scored, so it means "not recalculating".
 *
 * The field is therefore not a two-state flag. Testing it for anything other than equality
 * with `"Updated"` — truthiness, say — would have opened the gate mid-gameweek; testing it
 * for emptiness would read a live gameweek as pre-season.
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

/** ✅ Confirmed live 2026-08-21, and recorded 2026-08-25. */
export interface EntryHistoryEvent {
  event: number
  points: number
  total_points: number
  rank: number | null
  overall_rank: number | null
  points_on_bench: number
  event_transfers_cost: number
}

/**
 * ✅ Confirmed live: `past[]` fields and the top-level keys.
 *
 * `rank_percentage` is a **string** (`"18"`, `"0.5"`), not a number — it was typed as a
 * number from the community client until the recorded payload showed otherwise. Nothing
 * reads it, so nothing was wrong; the same applies to `overall_rank_percentage` on
 * `current[]`. Do not do arithmetic on either without parsing first.
 */
export interface EntryHistory {
  current: EntryHistoryEvent[]
  past: { season_name: string; total_points: number; rank: number; rank_percentage?: string }[]
  chips: unknown[]
}
