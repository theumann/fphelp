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

/** Nothing selected. Every generated block off, prose and signature only. */
export const NO_BLOCKS: BlockSelection = {
  overallStandings: false,
  gwResults: false,
  prizeStructure: false,
}

/**
 * Whether a block is built from the gameweek's scores.
 *
 * The prize structure is not: it comes from the league's own settings — the pot, the fixed
 * amounts, the percentages — none of which move because a match is being played. So it
 * stays available mid-gameweek while the other two do not.
 */
export function dependsOnGameweek(key: keyof BlockSelection): boolean {
  return key === 'overallStandings' || key === 'gwResults'
}

/**
 * What may actually be rendered, given whether the gameweek's numbers have settled.
 *
 * Separate from disabling the checkboxes, and it is the half that matters. A draft saved
 * last week, or a league default, can arrive with standings switched on — so relying on
 * the control being greyed out would still compose a provisional table into the message.
 * Only the blocks that depend on the gameweek are withheld.
 */
export function effectiveBlocks(blocks: BlockSelection, statsReady: boolean): BlockSelection {
  if (statsReady) return blocks
  return { ...blocks, overallStandings: false, gwResults: false }
}

export interface PrizeSummary {
  currency: string
  /** False when the league has not set a pot. Zero is a figure; unset is not. */
  potSet: boolean
  /** Zero when unset — never render this without checking `potSet`. */
  potCents: Cents
  gwWinnerCents: Cents
  seasonBestGwCents: Cents
  /** League costs taken off the pot, itemised so the block can name each one. */
  expenses: { label: string; amountCents: Cents }[]
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

/**
 * Between the team name and its score, and it may not be a space.
 *
 * A team name ending in digits puts two digit groups next to each other — `Forza Italia
 * 2006 193` — and Android's WhatsApp linkifies that as a phone number: underlined, and a
 * tap opens the dialer. Confirmed on a real handset 2026-09-07, along with three things
 * that do **not** fix it: an em dash (dashes appear in real numbers, so the linkifier
 * accepts them), and wrapping the block in ``` fences — **code blocks are still
 * linkified**, which also means the prize block is not immune by virtue of its fences.
 *
 * A colon is inert to the linkifier, reads naturally as a scoreboard, and costs three
 * encoded characters a row — a third of what a middle dot or bullet would, both of which
 * also tested clean if this ever needs to change for looks.
 */
const SCORE_SEPARATOR = ':'

function standingLine(row: StandingRow): string {
  if (row.pending || row.rank === null) {
    return `– ${truncateName(row.entryName)} (${truncateName(row.playerName, 14)}) — new`
  }
  return `${row.rank}. ${truncateName(row.entryName)}${SCORE_SEPARATOR} ${row.total}${movementMark(row.movement)}`
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

/** One money line of the prize block: what it is, and what it is worth. */
export interface PrizeRow {
  label: string
  /** Negative for an expense, so it formats as `-$100.00` and reads as a deduction. */
  cents: Cents
}

/**
 * The prize block's money lines, in the order the money moves: collected, spent, then
 * committed. Shared by all three renderers, which otherwise drift — the plaintext email
 * has already been caught printing a pot the other two had learned to omit.
 *
 * Expenses carry a negative amount rather than a "Less" prefix. The sign is what marks a
 * deduction in a column of figures, and it survives right-alignment, where a prefix
 * pushes the label out instead.
 */
export function prizeRows(prize: PrizeSummary): PrizeRow[] {
  const rows: PrizeRow[] = []

  // Both the pot and its deductions are omitted when there is no pot: an expense listed
  // under nothing to deduct it from is a subtraction with no subject.
  if (prize.potSet) {
    rows.push({ label: 'Pot', cents: prize.potCents })
    for (const e of prize.expenses) rows.push({ label: e.label, cents: -e.amountCents })
  }

  /**
   * Short labels, because the monospace block has a hard width and these are the two we
   * control — an owner's expense label is whatever they typed. "GW winner" and "Best GW"
   * read unambiguously under a "Prizes" heading, and the four characters they save are
   * four an expense label gets to keep before it is truncated.
   */
  rows.push({ label: 'GW winner', cents: prize.gwWinnerCents })
  rows.push({ label: 'Best GW', cents: prize.seasonBestGwCents })
  return rows
}

/** `1st`, `2nd`, `3rd`, `4th`… — the paid places, labelled for a column of their own. */
export function ordinal(n: number): string {
  const rest = n % 100
  if (rest >= 11 && rest <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

/**
 * The widest a line in the ``` block may be.
 *
 * **Measured, not chosen.** WhatsApp wraps its monospace block at phone width, and on
 * 2026-09-07 a real digest proved where: rows of 28 characters wrapped — putting the label
 * on one line and its amount on the next — while rows of 25 did not. 25 is therefore the
 * widest known-good value rather than a guess, and it is a *phone* measurement, so it is
 * the constraint even though desktop WhatsApp is wider.
 *
 * Everything the block renders is bounded by this, which is what stops an owner's expense
 * label silently breaking the layout for their whole league.
 */
export const MONOSPACE_WIDTH = 25

/** Between label and amount. Two spaces reads as a column; one reads as a typo. */
const LABEL_GAP = '  '

/** Between the two paid places on a line, wide enough to read as separate columns. */
const PLACE_GAP = '   '

/**
 * Clips a label that will not fit, with an ellipsis so the clipping is visible.
 *
 * Visible matters: an owner who sees `Trophy engra…` knows to rename the expense in Setup,
 * where a silently wrapped line just looks like the app is broken. The `…` is one column
 * but nine characters once URL-encoded — irrelevant at the frequency this fires, and worth
 * knowing before anyone uses it in a hot path.
 */
function truncateLabel(label: string, width: number): string {
  return label.length <= width ? label : `${label.slice(0, Math.max(1, width - 1))}…`
}

/**
 * Right-aligns the amounts against the longest label.
 *
 * Only usable where the font is fixed-width — WhatsApp's ``` block and the plaintext
 * email. In a proportional font the padding is invisible noise that still costs budget,
 * which is why the HTML email uses a real table instead.
 */
export function alignRows(rows: PrizeRow[], currency: string): string[] {
  const cells = rows.map((r) => ({ label: r.label, amount: formatCents(r.cents, currency) }))
  const amountWidth = Math.max(...cells.map((c) => c.amount.length))

  /**
   * What is left for the label once the amounts and the gap have taken their share.
   *
   * `MONOSPACE_WIDTH` is the budget; the amounts are not negotiable, so the label absorbs
   * the difference. A floor of 6 keeps something readable in the absurd case (a pot past
   * eight figures) where the amounts alone eat the line — that row wraps, and a league
   * with a $99,999,999 pot has better problems.
   */
  const available = Math.max(6, MONOSPACE_WIDTH - LABEL_GAP.length - amountWidth)
  const labelWidth = Math.min(available, Math.max(...cells.map((c) => c.label.length)))

  return cells.map(
    (c) => `${truncateLabel(c.label, labelWidth).padEnd(labelWidth)}${LABEL_GAP}${c.amount.padStart(amountWidth)}`,
  )
}

/**
 * The paid places, two per line.
 *
 * One per line is the honest layout and costs six lines of budget for a six-place league;
 * two columns halves that while still lining up, which is the whole reason for the
 * monospace block.
 */
export function placeLines(prize: PrizeSummary): string[] {
  const cells = prize.rankPrizeCents.map((c, i) => ({
    place: ordinal(i + 1),
    amount: formatCents(c, prize.currency),
  }))
  if (cells.length === 0) return []

  const placeWidth = Math.max(...cells.map((c) => c.place.length))
  const amountWidth = Math.max(...cells.map((c) => c.amount.length))
  const rendered = cells.map(
    (c) => `${c.place.padEnd(placeWidth)} ${c.amount.padStart(amountWidth)}`,
  )

  /**
   * Two per line only while two fit.
   *
   * The pairing exists to save budget, not because two columns are better — so when the
   * amounts grow enough that a pair would exceed `MONOSPACE_WIDTH`, one per line is the
   * correct answer rather than a wrapped mess. Same failure the labels above had: a layout
   * that is right for the reference league and silently wrong for a richer one.
   */
  const perLine = 2 * (placeWidth + 1 + amountWidth) + PLACE_GAP.length <= MONOSPACE_WIDTH ? 2 : 1

  const lines: string[] = []
  for (let i = 0; i < rendered.length; i += perLine) {
    lines.push(rendered.slice(i, i + perLine).join(PLACE_GAP).trimEnd())
  }
  return lines
}

/**
 * The prize block.
 *
 * Everything derived from the pot is omitted when there isn't one, rather than printed as
 * `$0.00`. The fixed prizes stay: they are amounts per winner rather than shares of a
 * total, so a league that has agreed its rules but not yet counted the money can still say
 * what a gameweek is worth without publishing a pot of nothing.
 *
 * Expenses appear as their own negative line under the pot rather than being folded into
 * it. The pot line states what the league collected, and without the deduction beside it
 * the prizes below no longer add up to the figure above — which somebody in a league of
 * eighteen will notice, and read as an error.
 *
 * The figures sit in a ``` block because WhatsApp renders everything else in a
 * proportional font, where padded columns do not line up and the padding is spent for
 * nothing. Monospace is the only way the amounts actually align, and it costs the fences
 * plus the padding against the ~1,500 character budget — which is why the places are laid
 * out two to a line rather than six.
 */
export function renderPrizeStructure(prize: PrizeSummary): string {
  const lines = ['*Prizes*', '```', ...alignRows(prizeRows(prize), prize.currency)]

  // Each place's share is a slice of the remainder, so it is unknowable without a pot.
  if (prize.potSet && prize.rankPrizeCents.length > 0) {
    lines.push('', ...placeLines(prize))
  }

  lines.push('```')
  return lines.join('\n')
}
