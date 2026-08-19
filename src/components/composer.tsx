'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  clearSentAction,
  markSentAction,
  saveDraftAction,
  sendEmailAction,
} from '@/app/send/actions'
import { EmailPanel } from '@/components/email-panel'
import type { DigestStats } from '@/lib/digest/stats'
import type { BlockSelection, PrizeSummary } from '@/lib/render/blocks'
import { DEFAULT_BUDGET } from '@/lib/render/budget'
import { composeMessage } from '@/lib/render/compose'
import { renderEmail } from '@/lib/render/email'
import { buildWhatsAppLinks } from '@/lib/render/whatsapp'

interface Props {
  stats: DigestStats
  prize: PrizeSummary
  signature: string
  defaultBlocks: BlockSelection
  leagueName: string
  /** Absent in demo mode. `enabled` is the league's opt-in — email is off by default. */
  email?: {
    enabled: boolean
    recipientCount: number
    gameweekCount: number
    sentAt?: string
    /** Drives the send bar's wording — the owner is about to act on it, so it must be true. */
    hideRecipients: boolean
  }
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
type Channel = 'email' | 'whatsapp'

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
  const [blocks, setBlocks] = useState<BlockSelection>(persistence?.initialBlocks ?? defaultBlocks)

  /**
   * Email's own block selection.
   *
   * Separate from WhatsApp's on purpose: WhatsApp is constrained by a ~1,500 character URL
   * budget that a 20-manager standings table can consume on its own, and email has no such
   * limit — so the owner can mail the full table while keeping the WhatsApp message short.
   * Standings therefore default on here whatever WhatsApp's default is. The prose and
   * signature are shared; only the generated blocks differ.
   */
  const [emailBlocks, setEmailBlocks] = useState<BlockSelection>({
    ...defaultBlocks,
    overallStandings: true,
  })

  /**
   * Email leads when the league has it switched on, because it is the channel that actually
   * sends from here — WhatsApp needs the owner's thumb either way, so it loses nothing by
   * being second. A league without email never sees the tabs at all.
   */
  const emailEnabled = Boolean(email?.enabled)
  const [channel, setChannel] = useState<Channel>(emailEnabled ? 'email' : 'whatsapp')

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

  // Email dispatch state lives here rather than in the panel, because the button that
  // triggers it is in the shared bottom bar.
  const [sending, setSending] = useState(false)
  const [emailSentAt, setEmailSentAt] = useState(email?.sentAt)
  const [emailError, setEmailError] = useState<string | null>(null)
  // Set when the server reports this gameweek already went out. The resend is a second,
  // separate click — a double-submit can't produce one.
  const [confirmResend, setConfirmResend] = useState(false)

  // composeMessage is a pure function, so toggling a block re-renders from the same
  // stored stats — no refetch.
  const composed = useMemo(
    () => composeMessage({ body, blocks, stats, prize, signature }),
    [body, blocks, stats, prize, signature],
  )

