import { redirect } from 'next/navigation'

import { auth } from '@/auth'
import { resolveLanding } from '@/lib/league-access'

export const dynamic = 'force-dynamic'

/** Forwards to `/l/<fplLeagueId>/dues`. See `src/app/send/page.tsx` for why these stay. */
export default async function LegacyDuesPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/signin')
  redirect(await resolveLanding(session.user.id, '/dues'))
}
