'use client'

import { useMemo, useState } from 'react'

import { sendEmailAction } from '@/app/send/actions'
import type { DigestStats } from '@/lib/digest/stats'
import type { BlockSelection, PrizeSummary } from '@/lib/render/blocks'
import { renderEmail } from '@/lib/render/email'

interface Props {
  /** The owner's prose, shared with the WhatsApp composer — one message, two renderings. */
  body: string
  stats: DigestStats
  prize: PrizeSummary
  signature: string
  leagueName: string
  defaultBlocks: BlockSelection
  recipientCount: number
  /** Absent in demo mode; without it the panel is preview-only and cannot send. */
  send?: {
    leagueId: string
    gameweek: number
    /** Read at click time — the draft autosaves, so the id doesn't exist at first render. */
    getMessageId: () => string | undefined
    gameweekCount: number
    /** A prior delivery for this gameweek, so the state survives a reload. */
    sentAt?: string
  }
}

const LABELS: { key: keyof BlockSelection; label: string }[] = [
  { key: 'gwResults', label: 'Gameweek results' },
  { key: 'overallStandings', label: 'Full standings table' },
  { key: 'prizeStructure', label: 'Prize structure' },
]

/**
 * The email rendering of the same message.
 *
 * Block selection is **separate from WhatsApp's** on purpose. WhatsApp's is constrained
 * by a ~1,500 character URL budget, which for a 20-manager league the standings table
 * can consume on its own; email has no such limit, so the owner can send the full table
 * by email while keeping the WhatsApp message short. The prose and signature are shared
 * — only the generated blocks differ.
 */
export function EmailPanel({
  body,
  stats,
  prize,
  signature,
  leagueName,
  defaultBlocks,
  recipientCount,
  send,
}: Props) {
  // Standings default ON here, whatever WhatsApp's default is: the reason to leave the
  // table out is the budget, and email doesn't have one.
  const [blocks, setBlocks] = useState<BlockSelection>({
    ...defaultBlocks,
    overallStandings: true,
  })
  const [showHtml, setShowHtml] = useState(true)
  const [sending, setSending] = useState(false)
  const [sentAt, setSentAt] = useState(send?.sentAt)
  const [error, setError] = useState<string | null>(null)
  // Set when the server reports this gameweek already went out. The resend is a second,
  // separate click — a double-submit can't produce one.
  const [confirmResend, setConfirmResend] = useState(false)

  const email = useMemo(
    () =>
      renderEmail({
        leagueName,
        gameweek: stats.gameweek,
        body,
        blocks,
        stats,
        prize,
        signature,
      }),
    [leagueName, stats, body, blocks, prize, signature],
  )

  async function dispatch(resend: boolean) {
    if (!send) return
    setSending(true)
    setError(null)
    try {
      const result = await sendEmailAction({
        leagueId: send.leagueId,
        gameweek: send.gameweek,
        messageId: send.getMessageId(),
        body,
        blocks,
        signature,
        gameweekCount: send.gameweekCount,
        confirmResend: resend,
      })

      if (result.ok) {
        setSentAt(result.sentAt)
        setConfirmResend(false)
      } else if (result.alreadySent) {
        setSentAt(result.sentAt)
        setConfirmResend(true)
      } else {
        setError(result.error)
      }
    } catch {
      // A thrown action means the request itself didn't complete, so we genuinely don't
      // know whether the email went out. Say so — never fall through to a success
      // state, and never claim it failed either.
      setError(
        'The connection dropped, so we can’t tell whether this was sent. Check your inbox before trying again.',
      )
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Email version</h2>
        <span className="text-xs text-neutral-500">
          {recipientCount} {recipientCount === 1 ? 'recipient' : 'recipients'}
        </span>
      </div>

      {recipientCount === 0 && (
        <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          No addresses yet — add them in Setup. The FPL API doesn&apos;t provide them, so
          the list is yours to keep.
        </p>
      )}

      <fieldset className="flex flex-wrap gap-3">
        <legend className="sr-only">Blocks to include in the email</legend>
        {LABELS.map(({ key, label }) => (
          <label key={key} className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={blocks[key]}
              onChange={(e) => setBlocks({ ...blocks, [key]: e.target.checked })}
            />
            {label}
          </label>
        ))}
      </fieldset>

      <p className="text-xs text-neutral-500">
        Separate from the WhatsApp selection above — no length limit here, so the full
        table fits.
      </p>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-neutral-500">
            Subject: <span className="text-neutral-700 dark:text-neutral-300">{email.subject}</span>
          </span>
          <button
            type="button"
            onClick={() => setShowHtml(!showHtml)}
            className="text-xs underline"
          >
            {showHtml ? 'Show plain text' : 'Show HTML'}
          </button>
        </div>

        {showHtml ? (
          /* An iframe, not dangerouslySetInnerHTML: the email's inline styles must not
             leak into the app, and the app's stylesheet must not flatter the preview
             into looking better than it will in a mail client. `sandbox` with no
             allow-scripts is belt and braces — the HTML is ours and script-free. */
          <iframe
            title="Email preview"
            sandbox=""
            srcDoc={email.html}
            className="h-80 w-full rounded-lg border border-neutral-200 bg-white dark:border-neutral-800"
          />
        ) : (
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-neutral-100 p-3 text-xs dark:bg-neutral-900">
            {email.text || 'Nothing to send yet.'}
          </pre>
        )}
      </div>

      {send ? (
        <div className="flex flex-col gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          {sentAt && (
            <p className="text-xs text-neutral-600 dark:text-neutral-400">
              Emailed on {new Date(sentAt).toLocaleString()}.
            </p>
          )}

          {error && (
            <p className="rounded-lg bg-red-50 p-2 text-xs text-red-800 dark:bg-red-950 dark:text-red-200">
              Not sent — {error}
            </p>
          )}

          {confirmResend ? (
            <>
              <p className="text-xs text-amber-800 dark:text-amber-200">
                This gameweek has already been emailed. Sending again delivers a second
                copy to all {recipientCount}.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => dispatch(true)}
                  disabled={sending}
                  className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {sending ? 'Sending…' : 'Send it again anyway'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmResend(false)}
                  disabled={sending}
                  className="rounded-lg border border-neutral-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-neutral-700"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={() => dispatch(false)}
              disabled={sending || recipientCount === 0}
              className="self-start rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {sending ? 'Sending…' : `Send email to ${recipientCount}`}
            </button>
          )}

          <p className="text-xs text-neutral-500">
            Unlike WhatsApp, this sends from here — check the preview first. Addresses are
            bcc&apos;d, so nobody sees the list.
          </p>
        </div>
      ) : (
        <p className="text-xs text-neutral-500">Preview only — demo mode doesn&apos;t send.</p>
      )}
    </section>
  )
}
