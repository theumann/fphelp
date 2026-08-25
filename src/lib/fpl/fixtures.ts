import type {
  BootstrapStatic,
  ClassicLeagueEntry,
  ClassicLeagueStandings,
  EntryHistory,
  EventStatus,
  NewLeagueEntry,
} from './types'

/**
 * A canned FPL API, served in place of the real one when `FPL_FIXTURES=1`.
 *
 * End-to-end tests cannot call the real API. It is unofficial, unversioned, rate-limited
 * and fronted by Cloudflare, which blocks datacenter IPs — so a suite that hit it would
 * be slow, non-deterministic, and would spend the egress reputation the app depends on.
 * Every page renders server-side from these calls, so there is no page a browser test can
 * reach without them.
 *
 * Two things this is not:
 *
 * - **Not a recorded fixture.** `./recorded/*.json` holds the real API's bytes and
 *   `recorded.test.ts` is the change detector for shape drift. This file is hand-authored,
 *   so it proves the app renders what it is given — never that the shape is right.
 *
 *   It is deliberately **not** replaced by the recordings, which was the original plan.
 *   The real league is 17 managers on one page, all scored, with no tie at the top: swapping
 *   these bodies for it would trade three cases the suite needs — a tie that must pool and
 *   split, a joiner with no scores, and standings past one page — for shape fidelity this
 *   file was never responsible for. The two cover different halves. Revisit only if the
 *   league grows past a page and happens to tie.
 * - **Not reachable in production.** It is gated on an environment variable that Railway
 *   never sets, and it announces itself on stderr when it activates, because a silent
 *   fake API serving a real league is the worst failure this file could have.
 */

export const FIXTURE_LEAGUE_ID = 9999999
export const FIXTURE_LEAGUE_NAME = "The Sunday League"

/**
 * 18 managers, matching the reference league — 17 with scores and one joiner who has
 * none yet.
 *
 * The size is not arbitrary. The default prize rules pay six places, and a league smaller
 * than that fails validation on sight, so a tiny fixture would put every Setup test on a
 * page that refuses to save. It also has to be larger than one page to be worth serving:
 * `standings` and `new_entries` paginate independently, and a fixture that fits in one
 * page would let a regression in that assembly pass unnoticed.
 */
export const FIXTURE_PAGE_SIZE = 10

/** Deliberately mixed: a tie at the top, a big riser, and a joiner with no scores yet. */
const NAMED = [
  { entry: 1000001, entry_name: 'Salah Bin Dover', player_name: 'Thierry Heumann' },
  { entry: 1000002, entry_name: 'Haaland Oates', player_name: 'Reese Andersson' },
  { entry: 1000003, entry_name: 'Sonny Delight', player_name: 'Indigo Mwangi' },
]

/**
 * 17 scored managers. The top two are tied on `total` — the case that must pool and split
 * prizes rather than pay both in full — and rank 3 has climbed five places.
 */
const SCORED: ClassicLeagueEntry[] = Array.from({ length: 17 }, (_, i) => {
  const named = NAMED[i]
  const rank = i === 1 ? 1 : i + 1
  return {
    entry: named?.entry ?? 1_000_010 + i,
    entry_name: named?.entry_name ?? `Team ${i + 1}`,
    player_name: named?.player_name ?? `Manager ${i + 1}`,
    rank,
    last_rank: i === 0 ? 2 : i === 1 ? 1 : i === 2 ? 8 : i + 1,
    // Distinct from `rank`, so a tie detected on rank_sort would look resolved.
    rank_sort: i + 1,
    total: i < 2 ? 148 : 148 - i * 6,
    event_total: [76, 71, 82][i] ?? 60 - i,
    club_badge_src: null,
  }
})

const JOINERS: NewLeagueEntry[] = [
  {
    entry: 1000004,
    entry_name: 'Late To The Party',
    joined_time: '2026-08-19T09:00:00Z',
    player_first_name: 'Dana',
    player_last_name: 'Okafor',
  },
]

