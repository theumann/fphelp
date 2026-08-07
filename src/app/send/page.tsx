import { redirect } from 'next/navigation'

import { auth } from '@/auth'
import { Composer } from '@/components/composer'
import { ensureLeague, findDraft, getSettings, ownerSignature, upsertDigest } from '@/db/queries'
import { demoRoster } from '@/lib/demo'
import { computeDigestStats } from '@/lib/digest/stats'
import { FplBlockedError, fpl } from '@/lib/fpl/client'
import { gameweekCount, lastFinishedGameweek } from '@/lib/fpl/gameweek'
import { buildRoster } from '@/lib/fpl/roster'
import { REFERENCE_LEAGUE } from '@/lib/league-config'
import { DEFAULT_SETTINGS, summarise } from '@/lib/league-settings'

// Live FPL data — never serve a cached table as this week's result.
export const dynamic = 'force-dynamic'

export default async function SendPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>
}) {
  const { demo } = await searchParams

  const session = await auth()
  if (!session?.user?.id) redirect('/signin')

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

  // ?demo=1 substitutes a synthetic scored league so the ~1,500 char budget and the
  // truncation path can be tested before GW1. Remove once the season starts.
  const roster = demo ? demoRoster(Number(demo) > 1 ? Number(demo) : 18) : buildRoster(standings)

  // Pre-season there is no finished gameweek; show GW1 so the page still works.
  const gameweek = demo ? 5 : (lastFinishedGameweek(bootstrap) ?? 1)
  const stats = computeDigestStats(roster, gameweek)

  const defaultBlocks = { overallStandings: true, gwResults: true, prizeStructure: false }

  // Demo mode persists nothing — it exists to test message length, not to write
  // synthetic rows into the real league's history.
  let persistence
  let signature = `${session.user.name ?? session.user.email} — ${standings.league.name} Admin`
  let prize = summarise(
    { ...DEFAULT_SETTINGS, potTotal: 0, rankPercentages: [...DEFAULT_SETTINGS.rankPercentages] },
    gameweekCount(bootstrap),
  )

  if (!demo) {
    const league = await ensureLeague(REFERENCE_LEAGUE.fplLeagueId, standings.league.name)
    const digest = await upsertDigest(league.id, gameweek, stats)
    const draft = await findDraft(league.id, gameweek)

    // Prizes come from the league's saved settings, not a hardcoded config.
    prize = summarise(await getSettings(league.id), gameweekCount(bootstrap))

    // The signature is per-sender: co-owners have different FPL entries and sign with
    // their own team, so it is built at render time from the signed-in owner's row and
    // never baked into the shared digest.
    signature = await ownerSignature(league.id, session.user.id, standings.league.name, roster)

    persistence = {
      leagueId: league.id,
      digestId: digest.id,
      messageId: draft?.id,
      initialBody: draft?.body ?? '',
      initialBlocks: draft?.blocks ?? defaultBlocks,
      sentAt: draft?.sentAt?.toISOString(),
    }
  }

  return (
    <main>
      <Composer
        stats={stats}
        prize={prize}
        signature={signature}
        leagueName={standings.league.name}
        defaultBlocks={defaultBlocks}
        persistence={persistence}
      />
    </main>
  )
}
