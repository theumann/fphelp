'use client'

import { useState, useTransition } from 'react'

import { setDefaultBlocksAction } from '@/app/setup/actions'
import type { BlockSelection } from '@/lib/render/blocks'

import { Card } from './ui'

const BLOCKS: { key: keyof BlockSelection; label: string; hint: string }[] = [
  { key: 'gwResults', label: 'Gameweek results', hint: 'Winner, average, riser and faller' },
  { key: 'overallStandings', label: 'Season standings', hint: 'Full table with movement' },
  { key: 'prizeStructure', label: 'Prize structure', hint: 'Pot and prize breakdown' },
]

/**
 * What a new draft starts with.
 *
 * A default, not a rule: the composer can still tick and untick per message, and
 * `messages.blocks` records what each one actually included. So changing this never
 * rewrites what the league was already sent — it only changes where the next draft begins.
 *
 * The column has existed since the first schema and nothing could edit it; `/send`
 * hardcoded its own copy, which meant every owner got the same three choices no matter
 * what they wanted every week.
 */
export function DefaultBlocks({
  leagueId,
  initial,
}: {
  leagueId: string
  initial: BlockSelection
}) {
  const [blocks, setBlocks] = useState(initial)
  const [pending, startTransition] = useTransition()

  function toggle(key: keyof BlockSelection, value: boolean) {
    const next = { ...blocks, [key]: value }
    setBlocks(next)
    startTransition(async () => {
      await setDefaultBlocksAction({ leagueId, blocks: next })
    })
  }

  return (
    <Card
      title="Default message blocks"
      hint="Where each week's draft starts. You can still change them per message, and what you actually sent is recorded with it."
    >
      <ul className="flex flex-col gap-2">
        {BLOCKS.map(({ key, label, hint }) => (
          <li key={key}>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3">
              <input
                type="checkbox"
                checked={blocks[key]}
                disabled={pending}
                onChange={(e) => toggle(key, e.target.checked)}
                className="mt-0.5 size-4 accent-accent"
              />
              <span className="flex flex-col">
                <span className="text-sm font-medium">{label}</span>
                <span className="text-xs text-muted">{hint}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </Card>
  )
}
