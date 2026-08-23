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
  /** Only the count is used, for the "more places than managers" check. */
  managerCount: number
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
  expenses: { label: string; amount: string }[]
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
    expenses: s.expenses.map((e) => ({ label: e.label, amount: String(e.amount) })),
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
    expenses: d.expenses.map((e) => ({ label: e.label, amount: num(e.amount) })),
  }
}

export function SetupForm({
  leagueId,
  initial,
  gameweekCount,
  managerCount,
  finalised,
}: Props) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial))
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; errors: string[] } | null>(null)

  const settings = useMemo(() => toSettings(draft), [draft])
  const errors = useMemo(
    () => validateSettings(settings, gameweekCount, managerCount),
    [settings, gameweekCount, managerCount],
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
   * Worth tracking because this panel is the only one that saves on a button — the
   * people and message settings write on every click. The bar only appears when there is
   * something to lose, which is what makes the difference legible instead of arbitrary.
   */
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(initial))

  const pctTotal = settings.rankPercentages.reduce((a, b) => a + b, 0)
  const feeSuggestion =
    settings.entryFee !== undefined && settings.entryFee > 0
      ? settings.entryFee * managerCount
      : null

  function edit(patch: Partial<Draft>) {
    setDraft({ ...draft, ...patch })
    setResult(null)
  }

  function setExpense(index: number, patch: Partial<{ label: string; amount: string }>) {
    const next = [...draft.expenses]
    next[index] = { ...next[index], ...patch }
    edit({ expenses: next })
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
        managerCount,
      }),
    )
    setSaving(false)
  }

  return (
    <div className="flex flex-col gap-5">
      {finalised && (
        <Alert tone="warning">
          This season is finalised. Prize rules are locked - changing them now would
          rewrite winnings that have already been settled.
        </Alert>
      )}

      <Card title="The pot">
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
            Use {managerCount} × {money(Math.round(settings.entryFee! * 100))} ={' '}
            {money(Math.round(feeSuggestion * 100))}
          </Button>
        )}
      </Card>

      {/* Between the pot and the prizes because that is the order the money moves in:
          collected, spent, then shared out. */}
      <Card
        title="League expenses"
        hint="Costs paid out of the pot before any prize. Each label is printed in the digest."
        aside={
          <span className="text-muted">
            {pot.expensesCents > 0 ? `−${money(pot.expensesCents)}` : 'None'}
          </span>
        }
      >
        <ul className="flex flex-col gap-2">
          {draft.expenses.map((expense, i) => (
            <li key={i} className="flex items-center gap-2">
              {/* Sizing lives on the wrapper, never appended to `inputClass`: it already
                  carries `w-full`, and a second width utility on the same element is
                  resolved by stylesheet order rather than by the order written here. The
                  paid-places list below does the same for the same reason. `min-w-0` lets
                  the label field actually shrink — a flex item's default floor is its
                  content width, which is what pushes the amount box out of the card. */}
              <div className="min-w-0 flex-1">
                <input
                  aria-label={`Expense ${i + 1} label`}
                  placeholder="Trophy engraving"
                  value={expense.label}
                  onChange={(e) => setExpense(i, { label: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div className="w-28 shrink-0">
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  aria-label={`Expense ${i + 1} amount`}
                  value={expense.amount}
                  onChange={(e) => setExpense(i, { amount: e.target.value })}
                  className={inputClass}
                />
              </div>
              <Button
                variant="danger"
                size="sm"
                aria-label={`Remove expense ${i + 1}`}
                onClick={() => edit({ expenses: draft.expenses.filter((_, j) => j !== i) })}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>

        <Button
          size="sm"
          className="self-start"
          onClick={() => edit({ expenses: [...draft.expenses, { label: '', amount: '' }] })}
        >
          Add an expense
        </Button>
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
          {/* Only when there are any: a permanent "Expenses −$0.00" row would suggest a
              deduction to every league that has none. */}
          {pot.expensesCents > 0 && (
            <SummaryRow label="League expenses" value={`−${money(pot.expensesCents)}`} />
          )}
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
          three cards of scroll on a phone. It lives inside the panel it belongs to, which
          is now also the only panel with anything to save. */}
      <div className="sticky bottom-0 -mx-4 border-t border-line bg-background/95 px-4 py-3 backdrop-blur sm:-mx-5 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted">
            {finalised
              ? 'Locked - the season is finalised.'
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
      return error.expensesCents > 0
        ? 'Fixed prizes and expenses cost more than the pot holds.'
        : 'Fixed prizes cost more than the pot holds.'
    case 'expense-missing-label':
      return `Expense ${error.index + 1} needs a name - the digest prints it.`
    case 'non-positive-expense':
      return error.label === ''
        ? 'An expense is worth nothing - remove it instead.'
        : `“${error.label}” is worth nothing - remove it instead.`
    case 'percentages-not-100':
      return `Place percentages add up to ${error.sum}%, not 100%.`
    case 'no-paid-places':
      return 'Add at least one paid place.'
    case 'non-positive-percentage':
      return `Place ${error.rank} is worth nothing - remove it instead.`
    case 'more-places-than-managers':
      return `${error.places} paid places but only ${error.managers} managers.`
  }
}
