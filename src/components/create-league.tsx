'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import {
  createLeagueAction,
  lookupLeagueAction,
  type LeagueLookup,
} from '@/app/league-actions'
import { Alert, Button, Card, Field, inputClass } from '@/components/ui'

/**
 * Claiming a league, in two steps: look it up, confirm what came back.
 *
 * The confirmation step is the point of the component. `leagues.fpl_league_id` is unique,
 * so a claim is first-come and awkward to undo — showing the real name and manager count
 * is what turns a mistyped digit into a visible mistake rather than a league sitting in
 * someone's account under a name they never read.
 *
 * The ID is deliberately a text input rather than `type="number"`: spinners on a
 * seven-digit identifier are meaningless, and the mobile numeric keypad is asked for with
 * `inputMode` instead. Validation belongs to the server anyway — `parseLeagueSegment` is
 * the same parser the URL uses.
 */
export function CreateLeague({ heading, hint }: { heading: string; hint?: string }) {
  const router = useRouter()
  const [raw, setRaw] = useState('')
  const [found, setFound] = useState<LeagueLookup | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function lookUp() {
    setError(null)
    startTransition(async () => {
      const result = await lookupLeagueAction(raw)
      if (result.ok) setFound(result)
      else {
        setFound(null)
        setError(result.error ?? 'Could not look that up.')
      }
    })
  }

  function claim() {
    setError(null)
    startTransition(async () => {
      const result = await createLeagueAction(raw)
      if (result.ok && result.path) {
        // `refresh` as well as `push`: the chooser at `/` is server-rendered and would
        // otherwise still be showing the list from before this league existed.
        router.push(result.path)
        router.refresh()
      } else {
        setFound(null)
        setError(result.error ?? 'Could not create that league.')
      }
    })
  }

  return (
    <Card title={heading} hint={hint}>
      <div className="flex flex-col gap-4">
        <Field
          label="FPL league ID"
          hint={
            <>
              The number from your league&apos;s URL —{' '}
              <code className="text-xs">/leagues/</code>
              <strong>2266630</strong>
              <code className="text-xs">/standings/c</code>. The invite code you send
              friends is <strong>not</strong> the ID.
            </>
          }
        >
          <input
            className={inputClass}
            value={raw}
            inputMode="numeric"
            autoComplete="off"
            placeholder="2266630"
            aria-label="FPL league ID"
            onChange={(e) => {
              setRaw(e.target.value)
              // Any edit invalidates what was looked up, or the confirm button would
              // claim a league other than the one on screen.
              setFound(null)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !found) {
                e.preventDefault()
                lookUp()
              }
            }}
          />
        </Field>

        {error && <Alert tone="danger">{error}</Alert>}

        {found ? (
          <div className="flex flex-col gap-3">
            <Alert tone="success">
              <span className="block font-medium">{found.name}</span>
              <span className="block text-xs">
                FPL league {found.fplLeagueId} · {found.managers}{' '}
                {found.managers === 1 ? 'manager' : 'managers'}
              </span>
            </Alert>

            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={claim} disabled={pending}>
                {pending ? 'Creating…' : 'Create this league'}
              </Button>
              <Button variant="ghost" onClick={() => setFound(null)} disabled={pending}>
                Not this one
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button
              variant="primary"
              onClick={lookUp}
              disabled={pending || raw.trim() === ''}
            >
              {pending ? 'Looking up…' : 'Look up'}
            </Button>
          </div>
        )}
      </div>
    </Card>
  )
}
