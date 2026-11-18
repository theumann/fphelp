import type { PrizeSummary } from '../render/blocks'

import { splitEvenly, type Cents } from './money'
import { allocateGameweekPrize, allocateRankPrizes, type RankedManager } from './prizes'

/**
 * The winnings ledger: who has won what so far, and what they stand to win.
 *
 * **Computed, not stored.** Every figure here is derived on each read from captured
 * history, current standings and the league's prize rules, so a capture that lands late
 * corrects the ledger without anything having to notice. The `winnings` table is kept
 * for the season-end freeze, where storing is the point: once the season is finalised
 * the figures must stop moving even if the rules or the API do.
 *
 * **Scores are before transfer hits.** History `points` and standings `event_total` are
 * both the gameweek score *before* hits — confirmed live on 2026-11-18, where an 8-point
 * hit left both at 73 while `total_points` moved by 65. That is the number FPL's own
 * league table shows and the one the digest already announces as the gameweek winner, so
 * the ledger pays the person the league was told won. A league that pays on net scores
 * would need this to be a setting, and the digest's winner line to follow it.
 */

/** One manager's score for one gameweek, as captured from `entry/{id}/history`. */
export interface GameweekScore {
  entry: number
  gameweek: number
  /** Before transfer hits. See the module comment. */
  points: number
}

export interface LedgerInput {
  history: GameweekScore[]
  /** From `settledGameweek`. Rows past it are provisional and pay nobody. */
  settledThrough: number
  /** From `events.length`. */
  gameweekCount: number
  /**
   * The entries in current standings — who could be missing from the newest settled
   * gameweek. See `missingFromNewest` for why this is a list and not a count.
   */
  currentEntries: number[]
  /** Current standings, scored managers only. Ranks are what the rank prizes project from. */
  standings: RankedManager[]
  prize: PrizeSummary
}

export type GameweekStatus =
  /** Settled and fully captured: the winner is known and the prize is final. */
  | 'paid'
  /** Settled, but the capture has not reached every manager yet. */
  | 'capturing'
  /** Settled, and nothing at all was captured for it. */
  | 'missing'

export interface GameweekResult {
  gameweek: number
  status: GameweekStatus
  /** The winning score, or null unless `paid`. */
  points: number | null
  /** Empty unless `paid`. More than one is a tie, and the prize is split. */
  winners: { entry: number; amountCents: Cents }[]
}

export interface ManagerWinnings {
  entry: number
  /** Gameweek prizes, which are final the moment the gameweek settles. */
  finalCents: Cents
  /** Best-gameweek and rank prizes, which can still move until the last gameweek. */
  provisionalCents: Cents
  /** Gameweeks won, including shared wins. */
  gameweeksWon: number[]
  /** Set while this manager holds (or shares) the season's best gameweek. */
  bestGw: { amountCents: Cents } | null
  /** Set while this manager sits in (or ties into) a paid place. */
  rankPrize: { rank: number; amountCents: Cents } | null
}

export interface Ledger {
  /** Every settled gameweek, oldest first, including the ones with nothing to show. */
  gameweeks: GameweekResult[]
  /** Everyone who has won or is projected to win anything, largest total first. */
  managers: ManagerWinnings[]
  /** The season's highest single score so far, and who holds it. Null before any. */
  bestGw: { points: number; gameweeks: { entry: number; gameweek: number }[] } | null
  /**
   * False when the pot is unset. Rank prizes are shares of a remainder, and without a pot
   * there is no remainder to share — rather than show `$0.00` for first place, the ledger
   * leaves them out and says why.
   */
  rankPrizesKnown: boolean
  /** True once the last gameweek has settled; the provisional figures stop moving. */
  seasonComplete: boolean
  finalTotalCents: Cents
  provisionalTotalCents: Cents
}

/** What the season's best gameweek pays, and to whom. Ties split, as everywhere else. */
function bestGameweek(scores: GameweekScore[], amountCents: Cents) {
  if (scores.length === 0) return null

  const points = Math.max(...scores.map((s) => s.points))
  const holders = scores
    .filter((s) => s.points === points)
    .sort((a, b) => a.gameweek - b.gameweek || a.entry - b.entry)

  /**
   * Split between managers, not between occurrences. The prize is for the season's highest
   * score; a manager who hit it twice holds it once, and counting them twice would hand
   * them a bigger share of a tie for doing the same thing again.
   *
   * Ordered by who got there first, so a sub-cent remainder goes to the earlier score.
   * Some order has to decide it, and history has no `rank_sort` for a manager who has
   * since left.
   */
  const entries = [...new Set(holders.map((h) => h.entry))]
  const shares = splitEvenly(amountCents, entries.length)

  return {
    points,
    gameweeks: holders.map((h) => ({ entry: h.entry, gameweek: h.gameweek })),
    shares: new Map(entries.map((entry, i) => [entry, shares[i]])),
  }
}

