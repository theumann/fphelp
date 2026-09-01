import Link from 'next/link'
import { redirect } from 'next/navigation'

import { auth } from '@/auth'
import { Logo } from '@/components/logo'
import { Nav } from '@/components/nav'
import { Page, PageHeader } from '@/components/ui'
import { listLeaguesForUser } from '@/db/queries'
import { leaguePath } from '@/lib/league-access'

export const dynamic = 'force-dynamic'

/**
 * The landing page, and — since leagues moved into the URL — the league chooser.
 *
 * Three cases for a signed-in owner:
 *
 * - **exactly one league**: redirected straight to its composer, which is the behaviour
 *   from before there was more than one. The app's premise is that the draft is waiting
 *   when they open it, and a chooser listing a single item is a click charged for nothing.
 * - **several**: the chooser below. The nav is rendered here rather than by the root
 *   layout, reduced to the mark and Sign out — there is no league yet to link into.
 * - **none**: an invited owner who has not been added to a league yet. The create-league
 *   flow that will answer this is phase C; until then it says who to ask, which is true.
 *
 * Signed out, it is the same thin landing page as before. Ordinary league members never
 * sign in and are not the audience.
 */
export default async function Home() {
  const session = await auth()

  if (session?.user?.id) {
    const leagues = await listLeaguesForUser(session.user.id)
    if (leagues.length === 1) redirect(leaguePath(leagues[0].fplLeagueId, '/send'))

    return (
      <>
        {/* The reduced bar: no league is chosen yet, so there are no league links to
            offer — but an owner with no leagues now stays here rather than passing
            through, and without this there would be no way to sign out. */}
        <Nav who={session.user.email} />
        <main>
          <Page>
            <PageHeader
              title={leagues.length === 0 ? 'No leagues yet' : 'Your leagues'}
              subtitle={
                leagues.length === 0
                  ? 'Your account is signed in but does not administer a league yet. Ask whoever invited you to add you to one from their Setup page.'
                  : 'Each league has its own pot, prize rules and recipients.'
              }
            />

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
          </Page>
        </main>
      </>
    )
  }

  return (
    <main className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-6 py-20">
      {/* A wash of the logo's own gradient. Sized in vw so it scales with the viewport,
          and low-opacity so it reads as a tint rather than as a second element. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-1/3 left-1/2 h-[60vw] w-[110vw] -translate-x-1/2 rounded-full opacity-[0.12] blur-3xl dark:opacity-20"
        style={{
          background:
            'radial-gradient(ellipse at center, #0399ec 0%, #2762e1 35%, #991ce1 70%, transparent 100%)',
        }}
      />

      <div className="relative flex w-full max-w-md flex-col items-center gap-8 text-center">
        <Logo width={280} priority />

        <p className="text-balance text-base leading-relaxed text-muted">
          Standings, results and the money pot for your private Fantasy Premier League
          group - drafted for you, sent by you.
        </p>

        <Link
          href="/signin"
          className="rounded-lg bg-accent px-6 py-3 text-base font-medium text-accent-foreground transition-opacity hover:opacity-90"
        >
          Sign in
        </Link>

        {/* Said plainly, because the alternative is someone requesting a link and being
            refused with no idea why. Membership is granted by an owner, never by signing up. */}
        <p className="text-sm text-faint">
          For league owners. Access is granted by an existing owner. There is no sign-up.
        </p>
      </div>
    </main>
  )
}
