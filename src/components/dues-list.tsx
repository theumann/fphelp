'use client'

import { useMemo, useState } from 'react'

import { setPaidAction } from '@/app/dues/actions'
import { formatCents } from '@/lib/digest/money'

import { Card, SummaryRow } from './ui'

interface Manager {
  entry: number
  entryName: string
  playerName: string
  pending: boolean
}

interface Props {
  leagueId: string
  managers: Manager[]
  initialPaid: Record<number, boolean>
  /** Cents. Null when the owner hasn't recorded an entry fee. */
  entryFeeCents: number | null
  /** Null until the league sets a pot — the collected total is still worth showing. */
  potCents: number | null
  currency: string
}

/**
 * Money coming in: who has paid their dues.
 *
 * A panel, not a page — the Dues page draws the shell and puts this beside the winnings
 * ledger. The paid count lives here rather than in the page header because it changes
 * with every tick, and a server-rendered subtitle would go stale on the first one.
 */
export function DuesList({
  leagueId,
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
    <>
      <Card title="Totals">
        {collectedCents !== null ? (
          <dl className="flex flex-col gap-1">
            <SummaryRow label="Collected" value={money(collectedCents)} />
            <SummaryRow label="Outstanding" value={money(outstandingCents!)} />
            <SummaryRow
              label="Pot entered at setup"
              value={potCents === null ? 'Not set' : money(potCents)}
              emphasis
            />
            {/* The pot is the owner's figure, not a derived one — so these can differ,
                and the difference is exactly what the treasurer is chasing. Nothing to
                chase until somebody has entered one, and `$0.00` would invent a target. */}
            {potCents !== null && collectedCents !== potCents && (
              <p className="mt-1 text-xs text-muted">
                {collectedCents < potCents
                  ? `${money(potCents - collectedCents)} of the pot is not yet collected.`
                  : `Collected exceeds the pot by ${money(collectedCents - potCents)} - check the pot figure in setup.`}
              </p>
            )}
          </dl>
        ) : (
          <p className="text-sm text-muted">
            Set an entry fee in setup to see totals collected and outstanding.
          </p>
        )}
      </Card>

      <Card
        title="Who has paid"
        hint="Tick a manager once their dues are in. Each tick saves straight away."
        aside={`${paidCount} of ${managers.length} paid`}
      >
        <ul className="flex flex-col divide-y divide-line">
          {managers.map((m) => (
            <li key={m.entry} className="flex items-center gap-3 py-3">
              <input
                id={`paid-${m.entry}`}
                type="checkbox"
                checked={Boolean(paid[m.entry])}
                disabled={saving === m.entry}
                onChange={(e) => toggle(m.entry, e.target.checked)}
                className="size-5 shrink-0 cursor-pointer accent-accent disabled:cursor-wait"
              />
              <label
                htmlFor={`paid-${m.entry}`}
                className="flex min-w-0 flex-1 cursor-pointer flex-col"
              >
                <span className="truncate text-sm font-medium">{m.entryName}</span>
                <span className="truncate text-xs text-muted">
                  {m.playerName}
                  {m.pending && ' · not yet scored'}
                </span>
              </label>
              {failed === m.entry && <span className="text-xs text-danger">Didn&apos;t save</span>}
            </li>
          ))}
        </ul>
      </Card>

      <p className="text-xs text-muted">
        Ticks track money coming in. Paying winnings out isn&apos;t tracked in the current
        app&apos;s version.
      </p>
    </>
  )
}
