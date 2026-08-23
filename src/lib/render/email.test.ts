import { describe, expect, it } from 'vitest'

import type { DigestStats, StandingRow } from '../digest/stats'
import type { BlockSelection, PrizeSummary } from './blocks'
import { renderEmail, type RenderEmailInput } from './email'

function row(over: Partial<StandingRow> & { entry: number }): StandingRow {
  return {
    entryName: `Team ${over.entry}`,
    playerName: `Player ${over.entry}`,
    rank: 1,
    total: 100,
    eventTotal: 50,
    movement: null,
    pending: false,
    ...over,
  }
}

const stats = (over: Partial<DigestStats> = {}): DigestStats => ({
  gameweek: 3,
  standings: [row({ entry: 1, rank: 1, total: 120 }), row({ entry: 2, rank: 2, total: 110 })],
  gwWinners: [row({ entry: 1, eventTotal: 77 })],
  leagueAverage: 51.4,
  biggestRiser: null,
  biggestFaller: null,
  pendingCount: 0,
  ...over,
})

const ALL: BlockSelection = { overallStandings: true, gwResults: true, prizeStructure: true }

const prize: PrizeSummary = {
  currency: 'USD',
  potSet: true,
  potCents: 180000,
  gwWinnerCents: 1500,
  seasonBestGwCents: 10000,
  expenses: [],
  rankPrizeCents: [40000, 25000],
}

function render(over: Partial<RenderEmailInput> = {}) {
  return renderEmail({
    leagueName: "The Sunday League",
    gameweek: 3,
    body: 'Some prose.',
    blocks: ALL,
    stats: stats(),
    prize,
    ...over,
  })
}

