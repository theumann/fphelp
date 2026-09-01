import { redirect } from 'next/navigation'

import { auth } from '@/auth'
import { resolveLanding } from '@/lib/league-access'

export const dynamic = 'force-dynamic'

/**
 * The composer moved to `/l/<fplLeagueId>/send`. This forwards.
 *
 * Kept rather than deleted because this path is in bookmarks and in the home screen icon's
 * history — it was the app's front door for the whole of the single-league era, and the
 * owner who taps a stale one should land on their draft, not on a 404 that reads as the
 * app being broken.
 *
 * An owner with several leagues cannot be forwarded (there is no way to tell which one they
 * meant) and gets the chooser at `/`; `resolveLanding` decides. `actions.ts` stays in this
 * directory — Server Actions are not routes and did not move.
 */
export default async function LegacySendPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/signin')
  redirect(await resolveLanding(session.user.id, '/send'))
}
