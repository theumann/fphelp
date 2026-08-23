/**
 * Prints what the FPL API is saying right now, through this app's own client.
 *
 * Exists because the API is unofficial and undocumented, so the only way to know its shape
 * is to look — and the moments worth looking at are unrepeatable. A gameweek settles once;
 * `event-status.leagues` passes through `"Updating"` on its way to `"Updated"` and is never
 * that again; managers move out of `new_entries` exactly once per season. Reconstructing a
 * throwaway script at the moment you need it is how those get missed.
 *
 *   npm run fpl:snapshot
 *
 * Read-only and stateless: no database, no writes, no arguments. Safe to run from anywhere
 * at any time, including against production data, because it only reads a public API.
 *
 * It reports through `sendGate`, `buildRoster` and `computeDigestStats` rather than dumping
 * raw JSON, so the question it answers is "what would the app do with this?" — which is the
 * one that matters. `docs/GW1-VERIFICATION.md` §2, §3 and §5 are all checked from its
 * output; §7 needs the cron service's logs as well.
 */
import { computeDigestStats } from '../src/lib/digest/stats'
import { fpl } from '../src/lib/fpl/client'
import {
  gameweekCount,
  lastFinishedGameweek,
  liveGameweek,
  sendGate,
} from '../src/lib/fpl/gameweek'
import { buildRoster, leagueAverage } from '../src/lib/fpl/roster'
import { REFERENCE_LEAGUE } from '../src/lib/league-config'

// The fixtures would make this report on canned data while looking exactly the same.
if (process.env.FPL_FIXTURES === '1') {
  console.error('FPL_FIXTURES=1 is set. This script is only meaningful against the real API.')
  process.exit(1)
}

const leagueId = REFERENCE_LEAGUE.fplLeagueId
const [bootstrap, status, standings] = await Promise.all([
  fpl.bootstrapStatic(),
  fpl.eventStatus(),
  fpl.leagueStandingsAll(leagueId),
])

const line = (label: string, value: unknown) => console.log(`  ${label.padEnd(24)} ${value}`)

console.log(`\n=== ${new Date().toISOString()} — league ${leagueId} ===`)

console.log('\nbootstrap-static')
for (const e of bootstrap.events.filter((e) => e.is_previous || e.is_current || e.is_next)) {
  console.log(
    `  GW${e.id} finished=${e.finished} data_checked=${e.data_checked} ` +
      `current=${e.is_current} next=${e.is_next} previous=${e.is_previous} ` +
      `globalAvg=${e.average_entry_score} ranked=${e.ranked_count}`,
  )
}
line('lastFinishedGameweek()', lastFinishedGameweek(bootstrap))
line('liveGameweek()', liveGameweek(bootstrap))
line('gameweekCount()', gameweekCount(bootstrap))

/**
 * The two values the send trigger waits on, called out because both are still unobserved.
 * `leagues` has been seen as `""` and `"Updating"`; `bonus_added` has only ever been false.
 */
console.log('\nevent-status')
line('leagues', JSON.stringify(status.leagues))
line('status rows', status.status.length)
line('bonus_added', status.status.map((d) => d.bonus_added).join(', ') || '(none)')
line('points', status.status.map((d) => JSON.stringify(d.points)).join(', ') || '(none)')

console.log('\nsend gate')
line('sendGate()', JSON.stringify(sendGate(bootstrap, status)))

console.log('\nstandings')
line('last_updated_data', standings.last_updated_data)
line('standings.results', standings.standings.results.length)
line('new_entries.results', standings.new_entries.results.length)
// The dedupe-on-`entry` rule assumes this is possible; it has never been observed.
line(
  'in BOTH collections',
  standings.standings.results.filter((s) =>
    standings.new_entries.results.some((n) => n.entry === s.entry),
  ).length,
)
const sample = standings.standings.results[0] ?? standings.new_entries.results[0]
if (sample) line('element keys', Object.keys(sample).join(', '))

const roster = buildRoster(standings)
const finished = lastFinishedGameweek(bootstrap)
const stats = computeDigestStats(roster, finished ?? liveGameweek(bootstrap) ?? 1)

console.log('\nwhat the app computes')
line('roster', `${roster.length} (${roster.filter((r) => r.pending).length} without scores)`)
/**
 * The single most important line here. The league average must be the mean of `event_total`
 * across this league; `events[].average_entry_score` is FPL's global average and using it
 * looks entirely correct while being wrong. Two different numbers is the proof.
 */
line(
  'leagueAverage()',
  `${leagueAverage(roster)}   (FPL global: ${bootstrap.events[0]?.average_entry_score})`,
)
line('gwWinners', stats.gwWinners.map((w) => `${w.entryName} ${w.eventTotal}`).join(', ') || '—')
line('biggestRiser', stats.biggestRiser?.entryName ?? '—')
line('biggestFaller', stats.biggestFaller?.entryName ?? '—')

const entry = standings.standings.results[0]?.entry
if (entry) {
  const history = await fpl.entryHistory(entry)
  console.log(`\nentry/${entry}/history`)
  line('current[]', history.current.length)
  line('past[]', history.past.length)
  if (history.current[0]) line('current[0] keys', Object.keys(history.current[0]).join(', '))
}

console.log()
