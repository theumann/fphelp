/**
 * Records the real FPL API's responses to disk, verbatim.
 *
 *   npm run fpl:record
 *
 * These are the change detector. The API is unofficial and unversioned, and it shifts
 * between seasons with no announcement; a recorded payload that stops matching the parsers
 * is the only warning this project will get. `src/lib/fpl/fixtures.ts` cannot do that job —
 * it is hand-authored, so it proves the app renders what it is given and nothing about
 * whether the shape is right.
 *
 * **Record a settled gameweek.** A provisional one bakes `bonus_added: false` and
 * `points: "p"` into the suite, which quietly leaves the send gate's ready path untested —
 * the one path that matters. Check `npm run fpl:snapshot` says `statsReady: true` first.
 *
 * Deliberately NOT routed through `FplClient`: it writes the bytes the API returned, before
 * typing, so a field the client silently drops is still captured. It also refuses to run
 * with `FPL_FIXTURES=1`, which would otherwise record the fixtures on top of themselves.
 *
 * **The output contains real people's names** — every manager in the league, by name. The
 * repository is private and needs to stay that way. See docs/GW1-VERIFICATION.md §4.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { REFERENCE_LEAGUE } from '../src/lib/league-config'

if (process.env.FPL_FIXTURES === '1') {
  console.error('FPL_FIXTURES=1 is set. This would record the canned fixtures, not the API.')
  process.exit(1)
}

const BASE = 'https://fantasy.premierleague.com/api'
const OUT = join(process.cwd(), 'src/lib/fpl/recorded')
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'

async function get(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} at ${path}`)
  return res.json()
}

async function save(name: string, body: unknown) {
  const file = join(OUT, `${name}.json`)
  await writeFile(file, `${JSON.stringify(body, null, 2)}\n`, 'utf8')
  const size = JSON.stringify(body).length
  console.log(`  ${name.padEnd(28)} ${(size / 1024).toFixed(1)} KB`)
}

await mkdir(OUT, { recursive: true })
const leagueId = REFERENCE_LEAGUE.fplLeagueId
console.log(`\nRecording league ${leagueId} at ${new Date().toISOString()}\n`)

/**
 * `bootstrap-static` is ~1 MB, almost all of it `elements` (every player in the game) and
 * `teams`, which this app never reads. Only `events` is kept, and every event is kept whole
 * — so the fields we consume are recorded at full fidelity and a new key on an event still
 * shows up in the diff. Dropping collections we do not parse is not a fidelity loss; it is
 * the difference between a reviewable diff and a megabyte of noise every season.
 */
const bootstrap = (await get('/bootstrap-static/')) as { events: unknown[] }
await save('bootstrap-static', { events: bootstrap.events })

await save('event-status', await get('/event-status/'))

/**
 * Page 1 verbatim, with its `has_next` intact. The reference league is 17 managers and fits
 * one page, so this records `has_next: false` — which means the recorded payloads do NOT
 * exercise the multi-page assembly in `leagueStandingsAll`. That case stays with the
 * hand-authored fixture, which paginates at 10. Recording cannot cover it until the league
 * outgrows a page.
 */
const standings = (await get(`/leagues-classic/${leagueId}/standings/?page_standings=1`)) as {
  standings: { results: { entry: number }[] }
}
await save('league-standings', standings)

const entry = standings.standings.results[0]?.entry
if (entry === undefined) throw new Error('No standings results — nothing to sample history from')
await save('entry-history', await get(`/entry/${entry}/history/`))

console.log(`\nWrote ${OUT}\n`)
