import Link from 'next/link'
import { redirect } from 'next/navigation'

import { auth } from '@/auth'
import { CreateLeague } from '@/components/create-league'
import { Nav } from '@/components/nav'
import { Page, PageHeader } from '@/components/ui'
import { canCreateLeagues, listLeaguesForUser } from '@/db/queries'
import { leaguePath } from '@/lib/league-access'

export const dynamic = 'force-dynamic'

/**
 * The league chooser, and the only place a league can be created.
 *
 * Its own route rather than living on `/`, because `/` redirects an owner with exactly one
 * league straight to their composer — which is right for the weekly case and would leave
 * anyone who *can* create a league unable to reach the form once they had one. `/` routes;
 * this page is where you manage what it routes to.
 *
 * Three states, and the third is the one that needed deciding:
 *
 * - **leagues, and may create**: the list plus the form.
 * - **leagues, may not create**: the list. Most owners, forever.
 * - **no leagues at all**: either the form, or — for someone an owner added as a co-owner
 *   of a league that was since removed — a sentence saying who to ask. Both are dead ends
 *   without the nav, which is why it renders here.
 */
export default async function LeaguesPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/signin')

  const [leagues, mayCreate] = await Promise.all([
    listLeaguesForUser(session.user.id),
    canCreateLeagues(session.user.id),
  ])

  return (
    <>
      {/* No league is selected here, so the bar carries no league links — see `Nav`. */}
      <Nav who={session.user.email} />
      <main>
        <Page>
          <PageHeader
            title={leagues.length === 0 ? 'No leagues yet' : 'Your leagues'}
            subtitle={
              leagues.length === 0
                ? mayCreate
                  ? 'Add the league you administer on FPL to get started.'
                  : 'Your account is signed in but does not administer a league yet. Ask whoever gave you access to add you to one from their Setup page.'
                : 'Each league has its own pot, prize rules and recipients.'
            }
          />

          {leagues.length > 0 && (
            <ul className="flex flex-col gap-2">
              {leagues.map((league) => (
                <li key={league.id}>
                  <Link
                    href={leaguePath(league.fplLeagueId, '/send')}
                    className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4 transition-colors hover:bg-surface-muted"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{league.name}</span>
                      {/* The FPL ID is shown because it is also what the URL says, so a
                          shared link can be told apart from another league's at a glance. */}
                      <span className="block text-sm text-faint">
                        FPL league {league.fplLeagueId}
                      </span>
                    </span>
                    <span aria-hidden className="text-muted">
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {mayCreate && (
            <CreateLeague
              heading={leagues.length === 0 ? 'Add your league' : 'Add another league'}
              hint="You need to be the league's admin on FPL. Nothing checks that yet, so claiming one you don't run would only block the person who does."
            />
          )}
        </Page>
      </main>
    </>
  )
}
