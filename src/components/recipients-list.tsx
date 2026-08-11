'use client'

import { useState, useTransition } from 'react'

import {
  addRecipientsAction,
  removeRecipientAction,
  setEmailEnabledAction,
} from '@/app/setup/actions'

export interface Recipient {
  id: string
  email: string
  name: string | null
}

interface Props {
  leagueId: string
  initialRecipients: Recipient[]
  initialEmailEnabled: boolean
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
  managerCount,
}: Props) {
  const [enabled, setEnabled] = useState(initialEmailEnabled)
  const [raw, setRaw] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [pending, startTransition] = useTransition()

  const recipients = initialRecipients

  function add() {
    if (!raw.trim()) return
    startTransition(async () => {
      const result = await addRecipientsAction({ leagueId, raw })
      if (result.ok) {
        setStatus({ kind: 'added', added: result.added, skipped: result.skipped, invalid: result.invalid })
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

  return (
    <section className="flex flex-col gap-4 border-t border-neutral-200 pt-6 dark:border-neutral-800">
      <div>
        <h2 className="text-base font-semibold">Email digest</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Optional. WhatsApp needs no addresses — email does, and only you can supply them.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          disabled={pending}
          onChange={(e) => toggle(e.target.checked)}
        />
        Send this league&apos;s digest by email as well
      </label>

      {enabled && (
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
              placeholder="steve@example.com, Indigo Mwangi &lt;victor@example.com&gt;"
              className="rounded-lg border border-neutral-300 p-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
            <p className="text-xs text-neutral-500">
              Paste as many as you like — separated by commas, semicolons or new lines.
              Names in <code>Name &lt;address&gt;</code> form are kept.
            </p>
            <button
              type="button"
              onClick={add}
              disabled={pending || !raw.trim()}
              className="self-start rounded-lg bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
            >
              {pending ? 'Adding…' : 'Add to list'}
            </button>
          </div>

          {status.kind === 'added' && (
            <div className="rounded-lg bg-neutral-100 p-3 text-sm dark:bg-neutral-900">
              <p>
                Added {status.added}
                {status.skipped > 0 && `, ${status.skipped} already on the list`}.
              </p>
              {status.invalid.length > 0 && (
                <p className="mt-1 text-red-700 dark:text-red-300">
                  Couldn&apos;t read {status.invalid.length}:{' '}
                  <span className="font-mono">{status.invalid.join(', ')}</span>
                </p>
              )}
            </div>
          )}

          <div>
            <p className="text-sm text-neutral-500">
              {recipients.length} {recipients.length === 1 ? 'address' : 'addresses'} for{' '}
              {managerCount} managers.
              {recipients.length < managerCount && ' Someone is likely missing.'}
            </p>

            <ul className="mt-2 divide-y divide-neutral-200 dark:divide-neutral-800">
              {recipients.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="truncate">
                    {r.name ? `${r.name} — ` : ''}
                    <span className="text-neutral-500">{r.email}</span>
                  </span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await removeRecipientAction({ leagueId, id: r.id })
                      })
                    }
                    className="shrink-0 text-neutral-500 underline disabled:opacity-50"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  )
}
