'use server'

import { auth } from '@/auth'
import { assertOwner, markSent, saveDraft } from '@/db/queries'
import type { BlockSelection } from '@/lib/render/blocks'

/**
 * Server Actions are publicly reachable endpoints — guarding the page that calls them
 * is not enough. Every action re-checks the session and that the caller owns the league
 * it is writing to.
 */
async function requireOwner(leagueId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Not signed in')
  await assertOwner(leagueId, session.user.id)
  return session.user.id
}

export interface SaveDraftResult {
  messageId: string
  savedAt: string
}

export async function saveDraftAction(input: {
  leagueId: string
  digestId: string
  messageId?: string
  body: string
  blocks: BlockSelection
}): Promise<SaveDraftResult> {
  await requireOwner(input.leagueId)

  const row = await saveDraft(input)
  return { messageId: row.id, savedAt: new Date().toISOString() }
}

/**
 * Records a send. There is no delivery confirmation to wait for — the owner sends
 * inside WhatsApp, which we cannot observe — so this is the owner telling us, and its
 * absence means unknown rather than failed.
 */
export async function markSentAction(input: {
  leagueId: string
  messageId: string
  sentText: string
}): Promise<{ sentAt: string }> {
  const userId = await requireOwner(input.leagueId)

  const row = await markSent(input.messageId, input.sentText, userId)
  return { sentAt: (row.sentAt ?? new Date()).toISOString() }
}
