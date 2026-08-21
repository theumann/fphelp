'use client'

import { useMemo, useState } from 'react'

import { saveSettingsAction } from '@/app/setup/actions'
import { formatCents } from '@/lib/digest/money'
import { computePot } from '@/lib/digest/prizes'
import {
  summarise,
  suggestPercentages,
  toPrizeConfig,
  validateSettings,
  type LeagueSettings,
} from '@/lib/league-settings'

import { Alert, Button, Card, Field, SummaryRow, inputClass } from './ui'

interface Props {
  leagueId: string
  initial: LeagueSettings
  gameweekCount: number
  managers: { entry: number; entryName: string; playerName: string }[]
  initialManagerEntry: number | null
  finalised: boolean
}

/**
 * The form holds every numeric field as a string.
 *
 * Binding a number directly to an input means clearing the box produces `Number('')`,
 * which is 0 — so the field refills itself with a leading zero the moment you delete
 * its contents. Strings let a field be genuinely empty while being edited; parsing
 * happens once, for computation.
 */
interface Draft {
  potTotal: string
  currency: string
  entryFee: string
  gwWinnerAmount: string
  seasonBestGwAmount: string
  rankPercentages: string[]
}

const num = (s: string) => (s.trim() === '' ? 0 : Number(s))

function toDraft(s: LeagueSettings): Draft {
  return {
    potTotal: s.potTotal !== undefined ? String(s.potTotal) : '',
    currency: s.currency,
    entryFee: s.entryFee !== undefined ? String(s.entryFee) : '',
    gwWinnerAmount: String(s.gwWinnerAmount),
    seasonBestGwAmount: String(s.seasonBestGwAmount),
    rankPercentages: s.rankPercentages.map(String),
  }
}

function toSettings(d: Draft): LeagueSettings {
  return {
    // Empty means unset, not zero — see `LeagueSettings.potTotal`.
    potTotal: d.potTotal.trim() === '' ? undefined : num(d.potTotal),
    currency: d.currency,
    entryFee: d.entryFee.trim() === '' ? undefined : num(d.entryFee),
    gwWinnerAmount: num(d.gwWinnerAmount),
    seasonBestGwAmount: num(d.seasonBestGwAmount),
    rankPercentages: d.rankPercentages.map(num),
  }
}

