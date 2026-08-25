import { describe, expect, it } from 'vitest'

import bootstrapJson from './recorded/bootstrap-static.json'
import entryHistoryJson from './recorded/entry-history.json'
import eventStatusJson from './recorded/event-status.json'
import standingsJson from './recorded/league-standings.json'

import { computeDigestStats } from '../digest/stats'
import { isGameweekReady, lastFinishedGameweek, liveGameweek, sendGate } from './gameweek'
import { droppedGameweeks, historyRows } from './history'
import { buildRoster, leagueAverage } from './roster'
import type { BootstrapStatic, ClassicLeagueStandings, EntryHistory, EventStatus } from './types'

/**
 * The change detector.
 *
 * These payloads are the real FPL API's bytes, recorded by `npm run fpl:record` on
 * 2026-08-25 with GW1 settled — `bonus_added` true on all four match days and
 * `leagues: "Updated"`. The API is unofficial and unversioned and rewrites itself between
 * seasons without warning, so this suite exists to fail loudly when that happens, at the
 * cost of one `npm test` rather than one wrong message to a league of eighteen.
 *
 * What makes it different from `fixtures.ts`: that file is hand-authored, so it can only
 * ever prove the app renders what it is given. This one proves the app can read what FPL
 * actually sends. Both are needed, and neither substitutes for the other — see the note on
 * pagination at the foot of this file.
 *
 * When a season rolls over and these fail, re-record and read the diff before adapting the
 * parsers. The diff *is* the finding.
 */

const bootstrap = bootstrapJson as BootstrapStatic
const status = eventStatusJson as EventStatus
const standings = standingsJson as unknown as ClassicLeagueStandings
const history = entryHistoryJson as unknown as EntryHistory

describe('recorded bootstrap-static', () => {
  it('carries a full season of events', () => {
    expect(bootstrap.events).toHaveLength(38)
  })

  it('has every field the app reads on each event', () => {
    for (const e of bootstrap.events) {
      expect(e).toMatchObject({
        id: expect.any(Number),
        name: expect.any(String),
        deadline_time: expect.any(String),
        finished: expect.any(Boolean),
        data_checked: expect.any(Boolean),
        average_entry_score: expect.any(Number),
        is_current: expect.any(Boolean),
      })
    }
  })

  it('was recorded with GW1 finished and checked', () => {
    expect(lastFinishedGameweek(bootstrap)).toBe(1)
    expect(liveGameweek(bootstrap)).toBeNull()
  })
})

describe('recorded event-status', () => {
  /**
   * The whole point of recording a *settled* gameweek. A provisional capture would assert
   * the gate stays shut, which it does for a dozen reasons, and would never exercise the
   * one path that ends in a message being sent.
   */
  it('opens the send gate', () => {
    expect(isGameweekReady(bootstrap, status, 1)).toEqual({ ready: true, reason: 'ready' })
    expect(sendGate(bootstrap, status)).toEqual({ gameweek: 1, statsReady: true, reason: 'ready' })
  })

  it('is the settled shape: one row per match day, all bonus applied', () => {
    expect(status.status.length).toBeGreaterThan(0)
    expect(status.status.every((d) => d.bonus_added)).toBe(true)
    expect(status.leagues).toBe('Updated')
  })

  /** `""` → `"p"` → `"r"`. Nothing reads it, but it tracks the same transition. */
  it('marks every settled day as final', () => {
    expect(status.status.map((d) => d.points)).toEqual(status.status.map(() => 'r'))
  })
})