/** One page of the standings response. Both collections paginate, independently. */
function standingsPage(page: number): ClassicLeagueStandings {
  const start = (page - 1) * FIXTURE_PAGE_SIZE
  const scored = SCORED.slice(start, start + FIXTURE_PAGE_SIZE)
  const joiners = JOINERS.slice(start, start + FIXTURE_PAGE_SIZE)

  return {
    ...LEAGUE_ENVELOPE,
    standings: {
      has_next: start + FIXTURE_PAGE_SIZE < SCORED.length,
      page,
      results: scored,
    },
    new_entries: {
      has_next: start + FIXTURE_PAGE_SIZE < JOINERS.length,
      page,
      results: joiners,
    },
  }
}

const LEAGUE_ENVELOPE: ClassicLeagueStandings = {
  league: {
    id: FIXTURE_LEAGUE_ID,
    name: FIXTURE_LEAGUE_NAME,
    created: '2026-07-23T17:32:06Z',
    closed: false,
    start_event: 1,
    league_type: 'x',
    scoring: 'c',
    admin_entry: 1000001,
  },
  last_updated_data: '2026-08-25T09:00:00Z',
  // Both collections are replaced per page by `standingsPage`; these are placeholders so
  // the envelope is a complete value rather than a partial.
  new_entries: { has_next: false, page: 1, results: [] },
  standings: { has_next: false, page: 1, results: [] },
}

/**
 * 38 events, the first two scored — so `gameweekCount` comes from `events.length` as it
 * does in production, and GW2 is current.
 */
const BOOTSTRAP: BootstrapStatic = {
  events: Array.from({ length: 38 }, (_, i) => ({
    id: i + 1,
    name: `Gameweek ${i + 1}`,
    deadline_time: `2026-${String(8 + Math.floor(i / 5)).padStart(2, '0')}-21T17:30:00Z`,
    finished: i < 2,
    data_checked: i < 2,
    is_current: i === 1,
    is_next: i === 2,
    is_previous: i === 0,
    // The GLOBAL average. Present because the payload has it, and deliberately not
    // equal to the mean of the fixture's `event_total`s (76 + 71 + 82) / 3 = 76.3 —
    // so a test asserting on the league average would catch the wrong field being used.
    average_entry_score: 57,
    highest_scoring_entry: i < 2 ? 1000003 : null,
    ranked_count: 11_000_000,
  })),
}

/** A settled gameweek: bonus applied and leagues recalculated, so the send gate opens. */
const EVENT_STATUS: EventStatus = {
  leagues: 'Updated',
  status: [
    { bonus_added: true, date: '2026-08-24', event: 2, points: 'r' },
    { bonus_added: true, date: '2026-08-25', event: 2, points: 'r' },
  ],
}

const HISTORY: EntryHistory = {
  current: [
    {
      event: 1,
      points: 72,
      total_points: 72,
      rank: 500_000,
      overall_rank: 500_000,
      points_on_bench: 6,
      event_transfers_cost: 0,
    },
    {
      event: 2,
      points: 76,
      total_points: 148,
      rank: 300_000,
      overall_rank: 300_000,
      points_on_bench: 3,
      event_transfers_cost: 4,
    },
  ],
  past: [],
  chips: [],
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * A `fetch` that answers the four endpoints the app calls and refuses everything else.
 *
 * Unknown paths 404 loudly rather than returning an empty object: a test that silently
 * renders a blank league because a URL changed would pass while proving nothing, which is
 * the failure mode this whole file exists to avoid.
 */
export const fixtureFetch: typeof fetch = async (input) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const path = url.replace(/^https:\/\/fantasy\.premierleague\.com\/api/, '')

  if (path.startsWith('/bootstrap-static/')) return json(BOOTSTRAP)
  if (path.startsWith('/event-status/')) return json(EVENT_STATUS)
  if (/^\/entry\/\d+\/history\//.test(path)) return json(HISTORY)

  if (/^\/leagues-classic\/\d+\/standings\//.test(path)) {
    const page = Number(new URL(url).searchParams.get('page_standings') ?? '1')
    return json(standingsPage(Number.isInteger(page) && page > 0 ? page : 1))
  }

  return new Response(JSON.stringify({ error: `No fixture for ${path}` }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Whether to serve fixtures instead of the real API.
 *
 * Read from the environment rather than `NODE_ENV`, because the end-to-end suite runs
 * against a production build — so "are we in a test" is not something the runtime can
 * infer. The variable is set only by `playwright.config.ts`.
 */
export function fplFixturesEnabled(): boolean {
  return process.env.FPL_FIXTURES === '1'
}
