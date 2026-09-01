import { redirect } from 'next/navigation'

import { auth } from '@/auth'
import { resolveLanding } from '@/lib/league-access'

export const dynamic = 'force-dynamic'

/** Forwards to `/l/<fplLeagueId>/setup`. See `src/app/send/page.tsx` for why these stay. */
export default async function LegacySetupPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams

  const session = await auth()
  if (!session?.user?.id) redirect('/signin')

  // `?tab=` is carried across: `/setup?tab=money` is the shape used in links and in the
  // e2e suite, and dropping it would forward to the wrong panel rather than fail visibly.
  const suffix = tab ? `/setup?tab=${encodeURIComponent(tab)}` : '/setup'
  redirect(await resolveLanding(session.user.id, suffix))
}
