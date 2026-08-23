'use client'

import { useState, useTransition } from 'react'

import { setManagerEntryAction } from '@/app/setup/actions'

import { Card, inputClass } from './ui'

/**
 * The signed-in owner's own FPL entry.
 *
 * Per-owner, not per-league: co-owners each pick their own team and sign differently, and
 * an owner who does not play in the league they administer picks nothing. That is why it
 * lives with the people settings rather than with the pot, and why it saves on change
 * like the other per-click settings instead of behind the money form's Save button.
 */
export function YourTeam({
  leagueId,
  managers,
  initial,
}: {
  leagueId: string
  managers: { entry: number; entryName: string; playerName: string }[]
  initial: number | null
}) {
  const [managerEntry, setManagerEntry] = useState<number | null>(initial)
  const [pending, startTransition] = useTransition()

  function choose(value: string) {
    const next = value === '' ? null : Number(value)
    setManagerEntry(next)
    startTransition(async () => {
      await setManagerEntryAction({ leagueId, managerEntry: next })
    })
  }

  return (
    <Card
      title="Your team"
      hint="Used to sign the messages you send. Each owner sets their own."
      aside={pending ? <span>Saving…</span> : undefined}
    >
      <select
        aria-label="Your FPL team in this league"
        value={managerEntry ?? ''}
        disabled={pending}
        onChange={(e) => choose(e.target.value)}
        className={inputClass}
      >
        <option value="">I don&apos;t play in this league</option>
        {managers.map((m) => (
          <option key={m.entry} value={m.entry}>
            {m.entryName} ({m.playerName})
          </option>
        ))}
      </select>
    </Card>
  )
}