/**
 * Whether a current manager the capture should already have reached lacks a row for `gw`.
 *
 * Only the newest settled gameweek is checked: `current[]` returns a manager's whole
 * season, so anyone captured once has every earlier gameweek and a gap can only be at the
 * front.
 *
 * **Expected means "has an earlier row", not "is in standings".** While the next gameweek
 * is live, standings already list anyone who joined for it, and they will never have a row
 * for this one. Counting them made a settled gameweek read "still being captured" for the
 * whole of the following week whenever someone joined mid-season. A missed capture of an
 * existing member is still caught, since they have earlier rows. What goes unnoticed is a
 * joiner whose very first capture fails in the week they top the table, and that is
 * withheld by nothing anyway: they could only be detected against a roster of their own
 * gameweek, which FPL does not keep.
 */
function missingFromNewest(history: GameweekScore[], current: number[], gw: number): boolean {
  const atGw = new Set<number>()
  const earlier = new Set<number>()
  for (const s of history) {
    if (s.gameweek === gw) atGw.add(s.entry)
    else if (s.gameweek < gw) earlier.add(s.entry)
  }
  return current.some((entry) => earlier.has(entry) && !atGw.has(entry))
}

export function computeLedger(input: LedgerInput): Ledger {
  const { prize, settledThrough } = input

  const byGameweek = new Map<number, GameweekScore[]>()
  for (const s of input.history) {
    // Past the settled line the scores are still moving, so they neither win a gameweek
    // nor set the season's best.
    if (s.gameweek < 1 || s.gameweek > settledThrough) continue
    const list = byGameweek.get(s.gameweek)
    if (list) list.push(s)
    else byGameweek.set(s.gameweek, [s])
  }

  const managers = new Map<number, ManagerWinnings>()
  const forManager = (entry: number): ManagerWinnings => {
    let m = managers.get(entry)
    if (!m) {
      m = {
        entry,
        finalCents: 0,
        provisionalCents: 0,
        gameweeksWon: [],
        bestGw: null,
        rankPrize: null,
      }
      managers.set(entry, m)
    }
    return m
  }

  const gameweeks: GameweekResult[] = []
  const counted: GameweekScore[] = []

  for (let gw = 1; gw <= settledThrough; gw++) {
    const scores = byGameweek.get(gw) ?? []

    if (scores.length === 0) {
      gameweeks.push({ gameweek: gw, status: 'missing', points: null, winners: [] })
      continue
    }

    /**
     * A partial capture is withheld rather than paid on what is there. The missing
     * manager may be the one who won, and a gameweek prize is meant to be final the moment
     * it appears — showing one winner and then quietly swapping them is worse than
     * showing the gameweek as still coming in.
     */
    if (gw === settledThrough && missingFromNewest(input.history, input.currentEntries, gw)) {
      gameweeks.push({ gameweek: gw, status: 'capturing', points: null, winners: [] })
      continue
    }

    counted.push(...scores)

    // Order for the remainder cent: lowest entry first. Nothing about it is fair; it only
    // has to be stable, so the same gameweek never pays a different person a cent more.
    const allocation = allocateGameweekPrize(
      scores.map((s) => ({ entry: s.entry, eventTotal: s.points, rankSort: s.entry })),
      prize.gwWinnerCents / 100,
    )

    for (const a of allocation) {
      const m = forManager(a.entry)
      m.finalCents += a.amountCents
      m.gameweeksWon.push(gw)
    }

    gameweeks.push({
      gameweek: gw,
      status: 'paid',
      points: Math.max(...scores.map((s) => s.points)),
      winners: allocation.map((a) => ({ entry: a.entry, amountCents: a.amountCents })),
    })
  }

  const best = bestGameweek(counted, prize.seasonBestGwCents)
  if (best) {
    for (const [entry, amountCents] of best.shares) {
      const m = forManager(entry)
      m.bestGw = { amountCents }
      m.provisionalCents += amountCents
    }
  }

  // Rank prizes need a remainder to share, and standings to rank from. Before the first
  // gameweek is scored there is no table to project a winner from.
  const rankPrizesKnown = prize.potSet
  if (rankPrizesKnown && settledThrough > 0) {
    for (const a of allocateRankPrizes(input.standings, prize.rankPrizeCents)) {
      const m = forManager(a.entry)
      m.rankPrize = { rank: a.rank, amountCents: a.amountCents }
      m.provisionalCents += a.amountCents
    }
  }

  const list = [...managers.values()].sort(
    (a, b) =>
      b.finalCents + b.provisionalCents - (a.finalCents + a.provisionalCents) ||
      b.finalCents - a.finalCents ||
      a.entry - b.entry,
  )

  return {
    gameweeks,
    managers: list,
    bestGw: best && { points: best.points, gameweeks: best.gameweeks },
    rankPrizesKnown,
    seasonComplete: input.gameweekCount > 0 && settledThrough >= input.gameweekCount,
    finalTotalCents: list.reduce((s, m) => s + m.finalCents, 0),
    provisionalTotalCents: list.reduce((s, m) => s + m.provisionalCents, 0),
  }
}
