import { Composer } from '@/components/composer'
import { computeDigestStats } from '@/lib/digest/stats'
import { FplBlockedError, fpl } from '@/lib/fpl/client'
import { gameweekCount, lastFinishedGameweek } from '@/lib/fpl/gameweek'
import { buildRoster } from '@/lib/fpl/roster'
import { prizeSummary, REFERENCE_LEAGUE } from '@/lib/league-config'

// Live FPL data — never serve a cached table as this week's result.
export const dynamic = 'force-dynamic'

export default async function SendPage() {
  let standings
  let bootstrap

  try {
    ;[standings, bootstrap] = await Promise.all([
      fpl.leagueStandingsAll(REFERENCE_LEAGUE.fplLeagueId),
      fpl.bootstrapStatic(),
    ])
  } catch (err) {
    const blocked = err instanceof FplBlockedError
    return (
      <main className="mx-auto max-w-xl p-6">
        <h1 className="text-lg font-semibold">Couldn&apos;t reach the FPL API</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          {blocked
            ? 'The API appears to be blocking this host. This is the Cloudflare datacenter-IP risk — see ARCHITECTURE.md; the fix is an egress proxy, not a redeploy.'
            : 'The request failed. This is usually transient — the FPL API goes down around deadlines.'}
        </p>
        <pre className="mt-4 overflow-auto rounded bg-neutral-100 p-3 text-xs dark:bg-neutral-900">
          {err instanceof Error ? err.message : String(err)}
        </pre>
      </main>
    )
  }

  const roster = buildRoster(standings)

  // Pre-season there is no finished gameweek; show GW1 so the page still works.
  const gameweek = lastFinishedGameweek(bootstrap) ?? 1
  const stats = computeDigestStats(roster, gameweek)

  // Phase 0: hardcoded owner. Comes from `league_users.manager_entry` once auth exists,
  // and differs per co-owner since they sign with their own team.
  const signature = `Thierry — ${standings.league.name} Admin`

  return (
    <main>
      <Composer
        stats={stats}
        prize={prizeSummary(gameweekCount(bootstrap))}
        signature={signature}
        leagueName={standings.league.name}
        defaultBlocks={{ overallStandings: true, gwResults: true, prizeStructure: false }}
      />
    </main>
  )
}
