'use server'

import type { BlockSelection } from '@/lib/render/blocks'

import { markSent, saveDraft } from '@/db/queries'

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
  const row = await saveDraft(input)
  return { messageId: row.id, savedAt: new Date().toISOString() }
}

/**
 * Records a send. There is no delivery confirmation to wait for — the owner sends
 * inside WhatsApp, which we cannot observe — so this is the owner telling us, and its
 * absence means unknown rather than failed.
 */
export async function markSentAction(input: {
  messageId: string
  sentText: string
}): Promise<{ sentAt: string }> {
  const row = await markSent(input.messageId, input.sentText)
  return { sentAt: (row.sentAt ?? new Date()).toISOString() }
}