describe('recorded league standings', () => {
  it('has every field the app reads on each entry', () => {
    for (const r of standings.standings.results) {
      expect(r).toMatchObject({
        entry: expect.any(Number),
        entry_name: expect.any(String),
        player_name: expect.any(String),
        rank: expect.any(Number),
        last_rank: expect.any(Number),
        rank_sort: expect.any(Number),
        total: expect.any(Number),
        event_total: expect.any(Number),
      })
    }
  })

  /**
   * The community-typed shape declared an `id` the API has never sent. Asserting its
   * absence keeps that correction from being quietly undone by a future copy-paste.
   */
  it('sends no `id`, and does send `club_badge_src`', () => {
    const first = standings.standings.results[0]
    expect(first).toBeDefined()
    expect(first).not.toHaveProperty('id')
    expect(first).toHaveProperty('club_badge_src')
  })

  it('carries the paginated envelope on both collections', () => {
    for (const collection of [standings.standings, standings.new_entries]) {
      expect(collection).toMatchObject({ has_next: expect.any(Boolean), page: expect.any(Number) })
      expect(Array.isArray(collection.results)).toBe(true)
    }
  })

  it('builds a full roster with everyone scored', () => {
    const roster = buildRoster(standings)
    expect(roster).toHaveLength(standings.standings.results.length)
    expect(roster.filter((r) => r.pending)).toHaveLength(0)
  })

  /**
   * The gotcha this project is most likely to regress into, asserted against real numbers:
   * the league average is the mean of `event_total` here, and FPL's global average is a
   * different number sitting right next to it in another payload.
   */
  it('computes a league average that is not FPL global', () => {
    const roster = buildRoster(standings)
    const ours = leagueAverage(roster)
    const global = bootstrap.events.find((e) => e.id === 1)?.average_entry_score

    expect(ours).toBeGreaterThan(0)
    expect(ours).not.toBe(global)
  })

  /** GW1 has no prior gameweek, so every `last_rank` is 0 and nothing may read it as a climb. */
  it('reports no rank movement when there is no previous rank', () => {
    const roster = buildRoster(standings)
    expect(standings.standings.results.every((r) => r.last_rank === 0)).toBe(true)

    const stats = computeDigestStats(roster, 1)
    expect(stats.biggestRiser).toBeNull()
    expect(stats.biggestFaller).toBeNull()
    expect(stats.gwWinners.length).toBeGreaterThan(0)
  })
})

describe('recorded entry history', () => {
  it('maps every gameweek without dropping any', () => {
    const entry = standings.standings.results[0]!.entry
    const rows = historyRows(entry, history)

    expect(rows.length).toBe(history.current.length)
    expect(droppedGameweeks(history)).toEqual([])
    expect(rows[0]).toMatchObject({
      entry,
      gameweek: 1,
      points: expect.any(Number),
      totalPoints: expect.any(Number),
    })
  })

  it('populates past seasons for a returning manager', () => {
    expect(history.past.length).toBeGreaterThan(0)
    expect(history.past[0]).toMatchObject({
      season_name: expect.any(String),
      total_points: expect.any(Number),
      rank: expect.any(Number),
    })
  })

  /**
   * `rank_percentage` and `overall_rank_percentage` arrive as STRINGS (`"18"`, `"1"`),
   * not numbers — found by recording, having been typed as `number` since the shape was
   * copied from a community client. Nothing reads either field, so nothing was broken;
   * this pins the real type so a future reader does not do arithmetic on it.
   */
  it('sends percentage fields as strings', () => {
    expect(typeof history.past[0]!.rank_percentage).toBe('string')
    expect(typeof (history.current[0] as { overall_rank_percentage?: unknown })
      .overall_rank_percentage).toBe('string')
  })
})

/**
 * What these payloads deliberately do NOT cover.
 *
 * The reference league is 17 managers and fits in one page, so `has_next` is false in every
 * recorded collection and the multi-page assembly in `leagueStandingsAll` is untouched here.
 * That case belongs to the hand-authored fixture, which paginates at 10 — and it stays
 * hand-authored until the league outgrows a page, which may be never. Recording is not a
 * replacement for it; the two cover different halves.
 */
describe('recorded coverage limits', () => {
  it('is single-page, so pagination is covered elsewhere', () => {
    expect(standings.standings.has_next).toBe(false)
    expect(standings.new_entries.has_next).toBe(false)
  })
})
