'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { clearSentAction, markSentAction, saveDraftAction } from '@/app/send/actions'
import { EmailPanel } from '@/components/email-panel'
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
  /** Absent in demo mode. `enabled` is the league's opt-in — email is off by default. */
  email?: { enabled: boolean; recipientCount: number; gameweekCount: number; sentAt?: string }
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
  email,
  persistence,
}: Props) {
  const [body, setBody] = useState(persistence?.initialBody ?? '')
  const [blocks, setBlocks] = useState<BlockSelection>(
    persistence?.initialBlocks ?? defaultBlocks,
  )
  const [copied, setCopied] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [sentAt, setSentAt] = useState(persistence?.sentAt)
  // Tapping the link is not evidence that anything was sent — on desktop the
  // whatsapp:// scheme often has no handler at all. It only means we should now ask.
  const [tappedSend, setTappedSend] = useState(false)
  const [marking, setMarking] = useState(false)
  const messageIdRef = useRef(persistence?.messageId)
  /** The block selection as last written, so a re-render cannot re-save an unchanged one. */
  const savedBlocksRef = useRef(persistence?.initialBlocks)

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

  /**
   * Autosave. The draft is shared between co-owners, so leaving it only in local state
   * would let two people write the same week's update independently.
   *
   * Typing is debounced; a checkbox is not. Both used to wait 800ms, which meant toggling
   * a block and navigating away immediately lost the change — and since a block toggle is
   * one deliberate click rather than a stream of keystrokes, there is nothing to debounce.
   */
  useEffect(() => {
    if (!persistence) return
    if (body === persistence.initialBody) return

    const timer = setTimeout(save, 800)
    return () => clearTimeout(timer)
  }, [body, persistence, save])

  useEffect(() => {
    if (!persistence) return
    // Compared against what was last written, not against the initial value: `save` changes
    // identity on every keystroke, so re-running this effect must not re-save the blocks.
    if (blocks === savedBlocksRef.current) return

    savedBlocksRef.current = blocks
    save()
  }, [blocks, persistence, save])

  async function copy() {
    try {
      await navigator.clipboard.writeText(composed.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  /**
   * Records that the owner says they sent it. Only ever called from an explicit
   * confirmation — never from tapping the link, which proves nothing.
   */
  async function confirmSent() {
    if (!persistence || !messageIdRef.current) return
    setMarking(true)
    try {
      const result = await markSentAction({
        leagueId: persistence.leagueId,
        messageId: messageIdRef.current,
        sentText: composed.text,
      })
      setSentAt(result.sentAt)
    } catch {
      // Best-effort: a failure here doesn't mean the message wasn't sent.
    } finally {
      setMarking(false)
    }
  }

  async function undoSent() {
    if (!persistence || !messageIdRef.current) return
    setMarking(true)
    try {
      await clearSentAction({
        leagueId: persistence.leagueId,
        messageId: messageIdRef.current,
      })
      setSentAt(undefined)
      setTappedSend(false)
    } catch {
      // Leave the banner in place rather than claiming an undo that didn't happen.
    } finally {
      setMarking(false)
    }
  }

  return (
    // Bottom padding clears the fixed send bar *and* the home indicator behind it —
    // otherwise the last control scrolls to a position it can never be tapped in.
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5 p-4 pb-[calc(8rem+env(safe-area-inset-bottom))]">
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

      {sentAt ? (
        <div className="flex flex-col gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <p>
            You marked this sent on {new Date(sentAt).toLocaleString()}. Sending again
            will post a second message to the group.
          </p>
          <button
            type="button"
            onClick={undoSent}
            disabled={marking}
            className="self-start text-xs underline disabled:opacity-50"
          >
            {marking ? 'Saving…' : "It wasn't actually sent — undo"}
          </button>
        </div>
      ) : (
        persistence &&
        tappedSend && (
          <div className="flex flex-col gap-2 rounded-lg border border-neutral-300 p-3 dark:border-neutral-700">
            <p className="text-sm">
              Did the message actually go out? We can&apos;t tell — WhatsApp doesn&apos;t
              report back.
            </p>
            <button
              type="button"
              onClick={confirmSent}
              disabled={marking}
              className="self-start rounded-lg border border-neutral-400 px-3 py-2 text-sm font-medium disabled:opacity-50 dark:border-neutral-600"
            >
              {marking ? 'Saving…' : 'Yes, mark as sent'}
            </button>
            <p className="text-xs text-neutral-500">
              If WhatsApp didn&apos;t open, use Copy and paste it in — then come back and
              mark it sent.
            </p>
          </div>
        )
      )}

      {email?.enabled && (
        <EmailPanel
          body={body}
          stats={stats}
          prize={prize}
          signature={signature}
          leagueName={leagueName}
          defaultBlocks={defaultBlocks}
          recipientCount={email.recipientCount}
          send={
            persistence && {
              leagueId: persistence.leagueId,
              gameweek: stats.gameweek,
              // A getter, not the value: the draft autosaves after this renders, so
              // reading it here would capture the id from before the first save —
              // which is `undefined`, and the send would mark nothing.
              getMessageId: () => messageIdRef.current,
              gameweekCount: email.gameweekCount,
              sentAt: email.sentAt,
            }
          }
        />
      )}

      <section className="flex flex-col gap-2">
        <span className="text-sm font-medium">WhatsApp preview</span>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-neutral-100 p-3 text-sm dark:bg-neutral-900">
          {composed.text || 'Nothing to send yet.'}
        </pre>
      </section>

      {/**
       * The send bar.
       *
       * `pb-[env(safe-area-inset-bottom)]` is not cosmetic: without it the bar sits under
       * the iPhone home indicator, and the primary action of the whole app is partly
       * untappable on the device it was designed for. It pairs with `viewportFit: 'cover'`
       * in the layout — the inset is always 0px without it.
       */}
      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-background/95 px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto flex w-full max-w-xl gap-2">
          {/* No phone number in either form — a number opens an individual chat and
              makes the league group unreachable. */}
          <a
            href={links.app}
            onClick={() => setTappedSend(true)}
            className="flex-1 cursor-pointer rounded-lg bg-[#25D366] px-4 py-3 text-center text-base font-semibold text-[#0b3d24] transition-opacity active:opacity-80"
          >
            Send to WhatsApp
          </a>
          <button
            type="button"
            onClick={copy}
            className="cursor-pointer rounded-lg border border-line-strong px-4 py-3 text-base font-medium transition-colors hover:bg-surface-muted"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="mt-2 text-center text-xs text-muted">
          Button not working?{' '}
          <a href={links.web} className="cursor-pointer underline">
            Open via wa.me
          </a>
        </p>
      </div>
    </div>
  )
}