describe('renderEmail', () => {
  it('subjects the email with the league and gameweek', () => {
    expect(render().subject).toBe("The Sunday League - Gameweek 3")
  })

  it('always produces a plaintext alternative', () => {
    // An HTML-only email scores as spam; this is not an optional extra.
    expect(render().text.length).toBeGreaterThan(0)
  })

  /** The reason this renders from stats rather than the WhatsApp strings. */
  it('uses real markup, not WhatsApp asterisks', () => {
    const { html, text } = render()
    expect(html).toContain('<strong>')
    expect(html).not.toContain('*Standings*')
    expect(text).not.toContain('*')
  })

  /** Email has no URL budget — truncating would drop managers for no reason. */
  it('renders every manager, however many there are', () => {
    const many = Array.from({ length: 40 }, (_, i) => row({ entry: i + 1, rank: i + 1 }))
    const { html, text } = render({ stats: stats({ standings: many }) })

    expect(html).toContain('Team 40')
    expect(text).toContain('Team 40')
    expect(html).not.toContain('and 0 more')
  })

  describe('escaping', () => {
    it('escapes team and player names', () => {
      const nasty = row({ entry: 9, rank: 1, entryName: '<script>x</script>', playerName: 'A & B' })
      const { html } = render({ stats: stats({ standings: [nasty] }) })

      expect(html).toContain('&lt;script&gt;')
      expect(html).not.toContain('<script>')
      expect(html).toContain('A &amp; B')
    })

    it('escapes the owner prose', () => {
      expect(render({ body: 'Tom & Jerry <b>win</b>' }).html).toContain('Tom &amp; Jerry &lt;b&gt;')
    })

    it('escapes the signature', () => {
      expect(render({ signature: 'A & B — Admin' }).html).toContain('A &amp; B')
    })

    it('does not double-escape ampersands', () => {
      expect(render({ body: 'a & b' }).html).not.toContain('&amp;amp;')
    })
  })

  describe('blocks', () => {
    it('omits standings when not selected', () => {
      const { html } = render({ blocks: { ...ALL, overallStandings: false } })
      expect(html).not.toContain('Standings')
    })

    it('omits prizes when not selected', () => {
      expect(render({ blocks: { ...ALL, prizeStructure: false } }).html).not.toContain('Prizes')
    })

    it('omits prizes when selected but absent', () => {
      expect(render({ prize: undefined }).html).not.toContain('Prizes')
    })

    it('renders results with no scores yet', () => {
      const { html } = render({ stats: stats({ gwWinners: [], leagueAverage: null }) })
      expect(html).toContain('No scores yet.')
    })
  })

  it('keeps the owner’s paragraph breaks', () => {
    const { html } = render({ body: 'One.\n\nTwo.' })
    expect(html.match(/<p /g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('marks managers with no scores as new', () => {
    const pending = row({ entry: 5, rank: null, total: null, pending: true })
    const { html, text } = render({ stats: stats({ standings: [pending] }) })
    expect(html).toContain('new')
    expect(text).toContain('new')
  })

  it('renders an empty body without an empty paragraph', () => {
    expect(render({ body: '   ' }).html).not.toContain('<p style="margin:0 0 12px;"></p>')
  })
})

/**
 * The prize block with no pot set.
 *
 * Mirrors the WhatsApp case in `blocks.test.ts`, and matters more here: email is the
 * channel this league actually reads, it goes out server-side with no chance to abandon
 * it at a chat picker, and the HTML renderer is a separate code path that would happily
 * print `$0.00` on its own.
 */
describe('renderEmail with an unset pot', () => {
  const unset: PrizeSummary = { ...prize, potSet: false, potCents: 0 }

  it('omits the pot rather than claiming it is zero, in both renderings', () => {
    const { html, text } = render({ prize: unset, blocks: ALL })

    for (const body of [html, text]) {
      expect(body).not.toContain('Pot:')
      expect(body).not.toContain('$0.00')
    }
  })

  it('still states the fixed prizes, which do not depend on a pot', () => {
    const { html, text } = render({ prize: unset, blocks: ALL })

    for (const body of [html, text]) {
      expect(body).toContain('Each GW winner')
      expect(body).toContain('Best GW of season')
      expect(body).toContain('$15.00')
      expect(body).toContain('$100.00')
    }
  })

  it('states the pot when there is one', () => {
    const { html, text } = render({ prize, blocks: ALL })

    for (const body of [html, text]) expect(body).toContain('$1,800.00')
  })

  /** Both renderings again: the HTML and the plaintext are separate code paths. */
  it('names league expenses as a negative amount in both renderings', () => {
    const withExpense: PrizeSummary = {
      ...prize,
      expenses: [{ label: 'Trophy engraving', amountCents: 10000 }],
    }
    const { html, text } = render({ prize: withExpense, blocks: ALL })

    for (const body of [html, text]) {
      expect(body).toContain('Trophy engraving')
      expect(body).toContain('-$100.00')
      expect(body).not.toContain('Less')
    }
  })

  /**
   * The HTML gets a table and the plaintext gets padded columns, because email clients
   * do not agree on a monospace body font — the alignment WhatsApp needs its ``` block
   * for is free here. The fences themselves are WhatsApp markup and must not leak in.
   */
  it('aligns the amounts without borrowing WhatsApp’s markup', () => {
    const { html, text } = render({ prize, blocks: ALL })

    expect(html).toContain('text-align:right')
    expect(html).not.toContain('```')
    expect(text).not.toContain('```')
    // Two columns in the plaintext: label, then the amount padded out to a right edge.
    expect(text).toMatch(/^Each GW winner +\$15\.00$/m)
  })

  // The label is owner-entered and lands in HTML, so it goes through `esc` like every
  // other piece of typed-in text here.
  it('escapes an expense label rather than injecting it as markup', () => {
    const { html } = render({
      prize: { ...prize, expenses: [{ label: '<b>Trophy</b>', amountCents: 10000 }] },
      blocks: ALL,
    })

    expect(html).not.toContain('<b>Trophy</b>')
    expect(html).toContain('&lt;b&gt;Trophy&lt;/b&gt;')
  })
})
