import { describe, expect, it } from 'vitest'

import { computeDigestStats } from '../digest/stats'
import type { RosterManager } from '../fpl/roster'
import { budgetFor, encodedLength } from './budget'
import type { BlockSelection, PrizeSummary } from './blocks'
import { composeMessage } from './compose'
import { assertNoPhoneNumber, buildWhatsAppLinks } from './whatsapp'

function league(count: number, opts: { pending?: boolean } = {}): RosterManager[] {
  return Array.from({ length: count }, (_, i) => ({
    entry: i + 1,
    entryName: `Team Name ${i + 1}`,
    playerName: `Player Name ${i + 1}`,
    rank: opts.pending ? null : i + 1,
    lastRank: opts.pending ? null : i + 2,
    total: opts.pending ? null : 500 - i,
    eventTotal: opts.pending ? null : 60 - i,
    pending: opts.pending ?? false,
  }))
}

const allBlocks: BlockSelection = {
  overallStandings: true,
  gwResults: true,
  prizeStructure: true,
}

const prize: PrizeSummary = {
  currency: 'USD',
  potCents: 180_000,
  gwWinnerCents: 1_500,
  seasonBestGwCents: 10_000,
  rankPrizeCents: [45_200, 28_250, 16_950, 11_300, 6_780, 4_520],
}

const stats = (count: number, opts?: { pending?: boolean }) =>
  computeDigestStats(league(count, opts), 5)

describe('composeMessage', () => {
  it("puts the owner's prose first and the signature last", () => {
    const { text } = composeMessage({
      body: 'Big week lads.',
      blocks: allBlocks,
      stats: stats(6),
      prize,
      signature: 'Thierry — Team Name Manager and League Admin',
    })

    expect(text.startsWith('Big week lads.')).toBe(true)
    expect(text.trimEnd().endsWith('League Admin')).toBe(true)
  })

  it('includes only the blocks that are selected', () => {
    const { text } = composeMessage({
      body: 'Short note.',
      blocks: { overallStandings: false, gwResults: true, prizeStructure: false },
      stats: stats(6),
      prize,
    })

    expect(text).toContain('Gameweek 5')
    expect(text).not.toContain('*Standings*')
    expect(text).not.toContain('*Prizes*')
  })

  it('works with no blocks at all — just the owner writing something', () => {
    const { text } = composeMessage({
      body: 'Deadline is Friday, get your teams in.',
      blocks: { overallStandings: false, gwResults: false, prizeStructure: false },
      stats: stats(6),
    })

    expect(text).toBe('Deadline is Friday, get your teams in.')
  })

  it('fits a typical league within the budget untruncated', () => {
    const result = composeMessage({
      body: 'Solid week, some big movers.',
      blocks: allBlocks,
      stats: stats(18),
      prize,
      signature: 'Thierry — Team Name Manager and League Admin',
    })

    expect(result.budget.overBudget).toBe(false)
    expect(result.truncatedRows).toBe(0)
  })

  // A large league blows the budget on standings alone — the point of making it elastic.
  it('trims standings rather than exceeding the budget', () => {
    const result = composeMessage({
      body: 'Massive week.',
      blocks: allBlocks,
      stats: stats(120),
      prize,
      signature: 'Thierry — Team Name Manager and League Admin',
    })

    expect(result.budget.overBudget).toBe(false)
    expect(result.truncatedRows).toBeGreaterThan(0)
    expect(result.text).toContain('…and')
  })

  it("never trims the owner's own words to make room", () => {
    const body = 'A '.repeat(200).trim()
    const result = composeMessage({ body, blocks: allBlocks, stats: stats(60), prize })

    expect(result.text).toContain(body)
  })

  it('reports going over budget when the fixed parts alone are too long', () => {
    const result = composeMessage({
      body: 'X'.repeat(3000),
      blocks: { overallStandings: false, gwResults: false, prizeStructure: false },
      stats: stats(6),
    })

    expect(result.budget.overBudget).toBe(true)
    expect(result.budget.remaining).toBeLessThan(0)
  })

  // The real pre-season state: everyone is a new entry with no scores.
  it('does not invent a winner when nobody has scored', () => {
    const { text } = composeMessage({
      body: 'Season starts soon.',
      blocks: allBlocks,
      stats: stats(14, { pending: true }),
      prize,
    })

    expect(text).toContain('No scores yet.')
    expect(text).toContain('new')
  })
})

describe('budget', () => {
  // Newlines cost 3 chars encoded, which is why raw length badly understates a table.
  it('measures encoded length, not raw characters', () => {
    const table = 'a\nb\nc'
    expect(table.length).toBe(5)
    // 3 letters + 2 newlines at 3 chars each (%0A)
    expect(encodedLength(table)).toBe(9)
  })

  it('counts accented team names at their real cost', () => {
    expect(encodedLength('Zoë')).toBeGreaterThan('Zoë'.length)
  })

  it('reports remaining characters', () => {
    const state = budgetFor('hello', 1500)
    expect(state.used).toBe(5)
    expect(state.remaining).toBe(1495)
    expect(state.overBudget).toBe(false)
  })
})

describe('buildWhatsAppLinks', () => {
  it('builds both forms with no phone number', () => {
    const links = buildWhatsAppLinks('Hello league')

    expect(links.app).toBe('whatsapp://send?text=Hello%20league')
    expect(links.web).toBe('https://wa.me/?text=Hello%20league')
    expect(() => assertNoPhoneNumber(links.app)).not.toThrow()
    expect(() => assertNoPhoneNumber(links.web)).not.toThrow()
  })

  it('round-trips the composed text exactly', () => {
    const { text } = composeMessage({
      body: 'Week 5 — big moves, see below.',
      blocks: allBlocks,
      stats: stats(18),
      prize,
      signature: 'Thierry — Team Name Manager and League Admin',
    })

    const links = buildWhatsAppLinks(text)
    const decoded = decodeURIComponent(links.web.split('?text=')[1])
    expect(decoded).toBe(text)
  })

  // The silent failure this guard exists for: a link with a number still looks fine.
  it('rejects links that carry a recipient', () => {
    expect(() => assertNoPhoneNumber('https://wa.me/447700900000?text=hi')).toThrow(/groups/)
    expect(() => assertNoPhoneNumber('whatsapp://send/447700900000?text=hi')).toThrow(/groups/)
  })
})
