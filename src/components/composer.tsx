'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { markSentAction, saveDraftAction } from '@/app/send/actions'
import type { DigestStats } from '@/lib/digest/stats'
import type { BlockSelection, PrizeSummary } from '@/lib/render/blocks'
import { DEFAULT_BUDGET } from '@/lib/render/budget'
import { composeMessage } from '@/lib/render/compose'
import { buildWhatsAppLinks } from '@/lib/render/whatsapp'

interface Props {
  stats: DigestStats
  prize: PrizeSummary
  signature: string
  defaultBlocks: BlockSelection
  leagueName: string
  /** Absent in demo mode, where nothing is persisted. */
  persistence?: {
    leagueId: string
    digestId: string
    messageId?: string
    initialBody: string
    initialBlocks: BlockSelection
    sentAt?: string
  }
}

const BLOCK_LABELS: { key: keyof BlockSelection; label: string; hint: string }[] = [
  { key: 'gwResults', label: 'Gameweek results', hint: 'Winner, average, riser and faller' },
  { key: 'overallStandings', label: 'Overall standings', hint: 'Full table with movement' },
  { key: 'prizeStructure', label: 'Prize structure', hint: 'Pot and prize breakdown' },
]

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export function Composer({
  stats,
  prize,
  signature,
  defaultBlocks,
  leagueName,
  persistence,
}: Props) {
  const [body, setBody] = useState(persistence?.initialBody ?? '')
  const [blocks, setBlocks] = useState<BlockSelection>(
    persistence?.initialBlocks ?? defaultBlocks,
  )
  const [copied, setCopied] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [sentAt, setSentAt] = useState(persistence?.sentAt)
  const messageIdRef = useRef(persistence?.messageId)

  // composeMessage is a pure function, so toggling a block re-renders from the same
  // stored stats — no refetch.
  const composed = useMemo(
    () => composeMessage({ body, blocks, stats, prize, signature }),
    [body, blocks, stats, prize, signature],
  )

  const links = useMemo(() => buildWhatsAppLinks(composed.text), [composed.text])
  const { used, remaining, overBudget } = composed.budget
  const pct = Math.min(100, (used / DEFAULT_BUDGET) * 100)

  const save = useCallback(async () => {
    if (!persistence) return
    setSaveState('saving')
    try {
      const result = await saveDraftAction({
        leagueId: persistence.leagueId,
        digestId: persistence.digestId,
        messageId: messageIdRef.current,
        body,
        blocks,
      })
      messageIdRef.current = result.messageId
      setSaveState('saved')
    } catch {
      setSaveState('error')
    }
  }, [persistence, body, blocks])

  // Debounced autosave. The draft is shared between co-owners, so leaving it only in
  // local state would let two people write the same week's update independently.
  useEffect(() => {
    if (!persistence) return
    // Reference comparison is deliberate: `blocks` is only replaced when the owner
    // toggles something, so an untouched form skips the initial save.
    if (body === persistence.initialBody && blocks === persistence.initialBlocks) return

    const timer = setTimeout(save, 800)
    return () => clearTimeout(timer)
  }, [body, blocks, persistence, save])

  async function copy() {
    try {
      await navigator.clipboard.writeText(composed.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  async function recordSend() {
    if (!persistence || !messageIdRef.current) return
    try {
      const result = await markSentAction({
        messageId: messageIdRef.current,
        sentText: composed.text,
      })
      setSentAt(result.sentAt)
    } catch {
      // Recording is best-effort; the message may well have been sent regardless.
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5 p-4 pb-28">
      <header>
        <h1 className="text-xl font-semibold">{leagueName}</h1>
        <p className="text-sm text-neutral-500">
          Gameweek {stats.gameweek} · {stats.standings.length} managers
          {stats.pendingCount > 0 && ` · ${stats.pendingCount} not yet scored`}
        </p>
      </header>

      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium">Your message</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          placeholder="Write this week's update…"
          className="w-full resize-y rounded-lg border border-neutral-300 bg-white p-3 text-base text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Include</legend>
        {BLOCK_LABELS.map(({ key, label, hint }) => (
          <label
            key={key}
            className="flex items-start gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
          >
            <input
              type="checkbox"
              checked={blocks[key]}
              onChange={(e) => setBlocks({ ...blocks, [key]: e.target.checked })}
              className="mt-1 size-4"
            />
            <span className="flex flex-col">
              <span className="text-sm font-medium">{label}</span>
              <span className="text-xs text-neutral-500">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium">Length</span>
          <span className={overBudget ? 'font-medium text-red-600' : 'text-neutral-500'}>
            {used} / {DEFAULT_BUDGET}
            {overBudget ? ` · ${Math.abs(remaining)} over` : ` · ${remaining} left`}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
          <div
            className={`h-full transition-all ${overBudget ? 'bg-red-600' : 'bg-green-600'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {composed.truncatedRows > 0 && (
          <p className="text-xs text-amber-600">
            Standings trimmed by {composed.truncatedRows} rows to fit.
          </p>
        )}
        {persistence && (
          <p className="text-xs text-neutral-500">
            {saveState === 'saving' && 'Saving…'}
            {saveState === 'saved' && 'Draft saved — your co-owner sees this too.'}
            {saveState === 'error' && (
              <span className="text-red-600">Couldn&apos;t save the draft.</span>
            )}
            {saveState === 'idle' && 'Shared draft.'}
          </p>
        )}
      </div>

      {sentAt && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Marked as sent {new Date(sentAt).toLocaleString()}. Sending again will post a
          second message to the group.
        </p>
      )}

      <section className="flex flex-col gap-2">
        <span className="text-sm font-medium">Preview</span>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-neutral-100 p-3 text-sm dark:bg-neutral-900">
          {composed.text || 'Nothing to send yet.'}
        </pre>
      </section>

      <div className="fixed inset-x-0 bottom-0 border-t border-neutral-200 bg-white/95 p-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95">
        <div className="mx-auto flex w-full max-w-xl gap-2">
          {/* No phone number in either form — a number opens an individual chat and
              makes the league group unreachable. */}
          <a
            href={links.app}
            onClick={recordSend}
            className="flex-1 rounded-lg bg-green-600 px-4 py-3 text-center text-base font-medium text-white active:bg-green-700"
          >
            Send to WhatsApp
          </a>
          <button
            type="button"
            onClick={copy}
            className="rounded-lg border border-neutral-300 px-4 py-3 text-base font-medium dark:border-neutral-700"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="mt-2 text-center text-xs text-neutral-500">
          Button not working?{' '}
          <a href={links.web} className="underline">
            Open via wa.me
          </a>
        </p>
      </div>
    </div>
  )
}
