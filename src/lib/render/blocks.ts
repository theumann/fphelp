import { formatCents, type Cents } from '../digest/money'
import type { DigestStats, StandingRow } from '../digest/stats'

/**
 * Blocks are built as plain text for WhatsApp, and as structured data the HTML email
 * renders from — one source, two outputs.
 *
 * Layout is deliberately compact: table padding is pure cost against the length budget,
 * so no column alignment and no separator rules.
 */

export interface BlockSelection {
  overallStandings: boolean
  gwResults: boolean
  prizeStructure: boolean
}

export interface PrizeSummary {
  currency: string
  potCents: Cents
  gwWinnerCents: Cents
  seasonBestGwCents: Cents
  /** Amount per paid place, index 0 = 1st. */
  rankPrizeCents: Cents[]
}

/** Keeps long team names from eating the budget, without making them unrecognisable. */
function truncateName(name: string, max = 18): string {
  return name.length <= max ? name : `${name.slice(0, max - 1)}…`
}

function movementMark(movement: number | null): string {
  if (movement === null || movement === 0) return ''
  return movement > 0 ? ` ▲${movement}` : ` ▼${Math.abs(movement)}`
}

function standingLine(row: StandingRow): string {
  if (row.pending || row.rank === null) {
    return `– ${truncateName(row.entryName)} (${truncateName(row.playerName, 14)}) — new`
  }
  return `${row.rank}. ${truncateName(row.entryName)} ${row.total}${movementMark(row.movement)}`
}

export interface StandingsBlock {
  lines: string[]
  /** Set when rows were dropped to fit the budget. */
  omitted: number
}

/**
 * The standings block, optionally limited to `maxRows`.
 *
 * This is the elastic block: for a 20-manager league it can consume most of the budget
 * on its own, so the composer trims it rather than failing at send time.
 */
export function standingsBlock(stats: DigestStats, maxRows?: number): StandingsBlock {
  const rows = stats.standings
  const limit = maxRows ?? rows.length
  const shown = rows.slice(0, Math.max(0, limit))

  return {
    lines: shown.map(standingLine),
    omitted: rows.length - shown.length,
  }
}

export function renderStandings(stats: DigestStats, maxRows?: number): string {
  const { lines, omitted } = standingsBlock(stats, maxRows)
  if (lines.length === 0) return ''

  const parts = ['*Standings*', ...lines]
  if (omitted > 0) parts.push(`…and ${omitted} more`)
  return parts.join('\n')
}

export function renderGwResults(stats: DigestStats): string {
  const lines: string[] = [`*Gameweek ${stats.gameweek}*`]

  if (stats.gwWinners.length === 0) {
    // Pre-season, or a gameweek nobody has scored in yet.
    lines.push('No scores yet.')
    return lines.join('\n')
  }

  const names = stats.gwWinners.map((w) => `${w.playerName} (${w.eventTotal})`).join(', ')
  lines.push(stats.gwWinners.length > 1 ? `Winners (tied): ${names}` : `Winner: ${names}`)

  if (stats.leagueAverage !== null) {
    lines.push(`League average: ${Math.round(stats.leagueAverage)}`)
  }
  if (stats.biggestRiser) {
    lines.push(`Riser: ${stats.biggestRiser.playerName} ▲${stats.biggestRiser.places}`)
  }
  if (stats.biggestFaller) {
    lines.push(`Faller: ${stats.biggestFaller.playerName} ▼${Math.abs(stats.biggestFaller.places)}`)
  }

  return lines.join('\n')
}

export function renderPrizeStructure(prize: PrizeSummary): string {
  const money = (c: Cents) => formatCents(c, prize.currency)
  const lines = [
    '*Prizes*',
    `Pot: ${money(prize.potCents)}`,
    `Each GW winner: ${money(prize.gwWinnerCents)}`,
    `Best GW of season: ${money(prize.seasonBestGwCents)}`,
  ]

  if (prize.rankPrizeCents.length > 0) {
    const places = prize.rankPrizeCents.map((c, i) => `${i + 1}. ${money(c)}`).join('  ')
    lines.push(`Final table: ${places}`)
  }

  return lines.join('\n')
}
