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

interface Props {
  leagueId: string
  leagueName: string
  fplLeagueId: number
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
    potTotal: s.potTotal ? String(s.potTotal) : '',
    currency: s.currency,
    entryFee: s.entryFee !== undefined ? String(s.entryFee) : '',
    gwWinnerAmount: String(s.gwWinnerAmount),
    seasonBestGwAmount: String(s.seasonBestGwAmount),
    rankPercentages: s.rankPercentages.map(String),
  }
}

function toSettings(d: Draft): LeagueSettings {
  return {
    potTotal: num(d.potTotal),
    currency: d.currency,
    entryFee: d.entryFee.trim() === '' ? undefined : num(d.entryFee),
    gwWinnerAmount: num(d.gwWinnerAmount),
    seasonBestGwAmount: num(d.seasonBestGwAmount),
    rankPercentages: d.rankPercentages.map(num),
  }
}

const field =
  'w-full rounded-lg border border-neutral-300 p-2.5 text-base dark:border-neutral-700 dark:bg-neutral-900'

export function SetupForm({
  leagueId,
  leagueName,
  fplLeagueId,
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

  const pctTotal = settings.rankPercentages.reduce((a, b) => a + b, 0)
  const feeSuggestion =
    settings.entryFee !== undefined && settings.entryFee > 0
      ? settings.entryFee * managers.length
      : null

  function setPct(index: number, value: string) {
    const next = [...draft.rankPercentages]
    next[index] = value
    setDraft({ ...draft, rankPercentages: next })
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
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 p-4 pb-10">
      <header>
        <h1 className="text-xl font-semibold">League setup</h1>
        <p className="text-sm text-neutral-500">
          {leagueName} · FPL league {fplLeagueId} · {managers.length} managers ·{' '}
          {gameweekCount} gameweeks
        </p>
      </header>

      {finalised && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          This season is finalised. Prize rules are locked — changing them now would
          rewrite winnings that have already been settled.
        </p>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">The pot</h2>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-sm">Currency</span>
            <input
              value={draft.currency}
              onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase() })}
              maxLength={3}
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm">Entry fee (optional)</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={draft.entryFee}
              onChange={(e) => setDraft({ ...draft, entryFee: e.target.value })}
              className={field}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Total pot</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={draft.potTotal}
            onChange={(e) => setDraft({ ...draft, potTotal: e.target.value })}
            className={field}
          />
          <span className="text-xs text-neutral-500">
            Entered directly rather than derived from the entry fee — some managers may
            not have paid, and the roster changes as people join.
          </span>
          {feeSuggestion !== null && feeSuggestion !== settings.potTotal && (
            <button
              type="button"
              onClick={() => setDraft({ ...draft, potTotal: String(feeSuggestion) })}
              className="self-start text-xs underline"
            >
              Use {managers.length} × {money(Math.round(settings.entryFee! * 100))} ={' '}
              {money(Math.round(feeSuggestion * 100))}
            </button>
          )}
        </label>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Fixed prizes</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-sm">Each gameweek winner</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={draft.gwWinnerAmount}
              onChange={(e) => setDraft({ ...draft, gwWinnerAmount: e.target.value })}
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm">Best gameweek of season</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={draft.seasonBestGwAmount}
              onChange={(e) => setDraft({ ...draft, seasonBestGwAmount: e.target.value })}
              className={field}
            />
          </label>
        </div>

        {/* The arithmetic that is easy to get wrong: fixed prizes come off the top. */}
        <dl className="rounded-lg bg-neutral-100 p-3 text-sm dark:bg-neutral-900">
          <div className="flex justify-between">
            <dt>Pot</dt>
            <dd>{money(pot.potCents)}</dd>
          </div>
          <div className="flex justify-between text-neutral-500">
            <dt>
              Fixed prizes ({gameweekCount} × {money(summary.gwWinnerCents)} + best GW)
            </dt>
            <dd>−{money(pot.committedFixedCents)}</dd>
          </div>
          <div className="mt-1 flex justify-between border-t border-neutral-300 pt-1 font-medium dark:border-neutral-700">
            <dt>Remainder for final table</dt>
            <dd className={pot.remainderCents < 0 ? 'text-red-600' : ''}>
              {money(pot.remainderCents)}
            </dd>
          </div>
        </dl>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium">Paid places</h2>
          <span className={pctTotal === 100 ? 'text-xs text-neutral-500' : 'text-xs text-red-600'}>
            {pctTotal}% of {money(pot.remainderCents)}
          </span>
        </div>

        {draft.rankPercentages.map((pct, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-6 text-sm text-neutral-500">{i + 1}.</span>
            <div className="relative flex-1">
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={pct}
                onChange={(e) => setPct(i, e.target.value)}
                className={`${field} pr-7`}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-neutral-500">
                %
              </span>
            </div>
            <span className="w-24 text-right text-sm tabular-nums">
              {money(summary.rankPrizeCents[i] ?? 0)}
            </span>
            <button
              type="button"
              onClick={() =>
                setDraft({
                  ...draft,
                  rankPercentages: draft.rankPercentages.filter((_, j) => j !== i),
                })
              }
              className="text-sm text-neutral-500 underline"
            >
              Remove
            </button>
          </div>
        ))}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() =>
              setDraft({ ...draft, rankPercentages: [...draft.rankPercentages, ''] })
            }
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700"
          >
            Add a place
          </button>
          <button
            type="button"
            onClick={() =>
              setDraft({
                ...draft,
                rankPercentages: suggestPercentages(draft.rankPercentages.length).map(String),
              })
            }
            disabled={draft.rankPercentages.length === 0}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm disabled:opacity-40 dark:border-neutral-700"
          >
            Suggest percentages
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Your team</h2>
        <select
          value={managerEntry ?? ''}
          onChange={(e) => setManagerEntry(e.target.value === '' ? null : Number(e.target.value))}
          className={field}
        >
          <option value="">I don&apos;t play in this league</option>
          {managers.map((m) => (
            <option key={m.entry} value={m.entry}>
              {m.entryName} ({m.playerName})
            </option>
          ))}
        </select>
        <span className="text-xs text-neutral-500">
          Used to sign the messages you send. Each owner sets their own.
        </span>
      </section>

      {errors.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-lg bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-200">
          {errors.map((e, i) => (
            <li key={i}>{describeError(e)}</li>
          ))}
        </ul>
      )}

      {result && (
        <p
          className={`rounded-lg p-3 text-sm ${
            result.ok
              ? 'bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-200'
              : 'bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200'
          }`}
        >
          {result.ok ? 'Saved.' : result.errors.join(' ')}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={saving || errors.length > 0 || finalised}
        className="rounded-lg bg-neutral-900 p-3 text-base font-medium text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
      >
        {saving ? 'Saving…' : 'Save settings'}
      </button>
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
