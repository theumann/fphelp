'use server'

import { auth } from '@/auth'
import {
  assertOwner,
  clearSent,
  findDelivery,
  findDigest,
  getLeague,
  getSettings,
  listRecipients,
  markSent,
  recordDelivery,
  saveDraft,
} from '@/db/queries'
import type { DigestStats } from '@/lib/digest/stats'
import { sendEmail } from '@/lib/email/send'
import { summarise } from '@/lib/league-settings'
import type { BlockSelection } from '@/lib/render/blocks'
import { renderEmail } from '@/lib/render/email'

/**
 * Server Actions are publicly reachable endpoints — guarding the page that calls them
 * is not enough. Every action re-checks the session and that the caller owns the league
 * it is writing to.
 *
 * Returns the owner rather than just their id: the address is needed for `Reply-To`, and
 * looking it up separately would mean a second session round trip on every send. It comes
 * from the session rather than the request because where a member's reply lands is not the
 * browser's to choose.
 */
async function requireOwner(leagueId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Not signed in')
  await assertOwner(leagueId, session.user.id)
  return { id: session.user.id, email: session.user.email ?? undefined }
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
  const { id: userId } = await requireOwner(input.leagueId)

  const row = await markSent(input.messageId, input.sentText, userId)
  return { sentAt: (row.sentAt ?? new Date()).toISOString() }
}

export type SendEmailActionResult =
  | { ok: true; recipientCount: number; sentAt: string }
  /** `alreadySent` is not an error — it asks for a confirmation this attempt didn't carry. */
  | { ok: false; alreadySent: true; sentAt: string; error?: undefined }
  | { ok: false; alreadySent?: false; error: string }

/**
 * Sends the digest by email.
 *
 * The readiness gate is NOT re-applied here, deliberately. The composer withholds the
 * gameweek-derived blocks while scores are provisional and sends the withheld selection,
 * so a crafted request is the only way to get a mid-gameweek table into an email — and
 * only an owner can make one, addressed to their own league. Re-checking would mean two
 * FPL calls on every send, coupling delivery to the API being reachable, which is the same
 * trade `gameweekCount` already refuses.
 *
 * The HTML is re-rendered here from the stored digest rather than accepted from the
 * browser. A Server Action is a public endpoint, so client-supplied markup would be
 * markup we mail to fourteen people on an owner's say-so without ever having seen it —
 * and the escaping in `renderEmail` would be bypassed entirely. The client sends only
 * what the owner actually authored: the prose, the block selection and the signature.
 */
export async function sendEmailAction(input: {
  leagueId: string
  gameweek: number
  messageId?: string
  body: string
  blocks: BlockSelection
  signature: string
  /**
   * Scales the per-gameweek prize projection. Client-supplied because the alternative
   * is coupling every send to FPL being reachable, and the figures it moves are the
   * owner's own settings; clamped so a bad value can't invent a season.
   */
  gameweekCount: number
  /** Set only by an explicit second confirmation, after `alreadySent` came back. */
  confirmResend?: boolean
}): Promise<SendEmailActionResult> {
  const { id: userId, email: replyTo } = await requireOwner(input.leagueId)

  const league = await getLeague(input.leagueId)
  if (!league) return { ok: false, error: 'That league couldn’t be found.' }
  if (!league.emailEnabled) {
    return { ok: false, error: 'Email is switched off for this league - turn it on in Setup.' }
  }

  const existing = await findDelivery(input.leagueId, input.gameweek, 'email')
  // A previous failure delivered nothing, so it must not stand in the way of a retry.
  if (existing && existing.status === 'sent' && !input.confirmResend) {
    return { ok: false, alreadySent: true, sentAt: existing.updatedAt.toISOString() }
  }

  const digest = await findDigest(input.leagueId, input.gameweek)
  if (!digest) {
    return { ok: false, error: 'This gameweek hasn’t been prepared yet - reload the page.' }
  }

  const to = (await listRecipients(input.leagueId)).map((r) => r.email)

  const prize = summarise(
    await getSettings(input.leagueId),
    Math.min(60, Math.max(1, Math.round(input.gameweekCount))),
  )

  const email = renderEmail({
    leagueName: league.name,
    gameweek: input.gameweek,
    body: input.body,
    blocks: input.blocks,
    stats: digest.stats as DigestStats,
    prize,
    signature: input.signature,
  })

  const result = await sendEmail({
    to,
    hideRecipients: league.hideRecipients,
    // A newline here would let the rest of the subject be read as extra headers.
    subject: email.subject.replace(/[\r\n]+/g, ' '),
    html: email.html,
    text: email.text,
    // So a plain "Reply" reaches the owner who sent it rather than the sending address,
    // which nobody monitors. Co-owners therefore get their own replies, not each other's.
    replyTo,
  })

  await recordDelivery({
    leagueId: input.leagueId,
    gameweek: input.gameweek,
    kind: 'email',
    messageId: input.messageId,
    status: result.ok ? 'sent' : 'failed',
    providerId: result.ok ? result.providerId : null,
    recipientCount: to.length,
    // The provider's own words, not the sentence the owner saw — a `deliveries` row
    // reading "try again shortly" is useless when working out what went wrong.
    error: result.ok ? null : result.detail,
    sentBy: userId,
  })

  if (!result.ok) {
    // The owner gets the readable sentence; the log gets the provider's words. Without
    // this the detail exists only in the deliveries row, and a failed send looks silent
    // in the server output — which is exactly where anyone debugging looks first.
    console.error(
      `[email] GW${input.gameweek} league=${input.leagueId} to=${to.length}: ${result.detail}`,
    )
    return { ok: false, error: result.error }
  }

  // Only now is the send a fact. Recording the text is what makes it auditable later —
  // the owner edits the prose, so it isn't reproducible from the API.
  if (input.messageId) await markSent(input.messageId, email.text, userId)

  return { ok: true, recipientCount: to.length, sentAt: new Date().toISOString() }
}

/** Undoes a mark-as-sent — it is the owner's assertion, so it can be mistaken. */
export async function clearSentAction(input: {
  leagueId: string
  messageId: string
}): Promise<void> {
  await requireOwner(input.leagueId)
  await clearSent(input.messageId)
}
