import { redirect } from 'next/navigation'

import { auth } from '@/auth'
import { NotAnOwner } from '@/components/not-an-owner'
import { OwnersList } from '@/components/owners-list'
import { RecipientsList } from '@/components/recipients-list'
import { SetupForm } from '@/components/setup-form'
import { Page, PageHeader } from '@/components/ui'
import {
  ensureLeague,
  findMembership,
  getSettings,
  isFinalised,
  listOwners,
  listRecipients,
} from '@/db/queries'
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
  const membership = await findMembership(league.id, session.user.id)
  if (!membership) return <NotAnOwner />

  const roster = buildRoster(standings)
  const [settings, owners, recipientList, finalised] = await Promise.all([
    getSettings(league.id),
    listOwners(league.id),
    listRecipients(league.id),
    isFinalised(league.id),
  ])

  return (
    <main>
      <Page>
        <PageHeader
          title="League setup"
          subtitle={
            <>
              {standings.league.name} · FPL league {league.fplLeagueId} · {roster.length}{' '}
              managers · {gameweekCount(bootstrap)} gameweeks
            </>
          }
        />

        <SetupForm
          leagueId={league.id}
          initial={settings}
          gameweekCount={gameweekCount(bootstrap)}
          managers={roster.map((m) => ({
            entry: m.entry,
            entryName: m.entryName,
            playerName: m.playerName,
          }))}
          initialManagerEntry={membership.managerEntry}
          finalised={finalised}
        />

        <OwnersList leagueId={league.id} owners={owners} currentUserId={session.user.id} />

        <RecipientsList
          leagueId={league.id}
          initialRecipients={recipientList}
          initialEmailEnabled={league.emailEnabled}
          managerCount={roster.length}
        />
      </Page>
    </main>
  )
}
