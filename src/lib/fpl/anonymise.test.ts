import { describe, expect, it } from 'vitest'

import { anonymiseBootstrap, anonymiseHistory, anonymiseStandings } from './anonymise'
import { FAKE_MANAGER_NAMES, FAKE_TEAM_NAMES, SYNTHETIC_LEAGUE_ID } from '../fake-names'

/**
 * The anonymiser is what stands between a re-recorded payload and seventeen real people's
 * names in a public repository, and it runs unattended inside `npm run fpl:record`. So the
 * properties it has to hold are asserted here rather than checked by eye after a recording.
 *
 * The invented input below deliberately uses obviously-fake "real" values: the point is that
 * *nothing from the input survives*, which is testable without putting a real name in a file.
 */

const realish = () => ({
  league: {
    id: 12345,
    name: 'A Real League Name',
    created: '2020-01-02T03:04:05.678901Z',
    admin_entry: 222,
    code_privacy: 'p',
    cup_league: null,
  },
  standings: {
    has_next: false,
    page: 1,
    results: [
      {
        entry: 111,
        entry_name: 'Real Team One',
        player_name: 'Real Person One',
        club_badge_src:
          'https://fantasy.premierleague.com/gcs/plfpl-production-adobe-approved/plfpl-production/111/abcdef12-3456-7890-abcd-ef1234567890.png',
        rank: 1,
        last_rank: 0,
        total: 100,
        event_total: 50,
      },
      {
        entry: 222,
        entry_name: 'Real Team Two',
        player_name: 'Real Person Two',
        club_badge_src: null,
        rank: 2,
        last_rank: 0,
        total: 90,
        event_total: 40,
      },
    ],
  },
  new_entries: {
    has_next: false,
    page: 1,
    results: [
      {
        entry: 333,
        entry_name: 'Real Team Three',
        player_first_name: 'Real',
        player_last_name: 'Person Three',
        joined_time: '2026-08-19T09:00:00Z',
      },
    ],
  },
  last_updated_data: '2026-08-25T09:00:00Z',
})

describe('anonymiseStandings', () => {
  it('leaves no input identifier anywhere in the output', () => {
    const { payload } = anonymiseStandings(realish())
    const text = JSON.stringify(payload)

    for (const secret of [
      'Real Person One',
      'Real Person Two',
      'Real Person Three',
      'Real Team One',
      'Real Team Two',
      'Real Team Three',
      'A Real League Name',
      'abcdef12-3456-7890-abcd-ef1234567890',
      '12345',
      '111',
      '222',
      '333',
    ]) {
      expect(text).not.toContain(secret)
    }
  })

  it('gives every manager a distinct invented name', () => {
    const { payload } = anonymiseStandings(realish()) as {
      payload: { standings: { results: { player_name: string; entry_name: string }[] } }
    }
    const rows = payload.standings.results

    expect(new Set(rows.map((r) => r.player_name)).size).toBe(rows.length)
    expect(new Set(rows.map((r) => r.entry_name)).size).toBe(rows.length)
    for (const r of rows) {
      expect(FAKE_MANAGER_NAMES).toContain(r.player_name)
      expect(FAKE_TEAM_NAMES).toContain(r.entry_name)
    }
  })

  /**
   * The re-record diff is the change detector's whole value. If a given manager mapped to a
   * different invented name each run, every future diff would show every row changing and a
   * real shape change would be lost in it.
   */
  it('is deterministic across runs', () => {
    expect(JSON.stringify(anonymiseStandings(realish()).payload)).toBe(
      JSON.stringify(anonymiseStandings(realish()).payload),
    )
  })

  it('keeps the admin pointing at a manager who is actually in the league', () => {
    const { payload } = anonymiseStandings(realish()) as {
      payload: { league: { admin_entry: number }; standings: { results: { entry: number }[] } }
    }
    const entries = payload.standings.results.map((r) => r.entry)

    expect(entries).toContain(payload.league.admin_entry)
    expect(payload.league.admin_entry).not.toBe(222)
  })

  /** Shape is the thing a recording exists to prove, so substitution must not alter it. */
  it('preserves the envelope, key order and the string/null badge distinction', () => {
    const before = realish()
    const { payload } = anonymiseStandings(realish()) as {
      payload: {
        league: Record<string, unknown>
        standings: { has_next: boolean; page: number; results: Record<string, unknown>[] }
      }
    }

    expect(Object.keys(payload.league)).toEqual(Object.keys(before.league))
    expect(Object.keys(payload.standings.results[0]!)).toEqual(
      Object.keys(before.standings.results[0]!),
    )
    expect(payload.standings).toMatchObject({ has_next: false, page: 1 })
    expect(payload.league.id).toBe(SYNTHETIC_LEAGUE_ID)
    expect(typeof payload.standings.results[0]!.club_badge_src).toBe('string')
    expect(payload.standings.results[1]!.club_badge_src).toBeNull()
  })

  it('splits an invented name back into the first/last fields new entries use', () => {
    const { payload } = anonymiseStandings(realish()) as {
      payload: {
        new_entries: { results: { player_first_name: string; player_last_name: string }[] }
      }
    }
    const joiner = payload.new_entries.results[0]!

    expect(joiner.player_first_name).not.toBe('Real')
    expect(joiner.player_last_name).not.toBe('Person Three')
    expect(FAKE_MANAGER_NAMES).toContain(
      `${joiner.player_first_name} ${joiner.player_last_name}`.trim(),
    )
  })
})

describe('anonymiseBootstrap', () => {
  it('replaces the global top scorer without changing the field type', () => {
    const doc = anonymiseBootstrap({
      events: [{ highest_scoring_entry: 4_567_890 }, { highest_scoring_entry: null }],
    }) as { events: { highest_scoring_entry: number | null }[] }

    expect(doc.events[0]!.highest_scoring_entry).not.toBe(4_567_890)
    expect(typeof doc.events[0]!.highest_scoring_entry).toBe('number')
    expect(doc.events[1]!.highest_scoring_entry).toBeNull()
  })
})

describe('anonymiseHistory', () => {
  it('perturbs the rank fingerprint but keeps types, lengths and string percentages', () => {
    const doc = anonymiseHistory({
      current: [{ event: 1, points: 79, rank: 120623, rank_sort: 127399, overall_rank: 120623, overall_rank_percentage: '1' }],
      past: [{ season_name: '2019/20', total_points: 2053, rank: 1334978, rank_percentage: '18' }],
    }) as {
      current: Record<string, unknown>[]
      past: Record<string, unknown>[]
    }

    expect(doc.current).toHaveLength(1)
    expect(doc.past).toHaveLength(1)
    expect(doc.current[0]!.rank).not.toBe(120623)
    expect(doc.past[0]!.rank).not.toBe(1334978)
    expect(typeof doc.current[0]!.rank).toBe('number')
    // The strings are a real API finding the recording exists to pin; they must stay strings.
    expect(typeof doc.current[0]!.overall_rank_percentage).toBe('string')
    expect(typeof doc.past[0]!.rank_percentage).toBe('string')
    // Season labels are not identifying and must survive, or the payload stops making sense.
    expect(doc.past[0]!.season_name).toBe('2019/20')
  })
})