export function SetupForm({
  leagueId,
  initial,
  gameweekCount,
  managers,
  initialManagerEntry,
  finalised,
}: Props) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial))
  const [managerEntry, setManagerEntry] = useState<number | null>(initialManagerEntry)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; errors: string[] } | null>(null)

  const settings = useMemo(() => toSettings(draft), [draft])
  const errors = useMemo(
    () => validateSettings(settings, gameweekCount, managers.length),
    [settings, gameweekCount, managers.length],
  )
  const pot = useMemo(
    () => computePot(toPrizeConfig(settings, gameweekCount)),
    [settings, gameweekCount],
  )
  const summary = useMemo(() => summarise(settings, gameweekCount), [settings, gameweekCount])
  const money = (cents: number) => formatCents(cents, settings.currency || 'USD')

  /**
   * Whether anything is unsaved.
   *
   * Worth tracking because this section saves on a button while the lists below it save
   * on every click — two save models on one page. The bar only appears when there is
   * something to lose, which is what makes the difference legible instead of arbitrary.
   */
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(toDraft(initial)) ||
    managerEntry !== initialManagerEntry

  const pctTotal = settings.rankPercentages.reduce((a, b) => a + b, 0)
  const feeSuggestion =
    settings.entryFee !== undefined && settings.entryFee > 0
      ? settings.entryFee * managers.length
      : null

  function edit(patch: Partial<Draft>) {
    setDraft({ ...draft, ...patch })
    setResult(null)
  }

  function setPct(index: number, value: string) {
    const next = [...draft.rankPercentages]
    next[index] = value
    edit({ rankPercentages: next })
  }

  async function submit() {
    setSaving(true)
    setResult(
      await saveSettingsAction({
        leagueId,
        settings,
        gameweekCount,
        managerCount: managers.length,
        managerEntry,
      }),
    )
    setSaving(false)
  }

  return (
    <div className="flex flex-col gap-5">
      {finalised && (
        <Alert tone="warning">
          This season is finalised. Prize rules are locked — changing them now would
          rewrite winnings that have already been settled.
        </Alert>
      )}

      <Card
        title="The pot"
        hint="Entered directly rather than derived from the entry fee — some managers may not have paid, and the roster changes as people join."
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Currency">
            <input
              value={draft.currency}
              onChange={(e) => edit({ currency: e.target.value.toUpperCase() })}
              maxLength={3}
              className={inputClass}
            />
          </Field>
          <Field label="Entry fee (optional)">
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={draft.entryFee}
              onChange={(e) => edit({ entryFee: e.target.value })}
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Total pot">
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={draft.potTotal}
            onChange={(e) => edit({ potTotal: e.target.value })}
            className={inputClass}
          />
        </Field>

        {feeSuggestion !== null && feeSuggestion !== settings.potTotal && (
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={() => edit({ potTotal: String(feeSuggestion) })}
          >
            Use {managers.length} × {money(Math.round(settings.entryFee! * 100))} ={' '}
            {money(Math.round(feeSuggestion * 100))}
          </Button>
        )}
      </Card>

      <Card
        title="Fixed prizes"
        hint="Paid off the top. Whatever is left is what the final table shares."
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Each gameweek winner">
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={draft.gwWinnerAmount}
              onChange={(e) => edit({ gwWinnerAmount: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Best gameweek of season">
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={draft.seasonBestGwAmount}
              onChange={(e) => edit({ seasonBestGwAmount: e.target.value })}
              className={inputClass}
            />
          </Field>
        </div>

        {/* The arithmetic that is easy to get wrong: fixed prizes come off the top. */}
        <dl className="rounded-lg bg-surface-muted p-3">
          <SummaryRow label="Pot" value={pot.potSet ? money(pot.potCents) : 'Not set'} />
          <SummaryRow
            label={`Fixed prizes (${gameweekCount} × ${money(summary.gwWinnerCents)} + best GW)`}
            value={`−${money(pot.committedFixedCents)}`}
          />
          {/* Without a pot the remainder is minus the fixed commitments — true, and a
              figure nobody should read. */}
          <SummaryRow
            label="Remainder for final table"
            value={pot.potSet ? money(pot.remainderCents) : '—'}
            emphasis
            tone={pot.potSet && pot.remainderCents < 0 ? 'danger' : undefined}
          />
        </dl>
      </Card>

      <Card
        title="Paid places"
        hint="Percentages of the remainder, not of the pot."
        aside={
          <span className={pctTotal === 100 ? '' : 'font-medium text-danger'}>
            {pctTotal}% of {pot.potSet ? money(pot.remainderCents) : 'the remainder'}
          </span>
        }
      >
        <ul className="flex flex-col gap-2">
          {draft.rankPercentages.map((pct, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-sm tabular-nums text-muted">{i + 1}.</span>
              <div className="relative flex-1">
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  aria-label={`Percentage for place ${i + 1}`}
                  value={pct}
                  onChange={(e) => setPct(i, e.target.value)}
                  className={`${inputClass} pr-7`}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">
                  %
                </span>
              </div>
              <span className="w-24 shrink-0 text-right text-sm tabular-nums">
                {pot.potSet ? money(summary.rankPrizeCents[i] ?? 0) : '—'}
              </span>
              <Button
                variant="danger"
                size="sm"
                aria-label={`Remove place ${i + 1}`}
                onClick={() =>
                  edit({ rankPercentages: draft.rankPercentages.filter((_, j) => j !== i) })
                }
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>

        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => edit({ rankPercentages: [...draft.rankPercentages, ''] })}
          >
            Add a place
          </Button>
          <Button
            size="sm"
            disabled={draft.rankPercentages.length === 0}
            onClick={() =>
              edit({
                rankPercentages: suggestPercentages(draft.rankPercentages.length).map(String),
              })
            }
          >
            Suggest percentages
          </Button>
        </div>
      </Card>

      <Card title="Your team" hint="Used to sign the messages you send. Each owner sets their own.">
        <select
          aria-label="Your FPL team in this league"
          value={managerEntry ?? ''}
          onChange={(e) => {
            setManagerEntry(e.target.value === '' ? null : Number(e.target.value))
            setResult(null)
          }}
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

      {errors.length > 0 && (
        <Alert tone="danger">
          <ul className="flex flex-col gap-1">
            {errors.map((e, i) => (
              <li key={i}>{describeError(e)}</li>
            ))}
          </ul>
        </Alert>
      )}

      {result && (
        <Alert tone={result.ok ? 'success' : 'danger'}>
          {result.ok ? 'Settings saved.' : result.errors.join(' ')}
        </Alert>
      )}

      {/* Sticky while these settings are on screen, so the save button is never below
          three cards of scroll on a phone. It scrolls away with the section it belongs
          to, which keeps it from claiming the lists further down the page. */}
      <div className="sticky bottom-0 -mx-4 border-t border-line bg-background/95 px-4 py-3 backdrop-blur sm:-mx-5 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted">
            {finalised
              ? 'Locked — the season is finalised.'
              : dirty
                ? 'Unsaved changes'
                : 'All changes saved'}
          </span>
          <Button
            variant="primary"
            onClick={submit}
            disabled={saving || errors.length > 0 || finalised || !dirty}
          >
            {saving ? 'Saving…' : 'Save settings'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function describeError(error: ReturnType<typeof validateSettings>[number]): string {
  switch (error.code) {
    case 'fixed-exceeds-pot':
      return 'Fixed prizes cost more than the pot holds.'
    case 'percentages-not-100':
      return `Place percentages add up to ${error.sum}%, not 100%.`
    case 'no-paid-places':
      return 'Add at least one paid place.'
    case 'non-positive-percentage':
      return `Place ${error.rank} is worth nothing — remove it instead.`
    case 'more-places-than-managers':
      return `${error.places} paid places but only ${error.managers} managers.`
  }
}
