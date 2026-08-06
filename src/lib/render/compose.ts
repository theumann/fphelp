import type { DigestStats } from '../digest/stats'
import {
  renderGwResults,
  renderPrizeStructure,
  renderStandings,
  type BlockSelection,
  type PrizeSummary,
} from './blocks'
import { budgetFor, DEFAULT_BUDGET, encodedLength, type BudgetState } from './budget'

export interface ComposeInput {
  /** The owner's own prose. The generated blocks are assembled around it. */
  body: string
  blocks: BlockSelection
  stats: DigestStats
  prize?: PrizeSummary
  /**
   * Per-sender signature, e.g. "Thierry — Team Name Manager and League Name Admin".
   * Applied at send time from the sending owner's row, never baked into the stored digest.
   */
  signature?: string
  budget?: number
}

export interface ComposedMessage {
  text: string
  budget: BudgetState
  /** Set when standings rows were dropped to fit. */
  truncatedRows: number
}

/**
 * Assembles the message the owner will send.
 *
 * The owner's prose, the gameweek results, the prize block and the signature are all
 * fixed cost. Standings is elastic, so when the message doesn't fit it is the block that
 * gets trimmed — never the owner's own words.
 */
export function composeMessage(input: ComposeInput): ComposedMessage {
  const limit = input.budget ?? DEFAULT_BUDGET

  const lead: string[] = []
  if (input.body.trim()) lead.push(input.body.trim())
  if (input.blocks.gwResults) lead.push(renderGwResults(input.stats))
  if (input.blocks.prizeStructure && input.prize) {
    lead.push(renderPrizeStructure(input.prize))
  }

  // Rendered as-is: the signature already reads "Name — Team Manager and League Admin",
  // so prefixing another dash produces "— Name — Team…".
  const signature = input.signature?.trim() ?? ''

  const build = (standings: string) =>
    [...lead, standings, signature].filter(Boolean).join('\n\n')

  if (!input.blocks.overallStandings) {
    const text = build('')
    return { text, budget: budgetFor(text, limit), truncatedRows: 0 }
  }

  const totalRows = input.stats.standings.length
  const full = build(renderStandings(input.stats))
  if (encodedLength(full) <= limit) {
    return { text: full, budget: budgetFor(full, limit), truncatedRows: 0 }
  }

  // Binary search the largest row count that fits. The trimmed block carries its own
  // "…and N more" line, so the reader knows the table was cut rather than the league
  // being that small.
  let low = 0
  let high = totalRows
  let best = build(renderStandings(input.stats, 0))
  let bestRows = 0

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidate = build(renderStandings(input.stats, mid))

    if (encodedLength(candidate) <= limit) {
      best = candidate
      bestRows = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return {
    text: best,
    budget: budgetFor(best, limit),
    truncatedRows: totalRows - bestRows,
  }
}
