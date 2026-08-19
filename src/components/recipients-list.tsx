'use client'

import { useState, useTransition } from 'react'

import {
  addRecipientsAction,
  removeRecipientAction,
  setEmailEnabledAction,
  setHideRecipientsAction,
} from '@/app/setup/actions'

import { Alert, Button, Card, inputClass } from './ui'

export interface Recipient {
  id: string
  email: string
  name: string | null
}

interface Props {
  leagueId: string
  initialRecipients: Recipient[]
  initialEmailEnabled: boolean
  initialHideRecipients: boolean
  /** Managers in the league, purely to show how far the list is from complete. */
  managerCount: number
}

type Status = { kind: 'idle' } | { kind: 'added'; added: number; skipped: number; invalid: string[] }

/**
 * The league's email list.
 *
 * Owner-maintained by necessity: the FPL API exposes names and team names but no
 * contact details, and members never log in. So this list starts empty, drifts from
 * `managers` as people join and leave, and nothing can reconcile the two automatically.
 * The manager count is shown against it for exactly that reason — it is the only hint
 * the owner gets that someone is missing.
 */
export function RecipientsList({
  leagueId,
  initialRecipients,
  initialEmailEnabled,
  initialHideRecipients,
  managerCount,
}: Props) {
  const [enabled, setEnabled] = useState(initialEmailEnabled)
  const [hide, setHide] = useState(initialHideRecipients)
  const [raw, setRaw] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [pending, startTransition] = useTransition()

  const recipients = initialRecipients

  function add() {
    if (!raw.trim()) return
    startTransition(async () => {
      const result = await addRecipientsAction({ leagueId, raw })
      if (result.ok) {
        setStatus({
          kind: 'added',
          added: result.added,
          skipped: result.skipped,
          invalid: result.invalid,
        })
        // Cleared only on success, so a failed paste isn't lost.
        setRaw('')
      }
    })
  }

  function toggle(next: boolean) {
    setEnabled(next)
    startTransition(async () => {
      await setEmailEnabledAction({ leagueId, enabled: next })
    })
  }

  function toggleHide(next: boolean) {
    setHide(next)
    startTransition(async () => {
      await setHideRecipientsAction({ leagueId, hide: next })
    })
  }

  return (
    <Card
      title="Email digest"
      hint="Optional. WhatsApp needs no addresses — email does, and only you can supply them."
      aside={
        <label className="flex cursor-pointer items-center gap-2">
          {/* Labelled explicitly: the visible text is the *state*, so without this the
              control announces itself as "Off", which says nothing about what it does. */}
          <input
            type="checkbox"
            aria-label="Send this league's digest by email"
            checked={enabled}
            disabled={pending}
            onChange={(e) => toggle(e.target.checked)}
            className="size-4 accent-accent"
          />
          <span aria-hidden>{enabled ? 'On' : 'Off'}</span>
        </label>
      }
    >
      {!enabled ? (
        <p className="text-sm text-muted">
          This league sends by WhatsApp only. Turn email on to keep a recipient list.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <label htmlFor="recipients" className="text-sm font-medium">
              Add addresses
            </label>
            <textarea
              id="recipients"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              rows={3}
              placeholder="steve@example.com, Indigo Mwangi <victor@example.com>"
              className={`${inputClass} text-sm`}
            />
            <p className="text-xs leading-relaxed text-muted">
              Paste as many as you like — separated by commas, semicolons or new lines.
              Names in <code className="font-mono">Name &lt;address&gt;</code> form are kept.
            </p>
            <Button
              variant="primary"
              size="sm"
              className="self-start"
              onClick={add}
              disabled={pending || !raw.trim()}
            >
              {pending ? 'Adding…' : 'Add to list'}
            </Button>
          </div>

          {status.kind === 'added' && (
            <Alert>
              <p>
                Added {status.added}
                {status.skipped > 0 && `, ${status.skipped} already on the list`}.
              </p>
              {status.invalid.length > 0 && (
                <p className="mt-1 text-danger">
                  Couldn&apos;t read {status.invalid.length}:{' '}
                  <span className="font-mono">{status.invalid.join(', ')}</span>
                </p>
              )}
            </Alert>
          )}

          {/**
           * The reply model, stated as a consequence rather than as a mail header.
           *
           * Both directions have a real cost and the owner is the only one who can weigh
           * them, so the label says what each does to their league instead of naming bcc
           * and cc. Turning hiding off is the direction that cannot be undone — the next
           * send publishes every address to every member — so that is spelled out where
           * the decision is made, not in a doc.
           */}
          <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={hide}
                disabled={pending}
                onChange={(e) => toggleHide(e.target.checked)}
                className="mt-0.5 size-4 accent-accent"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">Hide recipients&apos; addresses</span>
                <span className="text-xs leading-relaxed text-muted">
                  {hide
                    ? 'On: nobody sees anyone else’s address, and members can only reply to you — not to each other.'
                    : 'Off: everyone sees the whole list, so replying to all reaches the league. This is what makes the digest a conversation.'}
                </span>
              </span>
            </label>

            {!hide && (
              <p className="text-xs leading-relaxed text-warning">
                Every member will see all {recipients.length}{' '}
                {recipients.length === 1 ? 'address' : 'addresses'} from the next send
                onward. Turning this back on afterwards doesn&apos;t un-send them.
              </p>
            )}
          </div>

          <div>
            <p className="text-sm text-muted">
              {recipients.length} {recipients.length === 1 ? 'address' : 'addresses'} for{' '}
              {managerCount} managers.
              {recipients.length < managerCount && ' Someone is likely missing.'}
            </p>

            <ul className="mt-2 divide-y divide-line">
              {recipients.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0 truncate text-sm">
                    {r.name ? `${r.name} — ` : ''}
                    <span className="text-muted">{r.email}</span>
                  </span>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await removeRecipientAction({ leagueId, id: r.id })
                      })
                    }
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </Card>
  )
}
