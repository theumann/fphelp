import { DefaultBlocks } from '@/components/default-blocks'
import { NotAnOwner } from '@/components/not-an-owner'
import { OwnersList } from '@/components/owners-list'
import { RecipientsList } from '@/components/recipients-list'
import { SetupForm } from '@/components/setup-form'
import { SetupTabs } from '@/components/setup-tabs'
import { Page, PageHeader } from '@/components/ui'
import { YourTeam } from '@/components/your-team'
import {
  getSettings,
  isFinalised,
  listOwners,
  listRecipients,
  syncLeagueName,
} from '@/db/queries'
import { fpl } from '@/lib/fpl/client'
import { gameweekCount } from '@/lib/fpl/gameweek'
import { buildRoster } from '@/lib/fpl/roster'
import { requireLeagueAccess } from '@/lib/league-access'

export const dynamic = 'force-dynamic'

export default async function SetupPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const [{ leagueId }, { tab }] = await Promise.all([params, searchParams])

  const access = await requireLeagueAccess(leagueId)
  if (!access.member) return <NotAnOwner />
  const { league, membership, userId } = access

  const [standings, bootstrap] = await Promise.all([
    fpl.leagueStandingsAll(league.fplLeagueId),
    fpl.bootstrapStatic(),
  ])
  await syncLeagueName(league.id, standings.league.name, league.name)

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

        {/*
          Three panels, split by how the settings save rather than by what they are
          about: money batches behind a Save button, messages and people write on click.
          Communication leads because it is the weekly one — the pot and the prize rules
          are set once and then rarely touched.
          "Your team" sits with people because it is the one setting here that belongs to
          the signed-in owner rather than to the league — co-owners each set their own.
        */}
        <SetupTabs
          initial={tab}
          tabs={[
            {
              id: 'messages',
              label: 'Communication',
              panel: (
                <>
                  <DefaultBlocks leagueId={league.id} initial={league.defaultBlocks} />
                  <RecipientsList
                    leagueId={league.id}
                    initialRecipients={recipientList}
                    initialEmailEnabled={league.emailEnabled}
                    initialHideRecipients={league.hideRecipients}
                    managerCount={roster.length}
                  />
                </>
              ),
            },
            {
              id: 'money',
              label: 'Pot & prizes',
              panel: (
                <SetupForm
                  leagueId={league.id}
                  initial={settings}
                  gameweekCount={gameweekCount(bootstrap)}
                  managerCount={roster.length}
                  finalised={finalised}
                />
              ),
            },
            {
              id: 'people',
              label: 'People',
              panel: (
                <>
                  <OwnersList
                    leagueId={league.id}
                    owners={owners}
                    currentUserId={userId}
                  />
                  <YourTeam
                    leagueId={league.id}
                    managers={roster.map((m) => ({
                      entry: m.entry,
                      entryName: m.entryName,
                      playerName: m.playerName,
                    }))}
                    initial={membership.managerEntry}
                  />
                </>
              ),
            },
          ]}
        />
      </Page>
    </main>
  )
}
