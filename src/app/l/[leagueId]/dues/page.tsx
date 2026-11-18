import { DuesList } from '@/components/dues-list'
import { NotAnOwner } from '@/components/not-an-owner'
import { WinningsLedger, type ManagerName } from '@/components/winnings-ledger'
import {
  getSettings,
  listDues,
  listGameweekScores,
  listManagerNames,
  syncLeagueName,
} from '@/db/queries'
import { computeLedger } from '@/lib/digest/ledger'
import { toCents } from '@/lib/digest/money'
import { fpl } from '@/lib/fpl/client'
import { gameweekCount, settledGameweek } from '@/lib/fpl/gameweek'
import { buildRoster } from '@/lib/fpl/roster'
import { requireLeagueAccess } from '@/lib/league-access'
import { summarise } from '@/lib/league-settings'

export const dynamic = 'force-dynamic'

export default async function DuesPage({
  params,
}: {
  params: Promise<{ leagueId: string }>
}) {
  const { leagueId } = await params

  // Membership is checked before the FPL call, not after: a non-member should not be
  // able to make this deployment fetch on their behalf.
  const access = await requireLeagueAccess(leagueId)
  if (!access.member) return <NotAnOwner />
  const { league } = access

  /**
   * `bootstrap-static` and `event-status` are fetched for the ledger's cut-off, not for
   * display. Without them the newest stored gameweek would be taken as settled, and a
   * capture retried during a live gameweek stores exactly those provisional rows.
   */
  const [standings, bootstrap, eventStatus] = await Promise.all([
    fpl.leagueStandingsAll(league.fplLeagueId),
    fpl.bootstrapStatic(),
    fpl.eventStatus(),
  ])
  await syncLeagueName(league.id, standings.league.name, league.name)

  // The full roster, including managers who have joined but aren't in standings yet —
  // they owe their dues regardless of whether a gameweek has been scored.
  const roster = buildRoster(standings)
  const [settings, paid, scores, storedNames] = await Promise.all([
    getSettings(league.id),
    listDues(league.id),
    listGameweekScores(league.id),
    listManagerNames(league.id),
  ])

  const gameweeks = gameweekCount(bootstrap)
  const ledger = computeLedger({
    history: scores,
    settledThrough: settledGameweek(bootstrap, eventStatus),
    gameweekCount: gameweeks,
    currentEntries: standings.standings.results.map((r) => r.entry),
    // From the raw results rather than the roster, which has no `rank_sort` — the order
    // a pooled tie's odd cent is placed in.
    standings: standings.standings.results.map((r) => ({
      entry: r.entry,
      rank: r.rank,
      rankSort: r.rank_sort,
    })),
    prize: summarise(settings, gameweeks),
  })

  // Live names first, since teams get renamed; stored names cover managers who have left.
  const names: Record<number, ManagerName> = Object.fromEntries(storedNames)
  for (const m of roster) names[m.entry] = { entryName: m.entryName, playerName: m.playerName }

  return (
    <main>
      <DuesList
        leagueId={league.id}
        leagueName={standings.league.name}
        managers={roster.map((m) => ({
          entry: m.entry,
          entryName: m.entryName,
          playerName: m.playerName,
          pending: m.pending,
        }))}
        initialPaid={Object.fromEntries(paid)}
        entryFeeCents={settings.entryFee !== undefined ? toCents(settings.entryFee) : null}
        potCents={settings.potTotal !== undefined ? toCents(settings.potTotal) : null}
        currency={settings.currency}
        winnings={
          <WinningsLedger
            ledger={ledger}
            names={names}
            currency={settings.currency}
            gameweekCount={gameweeks}
          />
        }
      />
    </main>
  )
}
