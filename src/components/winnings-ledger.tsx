import type { Ledger, ManagerWinnings } from '@/lib/digest/ledger'
import { formatCents } from '@/lib/digest/money'
import { ordinal } from '@/lib/render/blocks'

import { Alert, Card, SummaryRow } from './ui'

/**
 * Who has won what, and what they stand to win.
 *
 * Presentational and server-rendered: the ledger is computed on the page from captured
 * history, and nothing here is editable. The one rule this component carries is the
 * project's standing one — **a provisional figure is never shown as settled** — so the
 * two kinds of money sit in separate columns and only the gameweek prizes are called
 * "won".
 */

export interface ManagerName {
  entryName: string
  playerName: string
}

interface Props {
  ledger: Ledger
  names: Record<number, ManagerName>
  currency: string
  gameweekCount: number
}

function list(gameweeks: number[]): string {
  return gameweeks.map((g) => `GW${g}`).join(', ')
}

export function WinningsLedger({ ledger, names, currency, gameweekCount }: Props) {
  const money = (cents: number) => formatCents(cents, currency)
  // A manager who left before the roster was ever recorded has no name anywhere; the entry
  // number is at least something the owner can look up on FPL.
  const name = (entry: number) => names[entry]?.entryName ?? `Entry ${entry}`

  const capturing = ledger.gameweeks.filter((g) => g.status === 'capturing').map((g) => g.gameweek)
  const missing = ledger.gameweeks.filter((g) => g.status === 'missing').map((g) => g.gameweek)
  const paid = ledger.gameweeks.filter((g) => g.status === 'paid')

  const projectionHint = ledger.seasonComplete
    ? 'Every gameweek is in. The best-gameweek and place prizes are final standings, not yet locked.'
    : `Gameweek prizes are final once the gameweek settles. The best gameweek and the places are projections until GW${gameweekCount}.`

  return (
    <Card title="Winnings" hint={projectionHint}>
      {ledger.gameweeks.length === 0 ? (
        <p className="text-sm text-muted">No gameweek has settled yet. Winnings start with GW1.</p>
      ) : (
        <>
          <dl className="flex flex-col gap-1">
            <SummaryRow label="Won so far (gameweek prizes)" value={money(ledger.finalTotalCents)} />
            <SummaryRow
              label="Projected (best gameweek and places)"
              value={money(ledger.provisionalTotalCents)}
            />
          </dl>

          {capturing.length > 0 && (
            <Alert>
              {list(capturing)} is still being captured. Its winner appears once every
              manager&apos;s score is in, usually within the hour.
            </Alert>
          )}
          {missing.length > 0 && (
            <Alert tone="warning">
              No scores were captured for {list(missing)}, so{' '}
              {missing.length === 1 ? 'its prize is' : 'their prizes are'} missing from the
              ledger.
            </Alert>
          )}
          {!ledger.rankPrizesKnown && (
            <Alert>Set the pot in Setup to see what the paid places are worth.</Alert>
          )}

          <ul className="flex flex-col divide-y divide-line" aria-label="Winnings by manager">
            {ledger.managers.map((m) => (
              <ManagerRow key={m.entry} m={m} name={name(m.entry)} money={money} />
            ))}
          </ul>

          {paid.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted">By gameweek</summary>
              <ul className="mt-2 flex flex-col gap-1" aria-label="Winnings by gameweek">
                {[...paid].reverse().map((g) => (
                  <li key={g.gameweek} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate">
                      <span className="text-muted">GW{g.gameweek} · </span>
                      {g.winners.map((w) => name(w.entry)).join(' & ')}
                      <span className="text-muted"> · {g.points} pts</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-muted">
                      {/* A tie shows the pooled prize, not a per-head figure: an uneven
                          split leaves the shares a cent apart, so no one amount is "each". */}
                      {money(g.winners.reduce((s, w) => s + w.amountCents, 0))}
                      {g.winners.length > 1 && ' split'}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </Card>
  )
}

function ManagerRow({
  m,
  name,
  money,
}: {
  m: ManagerWinnings
  name: string
  money: (cents: number) => string
}) {
  const parts: string[] = []
  if (m.gameweeksWon.length > 0) parts.push(list(m.gameweeksWon))
  if (m.bestGw) parts.push('best gameweek')
  if (m.rankPrize) parts.push(`${ordinal(m.rankPrize.rank)} place`)

  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{name}</span>
        <span className="truncate text-xs text-muted">{parts.join(' · ')}</span>
      </div>
      <div className="flex shrink-0 flex-col items-end text-sm tabular-nums">
        {m.finalCents > 0 && <span className="font-medium">{money(m.finalCents)}</span>}
        {m.provisionalCents > 0 && (
          <span className="text-xs text-muted">+{money(m.provisionalCents)} projected</span>
        )}
      </div>
    </li>
  )
}
