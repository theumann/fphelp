'use client'

import { useState } from 'react'

import type { BlockSelection } from '@/lib/render/blocks'
import type { RenderedEmail } from '@/lib/render/email'

interface Props {
  /** Already rendered by the composer, which owns the shared prose and the send action. */
  rendered: RenderedEmail
  blocks: BlockSelection
  onBlocksChange: (blocks: BlockSelection) => void
  recipientCount: number
  /** A prior delivery for this gameweek, so the state survives a reload. */
  sentAt?: string
  error: string | null
  /** False in demo mode, where there is no league row and nothing to send to. */
  canSend: boolean
  hideRecipients: boolean
  onHideRecipientsChange: (hide: boolean) => void
  /** Set when the setting failed to save, so the box has been put back. */
  hideRecipientsError: string | null
}

const LABELS: { key: keyof BlockSelection; label: string }[] = [
  { key: 'gwResults', label: 'Gameweek results' },
  { key: 'overallStandings', label: 'Full standings table' },
  { key: 'prizeStructure', label: 'Prize structure' },
]

/**
 * The email tab: what will be sent, and what goes in it.
 *
 * Presentational by design — the send button lives in the composer's fixed bottom bar so
 * that both channels put their primary action in the same place, which means the dispatch
 * state has to live above this component rather than inside it.
 *
 * Block selection is still separate from WhatsApp's: that one is squeezed by a ~1,500
 * character URL budget, and this one has no limit at all.
 */
export function EmailPanel({
  rendered,
  blocks,
  onBlocksChange,
  recipientCount,
  sentAt,
  error,
  canSend,
  hideRecipients,
  onHideRecipientsChange,
  hideRecipientsError,
}: Props) {
  const [showHtml, setShowHtml] = useState(true)

  return (
    <div
      id="panel-email"
      role="tabpanel"
      aria-labelledby="tab-email"
      className="flex flex-col gap-4"
    >
      {recipientCount === 0 && canSend && (
        <p className="rounded-lg bg-warning-surface p-3 text-sm text-warning">
          No addresses yet — add them in Setup. The FPL API doesn&apos;t provide them, so the
          list is yours to keep.
        </p>
      )}

      {/**
       * The reply model, here as well as in Setup.
       *
       * It is a league setting and Setup is its home, but Setup is not where anyone thinks
       * about sending — an owner who wants a conversation would compose, send, and only
       * discover the digest was bcc'd when nobody could reply to it. This is the same
       * stored value, not a per-message copy: the disclosure is irreversible, so cc'ing
       * once and hiding next week un-publishes nothing.
       */}
      {canSend && (
        <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={hideRecipients}
              onChange={(e) => onHideRecipientsChange(e.target.checked)}
              className="mt-0.5 size-4 accent-accent"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Hide recipients&apos; addresses</span>
              <span className="text-xs leading-relaxed text-muted">
                {hideRecipients
                  ? 'Members can only reply to you, not to each other.'
                  : 'Everyone sees the whole list, so replying to all reaches the league.'}
              </span>
            </span>
          </label>

          {hideRecipientsError && (
            <p role="alert" className="text-xs leading-relaxed text-danger">
              {hideRecipientsError}
            </p>
          )}

          {!hideRecipients && (
            <p className="text-xs leading-relaxed text-warning">
              Every member will see all {recipientCount}{' '}
              {recipientCount === 1 ? 'address' : 'addresses'} from this send onward.
              Turning this back on doesn&apos;t un-send them.
            </p>
          )}
        </div>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Include</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {LABELS.map(({ key, label }) => (
            <label key={key} className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={blocks[key]}
                onChange={(e) => onBlocksChange({ ...blocks, [key]: e.target.checked })}
                className="size-4 accent-accent"
              />
              {label}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted">
          Separate from the WhatsApp selection — no length limit here, so the full table
          fits.
        </p>
      </fieldset>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate text-xs text-muted">
            Subject: <span className="text-foreground">{rendered.subject}</span>
          </span>
          <button
            type="button"
            onClick={() => setShowHtml(!showHtml)}
            className="shrink-0 text-xs underline"
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
            srcDoc={rendered.html}
            className="h-96 w-full rounded-lg border border-line bg-white"
          />
        ) : (
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-muted p-3 text-xs">
            {rendered.text || 'Nothing to send yet.'}
          </pre>
        )}
      </div>

      {sentAt && (
        <p className="text-sm text-muted">Emailed on {new Date(sentAt).toLocaleString()}.</p>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-danger-surface p-3 text-sm text-danger">
          Not sent — {error}
        </p>
      )}
    </div>
  )
}
