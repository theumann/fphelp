'use server'

import { revalidatePath } from 'next/cache'

import { auth } from '@/auth'
import { canCreateLeagues, createLeague } from '@/db/queries'
import { FplBlockedError, fpl } from '@/lib/fpl/client'
import { buildRoster } from '@/lib/fpl/roster'
import { parseLeagueSegment } from '@/lib/league-config'

/**
 * Creating a league, in two steps: look it up, then claim it.
 *
 * Split because `fpl_league_id` is unique and a claim is awkward to undo — showing the
 * real name and manager count before committing is what stops a mistyped digit becoming
 * somebody else's league sitting in your account.
 *
 * Both steps re-check permission. A Server Action is a public endpoint: the button being
 * absent from the page proves nothing about what was posted to it.
 */

export interface LeagueLookup {
  ok: boolean
  fplLeagueId?: number
  name?: string
  managers?: number
  error?: string
}

/** Shared by both steps, since neither may run for someone who cannot create leagues. */
async function requireCreator(): Promise<{ userId: string } | { error: string }> {
  const session = await auth()
  if (!session?.user?.id) return { error: 'Sign in first.' }

  if (!(await canCreateLeagues(session.user.id))) {
    return {
      error:
        'Your account cannot create leagues. Ask whoever gave you access to set that up.',
    }
  }

  return { userId: session.user.id }
}

/**
 * Step one: does this ID name a real league, and what is it called?
 *
 * Read-only, and writes nothing whatever the answer — a lookup that created a row would
 * make typing a number the act of claiming a league.
 */
export async function lookupLeagueAction(raw: string): Promise<LeagueLookup> {
  const permitted = await requireCreator()
  if ('error' in permitted) return { ok: false, error: permitted.error }

  const fplLeagueId = parseLeagueSegment(raw.trim())
  if (fplLeagueId === null) {
    // The trap this whole flow exists to catch. An invite code looks like an ID to
    // everyone except the API, which 404s on it much later and much less clearly.
    return {
      ok: false,
      error:
        'That is not a league ID. Use the number from the league URL — an invite code like "1xrliv" is not the same thing and cannot be converted to one.',
    }
  }

  try {
    const standings = await fpl.leagueStandingsAll(fplLeagueId)
    return {
      ok: true,
      fplLeagueId,
      name: standings.league.name,
      // The full roster, so a league whose members have not been scored yet still reports
      // its size — a new league is all `new_entries` and no standings rows.
      managers: buildRoster(standings).length,
    }
  } catch (err) {
    if (err instanceof FplBlockedError) {
      return { ok: false, error: 'The FPL API is refusing this server right now. Try again shortly.' }
    }
    return {
      ok: false,
      error: `No league with ID ${fplLeagueId}. Check the number in the league URL.`,
    }
  }
}

export interface CreateLeagueResult {
  ok: boolean
  path?: string
  error?: string
}

/**
 * Step two: claim it.
 *
 * The name is fetched again rather than accepted from the client. The browser has just
 * been shown a name, but a Server Action is a public endpoint and storing whatever it
 * posts would let a league be created under any label its claimant liked — including one
 * impersonating a different league.
 */
export async function createLeagueAction(raw: string): Promise<CreateLeagueResult> {
  const permitted = await requireCreator()
  if ('error' in permitted) return { ok: false, error: permitted.error }

  const fplLeagueId = parseLeagueSegment(raw.trim())
  if (fplLeagueId === null) return { ok: false, error: 'That is not a league ID.' }

  let name: string
  try {
    name = (await fpl.leagueStandingsAll(fplLeagueId)).league.name
  } catch {
    return { ok: false, error: `No league with ID ${fplLeagueId}.` }
  }

  const result = await createLeague(fplLeagueId, name, permitted.userId)

  if (!result.ok) {
    return {
      ok: false,
      error:
        'That league is already set up here. Ask whoever set it up to add you as an owner from their Setup page.',
    }
  }

  // The chooser at `/` lists leagues, and this just changed the list.
  revalidatePath('/')
  return { ok: true, path: `/l/${result.league.fplLeagueId}/send` }
}
