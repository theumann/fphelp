import { redirect } from 'next/navigation'

import { auth } from '@/auth'
import { SetupForm } from '@/components/setup-form'
import { ensureLeague, ensureMembership, getSettings, isFinalised } from '@/db/queries'
import { fpl } from '@/lib/fpl/client'
import { gameweekCount } from '@/lib/fpl/gameweek'
import { buildRoster } from '@/lib/fpl/roster'
import { REFERENCE_LEAGUE } from '@/lib/league-config'

export const dynamic = 'force-dynamic'

export default async function SetupPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/signin')

  const [standings, bootstrap] = await Promise.all([
    fpl.leagueStandingsAll(REFERENCE_LEAGUE.fplLeagueId),
    fpl.bootstrapStatic(),
  ])

  const league = await ensureLeague(REFERENCE_LEAGUE.fplLeagueId, standings.league.name)
  const membership = await ensureMembership(league.id, session.user.id)

  const roster = buildRoster(standings)
  const settings = await getSettings(league.id)

  return (
    <main>
      <SetupForm
        leagueId={league.id}
        leagueName={standings.league.name}
        fplLeagueId={league.fplLeagueId}
        initial={settings}
        gameweekCount={gameweekCount(bootstrap)}
        managers={roster.map((m) => ({
          entry: m.entry,
          entryName: m.entryName,
          playerName: m.playerName,
        }))}
        initialManagerEntry={membership?.managerEntry ?? null}
        finalised={await isFinalised(league.id)}
      />
    </main>
  )
}
