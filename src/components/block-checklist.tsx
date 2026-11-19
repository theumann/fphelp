'use client'

import { dependsOnGameweek, type BlockSelection } from '@/lib/render/blocks'

/**
 * The three message blocks, with the line that says what each one contains.
 *
 * One list for every place that offers them — the composer's two tabs and Setup's
 * defaults. There were three copies, and the email tab's had lost its descriptions.
 * The description sits under the label rather than in a tooltip because the owner is
 * on a phone, where there is no hover to reveal one.
 */
const BLOCK_OPTIONS: { key: keyof BlockSelection; label: string; hint: string }[] = [
  { key: 'gwResults', label: 'Gameweek results', hint: 'Winner, average, riser and faller' },
  { key: 'overallStandings', label: 'Season standings', hint: 'Full table with movement' },
  { key: 'prizeStructure', label: 'Prize structure', hint: 'Pot and prize breakdown' },
]

/**
 * Rows divided by rules, meant to sit inside a `Card`: they are one choice about one
 * message, and a bordered box per row read as three separate things.
 *
 * `statsReady: false` withholds the blocks built from scores, and explains why under the
 * rows — by the time it is read, the greyed-out rows it refers to have been seen.
 */
export function BlockChecklist({
  blocks,
  onChange,
  statsReady = true,
  disabled = false,
}: {
  blocks: BlockSelection
  onChange: (key: keyof BlockSelection, checked: boolean) => void
  statsReady?: boolean
  disabled?: boolean
}) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="sr-only">Include</legend>

      <ul className="flex flex-col divide-y divide-line">
        {BLOCK_OPTIONS.map(({ key, label, hint }) => {
          // Only the two built from scores. The prize figures come from the league's
          // settings and do not move because a match is being played.
          const withheld = !statsReady && dependsOnGameweek(key)
          return (
            <li key={key} className="py-3 first:pt-0 last:pb-0">
              <label
                className={`flex items-start gap-3 ${withheld ? 'opacity-50' : 'cursor-pointer'}`}
              >
                <input
                  type="checkbox"
                  disabled={withheld || disabled}
                  checked={!withheld && blocks[key]}
                  onChange={(e) => onChange(key, e.target.checked)}
                  className="mt-0.5 size-4 accent-accent"
                />
                <span className="flex flex-col">
                  <span className="text-sm font-medium">{label}</span>
                  <span className="text-xs text-muted">{hint}</span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>

      {!statsReady && (
        <p className="rounded-lg bg-warning-surface p-3 text-xs leading-relaxed text-warning">
          Gameweek in progress. Results and standings will be available when we have the
          current gameweek&apos;s final results.
        </p>
      )}
    </fieldset>
  )
}
