import { Nav } from '@/components/nav'
import { leaguePath, requireLeagueAccess } from '@/lib/league-access'

/**
 * The chrome for a league's pages, and the only place that knows the league is real.
 *
 * The nav used to live in the root layout and work out its own links from the pathname.
 * That is fine until the pathname lies: `/l/424242/send` looks exactly like a league URL,
 * so a 404 rendered a bar offering Compose, Dues and Setup for a league that does not
 * exist — three links, three more 404s. The pathname only says what was asked for; whether
 * it resolved is a server question, and this is where it is answered.
 *
 * So the nav is rendered here, below the resolution, and the root layout renders none.
 * `notFound()` from `requireLeagueAccess` is thrown before this returns, which means the
 * global `not-found.tsx` renders *outside* this layout and gets no league bar at all —
 * the fix is structural rather than a flag passed into the nav.
 *
 * A non-member gets the reduced bar too. The league is real, but every link in it would
 * refuse them, and `NotAnOwner` already says what to do instead.
 *
 * `requireLeagueAccess` is `cache`d, so the page below asking the same question again
 * costs nothing.
 */
export default async function LeagueLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ leagueId: string }>
}) {
  const { leagueId } = await params
  const access = await requireLeagueAccess(leagueId)

  return (
    <>
      <Nav
        who={access.userEmail}
        prefix={access.member ? leaguePath(access.league.fplLeagueId) : null}
      />
      {children}
    </>
  )
}
