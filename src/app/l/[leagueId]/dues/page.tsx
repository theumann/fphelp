import { DuesList } from '@/components/dues-list'
import { NotAnOwner } from '@/components/not-an-owner'
import { getSettings, listDues, syncLeagueName } from '@/db/queries'
import { toCents } from '@/lib/digest/money'
import { fpl } from '@/lib/fpl/client'
import { buildRoster } from '@/lib/fpl/roster'
import { requireLeagueAccess } from '@/lib/league-access'

export const dynamic = 'force-dynamic'

export default async function DuesPage({
  params,
}: {
  params: Promise<{ leagueId: string }>
}) {
  const { leagueId } = await params

  // Membership is checked before the FPL call, not after: a non-member should not be
  // able to make this deployment fetch on their behalf.
  const access = await requireLeagueAccess(leagueId)
  if (!access.member) return <NotAnOwner />
  const { league } = access

  const standings = await fpl.leagueStandingsAll(league.fplLeagueId)
  await syncLeagueName(league.id, standings.league.name, league.name)

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
        potCents={settings.potTotal !== undefined ? toCents(settings.potTotal) : null}
        currency={settings.currency}
      />
    </main>
  )
}
