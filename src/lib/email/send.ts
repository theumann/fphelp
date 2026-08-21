/**
 * Sending an email through Resend.
 *
 * Raw `fetch`, matching `src/auth.ts` — the SDK would be a dependency for one POST,
 * and the sign-in mail already goes out this way.
 */

export interface SendEmailInput {
  to: string[]
  /**
   * Whether recipients are hidden from each other.
   *
   * `true` bcc's them, so no address is disclosed and a reply reaches only the sender.
   * `false` cc's them, which is what makes "reply all" reach the league — a mail client
   * can only reply to addresses it can see, so bcc and group replies are mutually
   * exclusive by definition rather than by choice.
   */
  hideRecipients: boolean
  subject: string
  html: string
  text: string
  /** Where replies go. The digest invites replies; the noreply sender address doesn't. */
  replyTo?: string
}

/**
 * Failures carry two strings, for two different readers.
 *
 * `error` is shown to the owner, so it says what happened to their email and whether to
 * try again — never the name of an environment variable they have no way to set.
 * `detail` is the provider's own words, kept for the `deliveries` row so a failure is
 * still diagnosable afterwards. Collapsing them loses one audience or the other.
 */
export type SendEmailResult =
  | { ok: true; providerId: string | null }
  | { ok: false; error: string; detail: string }

/** Resend's per-request recipient ceiling. Larger leagues are split into batches. */
const MAX_PER_REQUEST = 50

/**
 * Recipients go in `bcc` or `cc`, never `to`.
 *
 * `to` carries the sender alone either way, so the message always has a valid single
 * addressee and the owner keeps a copy of what the league received.
 *
 * The choice between the other two is a real trade and belongs to the owner, not to this
 * function. `bcc` discloses nothing but makes group replies impossible; `cc` publishes
 * every address to every member — irreversibly, on the first send — and is the only way
 * a league can hold a conversation over its own digest. `hideRecipients` records which
 * one they chose; see the `leagues` column of the same name.
 */
function payload(from: string, batch: string[], input: SendEmailInput) {
  return {
    from,
    to: [from],
    ...(input.hideRecipients ? { bcc: batch } : { cc: batch }),
    subject: input.subject,
    html: input.html,
    text: input.text,
    ...(input.replyTo ? { reply_to: input.replyTo } : {}),
  }
}

/** Not configured is an operator problem; the owner just needs to know it isn't theirs to fix. */
const NOT_CONFIGURED = 'Email isn’t set up on this server yet. Nothing was sent.'

/**
 * Why it failed, and what to do about it — the cause only.
 *
 * Deliberately says nothing about *how much* was sent. That depends on which batch
 * failed, not on the status code, and a cause sentence that asserts "nothing was sent"
 * contradicts the scope clause appended after it the moment a later batch is the one
 * that failed. Getting that wrong tells the owner to resend to people who already have
 * it — the exact outcome the whole delivery guard exists to prevent.
 */
function cause(status: number): string {
  if (status === 401 || status === 403) {
    return 'The email service rejected our credentials. This needs fixing on the server - it isn’t something you did.'
  }
  if (status === 429) {
    return 'The email service is rate-limiting us - wait a minute and try again.'
  }
  if (status === 422 || status === 400) {
    return 'The email service refused the message - usually a recipient address it won’t accept. Check the list in Setup.'
  }
  if (status >= 500) {
    return 'The email service is having trouble at their end - try again shortly.'
  }
  return 'The email service refused the message.'
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const key = process.env.AUTH_RESEND_KEY
  const from = process.env.AUTH_EMAIL_FROM

  // Fail loudly rather than reporting a send that never left the building.
  if (!key) return { ok: false, error: NOT_CONFIGURED, detail: 'AUTH_RESEND_KEY is not set.' }
  if (!from) return { ok: false, error: NOT_CONFIGURED, detail: 'AUTH_EMAIL_FROM is not set.' }
  if (input.to.length === 0) {
    return {
      ok: false,
      error: 'There’s nobody to send to yet - add addresses in Setup.',
      detail: 'Empty recipient list.',
    }
  }

  /**
   * Visible recipients cannot be batched.
   *
   * Batching is invisible with `bcc` — nobody can tell how the list was split. With `cc`
   * it silently fractures the league: each batch sees only its own members, so "reply all"
   * reaches a third of the group and the owner has no way to know. Refusing is the honest
   * outcome; the alternative is a conversation that quietly excludes people.
   *
   * Unreachable for any realistic league — this one has 18 managers against a ceiling of
   * 50 — but the failure it prevents is silent, which is exactly the kind worth a guard.
   */
  if (!input.hideRecipients && input.to.length > MAX_PER_REQUEST) {
    return {
      ok: false,
      error:
        `A league this size can’t have everyone visible on one email - ${MAX_PER_REQUEST} ` +
        'is the limit. Switch on "Hide recipients’ addresses" in Setup, or send to a ' +
        'mailing-list address instead. Nothing was sent.',
      detail: `${input.to.length} cc recipients exceeds the per-request ceiling of ${MAX_PER_REQUEST}.`,
    }
  }

  const batches: string[][] = []
  for (let i = 0; i < input.to.length; i += MAX_PER_REQUEST) {
    batches.push(input.to.slice(i, i + MAX_PER_REQUEST))
  }

  let firstId: string | null = null

  /**
   * How much got out before the failure. Always stated, because "did anything arrive"
   * is the question that decides whether the owner should retry — and silence on it is
   * read as "nothing", which is how the first batches end up receiving a second copy.
   */
  const scope = (failedIndex: number) => {
    if (failedIndex === 0) return 'Nothing was sent.'
    const already = failedIndex * MAX_PER_REQUEST
    return `The first ${already} recipients did already receive it, so trying again sends them a second copy.`
  }

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
      const detail = err instanceof Error ? err.message : String(err)
      return {
        ok: false,
        error: `Couldn’t reach the email service. ${scope(i)}`,
        detail,
      }
    }

    if (!res.ok) {
      const detail = `Resend returned ${res.status}: ${(await res.text().catch(() => '')).trim()}`
      // Cause then scope, composed once — see the note on `cause`.
      return { ok: false, error: `${cause(res.status)} ${scope(i)}`, detail }
    }

    if (firstId === null) {
      const body = (await res.json().catch(() => null)) as { id?: string } | null
      firstId = body?.id ?? null
    }
  }

  return { ok: true, providerId: firstId }
}
