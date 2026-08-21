'use client'

import { useMemo, useState } from 'react'

import { setPaidAction } from '@/app/dues/actions'
import { formatCents } from '@/lib/digest/money'

interface Manager {
  entry: number
  entryName: string
  playerName: string
  pending: boolean
}

interface Props {
  leagueId: string
  leagueName: string
  managers: Manager[]
  initialPaid: Record<number, boolean>
  /** Cents. Null when the owner hasn't recorded an entry fee. */
  entryFeeCents: number | null
  /** Null until the league sets a pot — the collected total is still worth showing. */
  potCents: number | null
  currency: string
}

export function DuesList({
  leagueId,
  leagueName,
  managers,
  initialPaid,
  entryFeeCents,
  potCents,
  currency,
}: Props) {
  const [paid, setPaid] = useState<Record<number, boolean>>(initialPaid)
  const [saving, setSaving] = useState<number | null>(null)
  const [failed, setFailed] = useState<number | null>(null)

  const money = (cents: number) => formatCents(cents, currency)
  const paidCount = useMemo(
    () => managers.filter((m) => paid[m.entry]).length,
    [managers, paid],
  )

  const collectedCents = entryFeeCents !== null ? paidCount * entryFeeCents : null
  const outstandingCents =
    entryFeeCents !== null ? (managers.length - paidCount) * entryFeeCents : null

  async function toggle(entry: number, next: boolean) {
    // Optimistic: the checkbox should feel instant when ticking through a list.
    setPaid((p) => ({ ...p, [entry]: next }))
    setSaving(entry)
    setFailed(null)

    const result = await setPaidAction({ leagueId, entry, paid: next })
    if (!result.ok) {
      setPaid((p) => ({ ...p, [entry]: !next }))
      setFailed(entry)
    }
    setSaving(null)
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5 p-4 pb-10">
      <header>
        <h1 className="text-xl font-semibold">Dues</h1>
        <p className="text-sm text-neutral-500">
          {leagueName} · {paidCount} of {managers.length} paid
        </p>
      </header>

      <dl className="rounded-lg bg-neutral-100 p-3 text-sm dark:bg-neutral-900">
        {collectedCents !== null ? (
          <>
            <div className="flex justify-between">
              <dt>Collected</dt>
              <dd className="tabular-nums">{money(collectedCents)}</dd>
            </div>
            <div className="flex justify-between text-neutral-500">
              <dt>Outstanding</dt>
              <dd className="tabular-nums">{money(outstandingCents!)}</dd>
            </div>
            <div className="mt-1 flex justify-between border-t border-neutral-300 pt-1 dark:border-neutral-700">
              <dt>Pot entered at setup</dt>
              <dd className="tabular-nums">{potCents === null ? 'Not set' : money(potCents)}</dd>
            </div>
            {/* The pot is the owner's figure, not a derived one — so these can differ,
                and the difference is exactly what the treasurer is chasing. Nothing to
                chase until somebody has entered one, and `$0.00` would invent a target. */}
            {potCents !== null && collectedCents !== potCents && (
              <p className="mt-2 text-xs text-neutral-500">
                {collectedCents < potCents
                  ? `${money(potCents - collectedCents)} of the pot is not yet collected.`
                  : `Collected exceeds the pot by ${money(collectedCents - potCents)} — check the pot figure in setup.`}
              </p>
            )}
          </>
        ) : (
          <p className="text-neutral-500">
            Set an entry fee in setup to see totals collected and outstanding.
          </p>
        )}
      </dl>

      <ul className="flex flex-col divide-y divide-neutral-200 dark:divide-neutral-800">
        {managers.map((m) => (
          <li key={m.entry} className="flex items-center gap-3 py-3">
            <input
              id={`paid-${m.entry}`}
              type="checkbox"
              checked={Boolean(paid[m.entry])}
              disabled={saving === m.entry}
              onChange={(e) => toggle(m.entry, e.target.checked)}
              className="size-5 shrink-0"
            />
            <label htmlFor={`paid-${m.entry}`} className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">{m.entryName}</span>
              <span className="truncate text-xs text-neutral-500">
                {m.playerName}
                {m.pending && ' · not yet scored'}
              </span>
            </label>
            {failed === m.entry && <span className="text-xs text-red-600">Didn&apos;t save</span>}
          </li>
        ))}
      </ul>

      <p className="text-xs text-neutral-500">
        Tracks money coming in. Prize money owed out is computed from the final standings
        — paying it out isn&apos;t tracked here yet.
      </p>
    </div>
  )
}