  const rendered = useMemo(
    () =>
      renderEmail({
        leagueName,
        gameweek: stats.gameweek,
        body,
        blocks: emailBlocks,
        stats,
        prize,
        signature,
      }),
    [leagueName, stats, body, emailBlocks, prize, signature],
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

  async function sendMail(resend: boolean) {
    if (!persistence || !email) return
    setSending(true)
    setEmailError(null)
    try {
      const result = await sendEmailAction({
        leagueId: persistence.leagueId,
        gameweek: stats.gameweek,
        // Read at click time — the draft autosaves, so the id doesn't exist at first render.
        messageId: messageIdRef.current,
        body,
        blocks: emailBlocks,
        signature,
        gameweekCount: email.gameweekCount,
        confirmResend: resend,
      })

      if (result.ok) {
        setEmailSentAt(result.sentAt)
        setConfirmResend(false)
      } else if (result.alreadySent) {
        setEmailSentAt(result.sentAt)
        setConfirmResend(true)
      } else {
        setEmailError(result.error)
      }
    } catch {
      // A thrown action means the request itself didn't complete, so we genuinely don't
      // know whether the email went out. Say so — never fall through to a success
      // state, and never claim it failed either.
      setEmailError(
        'The connection dropped, so we can’t tell whether this was sent. Check your inbox before trying again.',
      )
    } finally {
      setSending(false)
    }
  }

  const recipientCount = email?.recipientCount ?? 0

  return (
    // Bottom padding clears the fixed send bar *and* the home indicator behind it —
    // otherwise the last control scrolls to a position it can never be tapped in.
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5 p-4 pb-[calc(9rem+env(safe-area-inset-bottom))]">
      <header>
        <h1 className="text-xl font-semibold">{leagueName}</h1>
        <p className="text-sm text-muted">
          Gameweek {stats.gameweek} · {stats.standings.length} managers
          {stats.pendingCount > 0 && ` · ${stats.pendingCount} not yet scored`}
        </p>
      </header>

      {/* Above the tabs because it is shared: one message, two renderings. Moving it
          inside a tab would suggest each channel has its own prose, which it does not. */}
      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium">Your message</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          placeholder="Write this week's update…"
          className="w-full resize-y rounded-lg border border-line-strong bg-surface p-3 text-base text-foreground outline-none placeholder:text-faint focus:border-ring"
        />
        {persistence && (
          <span className="text-xs text-muted">
            {saveState === 'saving' && 'Saving…'}
            {saveState === 'saved' && 'Draft saved — your co-owner sees this too.'}
            {saveState === 'error' && (
              <span className="text-danger">Couldn&apos;t save the draft.</span>
            )}
            {saveState === 'idle' && 'Shared draft — the same text feeds both channels.'}
          </span>
        )}
      </label>

      {emailEnabled && (
        <div
          role="tablist"
          aria-label="Delivery channel"
          className="flex gap-1 rounded-lg bg-surface-muted p-1"
        >
          {(
            [
              { id: 'email', label: 'Email' },
              { id: 'whatsapp', label: 'WhatsApp' },
            ] as const
          ).map(({ id, label }) => (
            <button
              key={id}
              role="tab"
              id={`tab-${id}`}
              aria-selected={channel === id}
              aria-controls={`panel-${id}`}
              onClick={() => setChannel(id)}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                channel === id
                  ? 'bg-surface text-foreground shadow-sm'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              {label}
              {/* The budget applies only to WhatsApp and its meter lives on that tab, so an
                  over-long message would otherwise be invisible from the email tab — which
                  is now where the owner starts. */}
              {id === 'whatsapp' && overBudget && (
                <span className="ml-1.5 text-danger" title="Over the length budget">
                  ●<span className="sr-only">over the length budget</span>
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {channel === 'whatsapp' ? (
        <div
          id="panel-whatsapp"
          role={emailEnabled ? 'tabpanel' : undefined}
          aria-labelledby={emailEnabled ? 'tab-whatsapp' : undefined}
          className="flex flex-col gap-5"
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Include</legend>
            {BLOCK_LABELS.map(({ key, label, hint }) => (
              <label
                key={key}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3"
              >
                <input
                  type="checkbox"
                  checked={blocks[key]}
                  onChange={(e) => setBlocks({ ...blocks, [key]: e.target.checked })}
                  className="mt-1 size-4 accent-accent"
                />
                <span className="flex flex-col">
                  <span className="text-sm font-medium">{label}</span>
                  <span className="text-xs text-muted">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium">Length</span>
              <span className={overBudget ? 'font-medium text-danger' : 'text-muted'}>
                {used} / {DEFAULT_BUDGET}
                {overBudget ? ` · ${Math.abs(remaining)} over` : ` · ${remaining} left`}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
              <div
                className={`h-full transition-all ${overBudget ? 'bg-danger' : 'bg-[#25D366]'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            {composed.truncatedRows > 0 && (
              <p className="text-xs text-warning">
                Standings trimmed by {composed.truncatedRows} rows to fit.
              </p>
            )}
          </div>

          {sentAt ? (
            <div className="flex flex-col gap-2 rounded-lg bg-warning-surface p-3 text-sm text-warning">
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
              <div className="flex flex-col gap-2 rounded-lg border border-line-strong p-3">
                <p className="text-sm">
                  Did the message actually go out? We can&apos;t tell — WhatsApp
                  doesn&apos;t report back.
                </p>
                <button
                  type="button"
                  onClick={confirmSent}
                  disabled={marking}
                  className="self-start rounded-lg border border-line-strong px-3 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {marking ? 'Saving…' : 'Yes, mark as sent'}
                </button>
                <p className="text-xs text-muted">
                  If WhatsApp didn&apos;t open, use Copy and paste it in — then come back
                  and mark it sent.
                </p>
              </div>
            )
          )}

          <section className="flex flex-col gap-2">
            <span className="text-sm font-medium">WhatsApp preview</span>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-muted p-3 text-sm">
              {composed.text || 'Nothing to send yet.'}
            </pre>
          </section>
        </div>
      ) : (
        <EmailPanel
          rendered={rendered}
          blocks={emailBlocks}
          onBlocksChange={setEmailBlocks}
          recipientCount={recipientCount}
          sentAt={emailSentAt}
          error={emailError}
          canSend={Boolean(persistence)}
        />
      )}

      {/**
       * One primary action, always in the same place — which is exactly why it has to say
       * which channel it belongs to. WhatsApp opens a chat picker and can still be
       * abandoned; email leaves immediately and cannot be recalled, so its button names the
       * recipient count instead of just saying "Send".
       */}
      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-background/95 px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto w-full max-w-xl">
          {channel === 'whatsapp' ? (
            <>
              <div className="flex gap-2">
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
            </>
          ) : confirmResend ? (
            <>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => sendMail(true)}
                  disabled={sending}
                  className="flex-1 cursor-pointer rounded-lg bg-warning px-4 py-3 text-base font-semibold text-warning-surface disabled:opacity-50"
                >
                  {sending ? 'Sending…' : 'Send it again anyway'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmResend(false)}
                  disabled={sending}
                  className="cursor-pointer rounded-lg border border-line-strong px-4 py-3 text-base font-medium disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
              <p className="mt-2 text-center text-xs text-warning">
                Already emailed — this delivers a second copy to all {recipientCount}.
              </p>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => sendMail(false)}
                disabled={sending || recipientCount === 0 || !persistence}
                className="w-full cursor-pointer rounded-lg bg-accent px-4 py-3 text-base font-semibold text-accent-foreground transition-opacity active:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {sending
                  ? 'Sending…'
                  : recipientCount === 0
                    ? 'No recipients yet'
                    : `Send email to ${recipientCount}`}
              </button>
              {/* The disclosure is irreversible and happens on this tap, so the wording
                  has to match what the league has actually chosen rather than assume bcc. */}
              <p className="mt-2 text-center text-xs text-muted">
                {!persistence
                  ? 'Preview only — demo mode doesn’t send.'
                  : email?.hideRecipients
                    ? 'Sends from here, now. Addresses are bcc’d.'
                    : 'Sends from here, now. Everyone sees the list and can reply to all.'}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
