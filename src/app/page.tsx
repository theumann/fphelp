import Link from 'next/link'
import { redirect } from 'next/navigation'

import { auth } from '@/auth'
import { Logo } from '@/components/logo'
import { listLeaguesForUser } from '@/db/queries'
import { leaguePath } from '@/lib/league-access'

export const dynamic = 'force-dynamic'

/**
 * The landing page for signed-out visitors, and a router for everyone else.
 *
 * A signed-in owner never sees anything here. With exactly one league they go straight to
 * its composer — the app's premise is that the draft is waiting when they open it, and a
 * chooser listing one item is a click charged for nothing. With none or several, they go
 * to `/leagues`, which owns the list and the create form.
 *
 * Keeping the list off this page is what lets both behaviours coexist: a creator with one
 * league is still routed to their composer, and can still reach the form.
 *
 * Deliberately thin on marketing. Ordinary league members never sign in and are not the
 * audience; the only person who reaches this page and belongs is an owner who is signed
 * out, so the page's whole job is to say what this is and offer the one door.
 */
export default async function Home() {
  const session = await auth()
  const contact = process.env.SUPPORT_EMAIL?.trim()

  if (session?.user?.id) {
    const leagues = await listLeaguesForUser(session.user.id)
    redirect(leagues.length === 1 ? leaguePath(leagues[0].fplLeagueId, '/send') : '/leagues')
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

        {/*
          Said plainly, because the alternative is someone requesting a link and being
          refused with no idea why. Membership is granted by hand, never by signing up.

          The invitation to write in appears only when `SUPPORT_EMAIL` is set, and the
          sentence changes with it: promising a reply when no address is configured would
          be worse than the flat refusal it replaces. Read per render, not at module load,
          so setting the variable in Railway takes effect on a restart rather than needing
          a rebuild.
        */}
        <p className="text-sm text-faint">
          {contact ? (
            <>
              For league owners. Access is granted by hand — there is no sign-up. If you
              run a league and would like in, email{' '}
              <a className="underline underline-offset-2 hover:text-foreground" href={`mailto:${contact}`}>
                {contact}
              </a>
              .
            </>
          ) : (
            <>For league owners. Access is granted by an existing owner. There is no sign-up.</>
          )}
        </p>
      </div>
    </main>
  )
}
