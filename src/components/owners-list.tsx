'use client'

import { useState, useTransition } from 'react'

import { addOwnerAction, removeOwnerAction } from '@/app/setup/actions'
import type { Owner } from '@/db/queries'

import { Alert, Button, Card, inputClass } from './ui'

interface Props {
  leagueId: string
  owners: Owner[]
  /** The signed-in owner, so their own row can be marked and its Remove suppressed. */
  currentUserId: string
}

type Status =
  | { kind: 'idle' }
  | { kind: 'added'; email: string }
  | { kind: 'already'; email: string }
  | { kind: 'error'; message: string }

/**
 * The league's owners.
 *
 * This replaces the two things that used to be the only ways to create an owner: the
 * `BOOTSTRAP_OWNER_EMAIL` deploy script and editing the database by hand. Neither was
 * reachable by the person who actually needs a co-owner added, which made a closed
 * membership model safe but unworkable.
 *
 * It is not an invite flow. Adding an address grants access; it sends nothing. The new
 * owner is in once they request a sign-in link themselves.
 */
export function OwnersList({ leagueId, owners, currentUserId }: Props) {
  const [raw, setRaw] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [pending, startTransition] = useTransition()

  function add() {
    if (!raw.trim()) return
    startTransition(async () => {
      const result = await addOwnerAction({ leagueId, raw })
      if (!result.ok) {
        setStatus({ kind: 'error', message: result.error })
        return
      }
      setStatus(
        result.outcome === 'added'
          ? { kind: 'added', email: result.email }
          : { kind: 'already', email: result.email },
      )
      // Cleared only once the address is accepted, so a typo stays editable.
      setRaw('')
    })
  }

  function remove(userId: string) {
    startTransition(async () => {
      const result = await removeOwnerAction({ leagueId, userId })
      if (!result.ok) setStatus({ kind: 'error', message: result.error })
      else setStatus({ kind: 'idle' })
    })
  }

  return (
    <Card
      title="Owners"
      hint="Who can compose, send and change these settings. Everyone listed can do everything."
      aside={`${owners.length}`}
    >
      <ul className="divide-y divide-line">
        {owners.map((owner) => {
          const isYou = owner.userId === currentUserId
          return (
            <li key={owner.userId} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {owner.name ?? owner.email}
                  {isYou && <span className="ml-2 text-xs font-normal text-muted">you</span>}
                </p>
                <p className="truncate text-xs text-muted">
                  {owner.name ? `${owner.email} · ` : ''}
                  {owner.hasSignedIn ? 'Has signed in' : 'Has not signed in yet'}
                </p>
              </div>

              {/* Self-removal is refused server-side too; hiding it keeps the rule visible
                  rather than making it a surprise. */}
              {!isYou && owners.length > 1 && (
                <Button
                  variant="danger"
                  size="sm"
                  disabled={pending}
                  onClick={() => remove(owner.userId)}
                >
                  Remove
                </Button>
              )}
            </li>
          )
        })}
      </ul>

      <div className="flex flex-col gap-2">
        <label htmlFor="new-owner" className="text-sm font-medium">
          Add an owner
        </label>
        <div className="flex gap-2">
          <input
            id="new-owner"
            type="email"
            inputMode="email"
            autoComplete="off"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              }
            }}
            placeholder="co-owner@example.com"
            className={inputClass}
          />
          <Button variant="primary" onClick={add} disabled={pending || !raw.trim()}>
            {pending ? 'Adding…' : 'Add'}
          </Button>
        </div>
        <p className="text-xs leading-relaxed text-muted">
          Nothing is emailed. This only allows the address to sign in — they still have to
          request a link from the sign-in page themselves.
        </p>
      </div>

      {status.kind === 'added' && (
        <Alert tone="success">
          {status.email} can now sign in. Tell them to request a link.
        </Alert>
      )}
      {status.kind === 'already' && (
        <Alert>{status.email} is already an owner of this league.</Alert>
      )}
      {status.kind === 'error' && <Alert tone="danger">{status.message}</Alert>}
    </Card>
  )
}
