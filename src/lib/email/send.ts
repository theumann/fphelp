/**
 * Sending an email through Resend.
 *
 * Raw `fetch`, matching `src/auth.ts` — the SDK would be a dependency for one POST,
 * and the sign-in mail already goes out this way.
 */

export interface SendEmailInput {
  to: string[]
  subject: string
  html: string
  text: string
  /** Where replies go. The digest invites replies; the noreply sender address doesn't. */
  replyTo?: string
}

export type SendEmailResult =
  | { ok: true; providerId: string | null }
  | { ok: false; error: string }

/** Resend's per-request recipient ceiling. Larger leagues are split into batches. */
const MAX_PER_REQUEST = 50

/**
 * Recipients go in `bcc`, never `to`.
 *
 * A league digest to fourteen people in `to` publishes all fourteen addresses to all
 * fourteen — a privacy leak the owner cannot undo once sent, and one nobody notices
 * until it has happened. `to` carries the sender alone so the message still has a
 * valid single recipient.
 */
function payload(from: string, batch: string[], input: SendEmailInput) {
  return {
    from,
    to: [from],
    bcc: batch,
    subject: input.subject,
    html: input.html,
    text: input.text,
    ...(input.replyTo ? { reply_to: input.replyTo } : {}),
  }
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const key = process.env.AUTH_RESEND_KEY
  const from = process.env.AUTH_EMAIL_FROM

  // Fail loudly rather than reporting a send that never left the building.
  if (!key) return { ok: false, error: 'AUTH_RESEND_KEY is not set.' }
  if (!from) return { ok: false, error: 'AUTH_EMAIL_FROM is not set.' }
  if (input.to.length === 0) return { ok: false, error: 'No recipients.' }

  const batches: string[][] = []
  for (let i = 0; i < input.to.length; i += MAX_PER_REQUEST) {
    batches.push(input.to.slice(i, i + MAX_PER_REQUEST))
  }

  let firstId: string | null = null

  for (const [i, batch] of batches.entries()) {
    let res: Response
    try {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload(from, batch, input)),
      })
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      // Say which batch, because the earlier ones did go out. Reporting a flat
      // failure would have the owner resend to people who already received it.
      const where = batches.length > 1 ? ` (batch ${i + 1} of ${batches.length})` : ''
      return { ok: false, error: `Resend refused the email${where}: ${res.status} ${detail}`.trim() }
    }

    if (firstId === null) {
      const body = (await res.json().catch(() => null)) as { id?: string } | null
      firstId = body?.id ?? null
    }
  }

  return { ok: true, providerId: firstId }
}
