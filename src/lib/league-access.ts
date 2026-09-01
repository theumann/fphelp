import { notFound, redirect } from 'next/navigation'
import { cache } from 'react'

import { auth } from '@/auth'
import { findLeagueByFplId, findMembership, listLeaguesForUser } from '@/db/queries'
import { parseLeagueSegment } from '@/lib/league-config'

/**
 * How a page under `/l/[leagueId]` decides whether it may render.
 *
 * This is the one place the three pages agree on what a league URL means, and it is
 * deliberately the *only* thing that changed about access when leagues moved into the
 * URL. The rule from ROADMAP Phase 5 is unchanged and load-bearing: **membership is never
 * granted by visiting a page.** `findMembership` is read-only, and the league row is
 * looked up rather than ensured — the predecessor called `ensureLeague`, which was safe
 * only because the ID came from the environment. From a URL segment it would let anyone
 * create a league row by typing a number.
 *
 * The three outcomes are distinct on purpose:
 *
 * - **no session** → `/signin`, since they may well be an owner who is signed out;
 * - **no such league** → `notFound()`, which is the honest answer to an ID that names
 *   nothing;
 * - **not a member** → `{ member: false }`, and the caller renders `NotAnOwner`. Not a
 *   404: they signed in successfully and the useful sentence is "ask an owner to add
 *   you", which a blank 404 cannot say. It admits the league exists, which is already
 *   implied by them having been sent the link.
 */
/**
 * The signed-in user, on both branches.
 *
 * A refusal carries them too, because a non-member is still signed in and still needs the
 * sign-out button — without it the refusal page is a dead end they cannot leave except by
 * clearing cookies.
 */
interface AccessUser {
  userId: string
  userEmail: string | null
  userName: string | null
}

export type LeagueAccess =
  | ({ member: false } & AccessUser)
  | ({
      member: true
      league: NonNullable<Awaited<ReturnType<typeof findLeagueByFplId>>>
      membership: NonNullable<Awaited<ReturnType<typeof findMembership>>>
    } & AccessUser)

/**
 * Wrapped in `cache` because the layout and the page both ask.
 *
 * The layout needs the answer to decide whether the nav may show league links; the page
 * needs it to decide whether to render at all. Without memoisation that is two session
 * reads and two round trips per request for one question. `cache` is per-render, so it
 * dedupes within a request and never leaks across them.
 */
export const requireLeagueAccess = cache(async function requireLeagueAccess(
  leagueIdParam: string,
): Promise<LeagueAccess> {
  const session = await auth()
  if (!session?.user?.id) redirect('/signin')

  const fplLeagueId = parseLeagueSegment(leagueIdParam)
  if (fplLeagueId === null) notFound()

  const league = await findLeagueByFplId(fplLeagueId)
  if (!league) notFound()

  const user: AccessUser = {
    userId: session.user.id,
    userEmail: session.user.email ?? null,
    userName: session.user.name ?? null,
  }

  const membership = await findMembership(league.id, session.user.id)
  if (!membership) return { member: false, ...user }

  return { member: true, league, membership, ...user }
})

/** The URL prefix for a league's pages. The one place the `/l/` shape is spelled out. */
export function leaguePath(fplLeagueId: number, suffix = ''): string {
  return `/l/${fplLeagueId}${suffix}`
}

/**
 * Where a signed-in user should land when the URL names no league.
 *
 * Used by `/` and by the bare `/send`, `/setup`, `/dues` paths, which are kept as
 * redirects: they are in bookmarks, in the home-screen icon's history, and in the
 * manifest's `start_url` chain, and breaking them would look like the app had lost its
 * pages.
 *
 * One league redirects straight through rather than showing a chooser of one — which is
 * every week for an owner with a single league, and is the behaviour they had before this
 * existed.
 */
export async function resolveLanding(userId: string, suffix = '/send'): Promise<string> {
  const leagues = await listLeaguesForUser(userId)
  if (leagues.length === 1) return leaguePath(leagues[0].fplLeagueId, suffix)
  return '/'
}
