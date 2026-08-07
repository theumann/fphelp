import { redirect } from 'next/navigation'

import { auth } from '@/auth'
import { DuesList } from '@/components/dues-list'
import { ensureLeague, ensureMembership, getSettings, listDues } from '@/db/queries'
import { toCents } from '@/lib/digest/money'
import { fpl } from '@/lib/fpl/client'
import { buildRoster } from '@/lib/fpl/roster'
import { REFERENCE_LEAGUE } from '@/lib/league-config'

export const dynamic = 'force-dynamic'

export default async function DuesPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/signin')

  const standings = await fpl.leagueStandingsAll(REFERENCE_LEAGUE.fplLeagueId)
  const league = await ensureLeague(REFERENCE_LEAGUE.fplLeagueId, standings.league.name)
  await ensureMembership(league.id, session.user.id)

  // The full roster, including managers who have joined but aren't in standings yet —
  // they owe their dues regardless of whether a gameweek has been scored.
  const roster = buildRoster(standings)
  const settings = await getSettings(league.id)
  const paid = await listDues(league.id)

  return (
    <main>
      <DuesList
        leagueId={league.id}
        leagueName={standings.league.name}
        managers={roster.map((m) => ({
          entry: m.entry,
          entryName: m.entryName,
          playerName: m.playerName,
          pending: m.pending,
        }))}
        initialPaid={Object.fromEntries(paid)}
        entryFeeCents={settings.entryFee !== undefined ? toCents(settings.entryFee) : null}
        potCents={toCents(settings.potTotal)}
        currency={settings.currency}
      />
    </main>
  )
}
