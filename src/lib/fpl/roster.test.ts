import { describe, expect, it } from 'vitest'

import { buildRoster, leagueAverage } from './roster'
import type { ClassicLeagueEntry, ClassicLeagueStandings, NewLeagueEntry } from './types'

function standing(over: Partial<ClassicLeagueEntry> & { entry: number }): ClassicLeagueEntry {
  return {
    id: over.entry,
    entry_name: `Team ${over.entry}`,
    player_name: `Player ${over.entry}`,
    rank: 1,
    last_rank: 1,
    rank_sort: 1,
    total: 100,
    event_total: 50,
    ...over,
  }
}

function newEntry(over: Partial<NewLeagueEntry> & { entry: number }): NewLeagueEntry {
  return {
    entry_name: `Team ${over.entry}`,
    joined_time: '2026-07-23T17:32:06Z',
    player_first_name: 'New',
    player_last_name: `Joiner ${over.entry}`,
    ...over,
  }
}

const league = (
  standings: ClassicLeagueEntry[],
  newEntries: NewLeagueEntry[] = [],
): ClassicLeagueStandings => ({
  league: {
    id: 9999999,
    name: "The Sunday League",
    created: '2026-07-23T17:32:06Z',
    closed: false,
    start_event: 1,
    league_type: 'x',
    scoring: 'c',
    admin_entry: 8000002,
  },
  standings: { has_next: false, page: 1, results: standings },
  new_entries: { has_next: false, page: 1, results: newEntries },
  last_updated_data: null,
})

describe('buildRoster', () => {
  // The real pre-season state of league 9999999: everyone is a new entry and the
  // standings are empty. Building only from standings would render an empty league.
  it('includes managers who exist only in new_entries', () => {
    const roster = buildRoster(league([], [newEntry({ entry: 1 }), newEntry({ entry: 2 })]))

    expect(roster).toHaveLength(2)
    expect(roster.every((m) => m.pending)).toBe(true)
    expect(roster.every((m) => m.eventTotal === null)).toBe(true)
  })

  it('normalises the split name fields on new entries', () => {
    const [m] = buildRoster(
      league([], [newEntry({ entry: 7, player_first_name: 'Ada', player_last_name: 'Lovelace' })]),
    )
    expect(m.playerName).toBe('Ada Lovelace')
  })

  it('dedupes on entry, preferring the scored standings row', () => {
    const roster = buildRoster(league([standing({ entry: 5, total: 120 })], [newEntry({ entry: 5 })]))

    expect(roster).toHaveLength(1)
    expect(roster[0].pending).toBe(false)
    expect(roster[0].total).toBe(120)
  })

  // FPL reports last_rank 0 when there is no prior gameweek; treating that as a real
  // rank would show every manager rocketing up the table after GW1.
  it('treats last_rank 0 as no previous rank', () => {
    const [m] = buildRoster(league([standing({ entry: 1, last_rank: 0 })]))
    expect(m.lastRank).toBeNull()
  })
})

describe('leagueAverage', () => {
  it('averages event_total across scored managers', () => {
    const roster = buildRoster(
      league([
        standing({ entry: 1, event_total: 60 }),
        standing({ entry: 2, event_total: 40 }),
        standing({ entry: 3, event_total: 50 }),
      ]),
    )
    expect(leagueAverage(roster)).toBe(50)
  })

  it('ignores pending managers rather than counting them as zero', () => {
    const roster = buildRoster(
      league([standing({ entry: 1, event_total: 60 })], [newEntry({ entry: 2 })]),
    )
    expect(leagueAverage(roster)).toBe(60)
  })

  it('returns null when nobody has scored yet', () => {
    expect(leagueAverage(buildRoster(league([], [newEntry({ entry: 1 })])))).toBeNull()
  })
})
