'use server'

import { revalidatePath } from 'next/cache'

import { auth } from '@/auth'
import { assertOwner, setDuePaid } from '@/db/queries'

/**
 * Marks a manager as having paid, or not.
 *
 * Any owner can do this in v1 — `role` is recorded but grants nothing, so the
 * treasurer has no special permission and neither does anyone else.
 */
export async function setPaidAction(input: {
  leagueId: string
  entry: number
  paid: boolean
}): Promise<{ ok: boolean }> {
  const session = await auth()
  if (!session?.user?.id) return { ok: false }
  await assertOwner(input.leagueId, session.user.id)

  await setDuePaid(input.leagueId, input.entry, input.paid)
  revalidatePath('/dues')
  return { ok: true }
}
