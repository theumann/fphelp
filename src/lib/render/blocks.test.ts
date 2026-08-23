import { describe, expect, it } from 'vitest'

import {
  NO_BLOCKS,
  dependsOnGameweek,
  effectiveBlocks,
  ordinal,
  renderPrizeStructure,
  type BlockSelection,
  type PrizeSummary,
} from './blocks'

const base: PrizeSummary = {
  currency: 'USD',
  potSet: true,
  potCents: 180_000,
  gwWinnerCents: 1_500,
  seasonBestGwCents: 10_000,
  expenses: [],
  rankPrizeCents: [45_200, 28_250, 16_950, 11_300, 6_780, 4_520],
}

describe('renderPrizeStructure', () => {
  it('states the pot and every place when one is set', () => {
    const text = renderPrizeStructure(base)
    expect(text).toMatch(/^Pot +\$1,800\.00$/m)
    expect(text).toMatch(/^1st +\$452\.00/m)
    expect(text).toMatch(/6th +\$45\.20$/m)
  })

  /**
   * The fences are load-bearing, not decoration: WhatsApp renders everything outside them
   * in a proportional font, where every space of padding below is spent on nothing.
   */
  it('wraps the figures in a monospace block, so the padding aligns them', () => {
    const lines = renderPrizeStructure(base).split('\n')
    expect(lines[0]).toBe('*Prizes*')
    expect(lines[1]).toBe('```')
    expect(lines.at(-1)).toBe('```')
  })

  it('right-aligns the amounts against the longest label', () => {
    const ends = renderPrizeStructure(base)
      .split('\n')
      .filter((l) => /\$/.test(l) && !/^\d/.test(l))
      .map((l) => l.length)

    expect(new Set(ends).size).toBe(1)
  })

  /**
   * The failure this exists to prevent: a league is handed over before anyone has counted
   * the money, and the digest tells eighteen people their pot is $0.00 and first place is
   * worth nothing. Both are false, both look deliberate, and it goes out over the owner's
   * name.
   */
  it('omits the pot entirely rather than claiming it is zero', () => {
    const text = renderPrizeStructure({ ...base, potSet: false, potCents: 0 })

    expect(text).not.toContain('Pot:')
    expect(text).not.toContain('$0.00')
  })

  it('omits the per-place shares too, since each is a slice of the pot', () => {
    const text = renderPrizeStructure({ ...base, potSet: false, potCents: 0 })
    expect(text).not.toContain('Final table:')
  })

  /**
   * The fixed prizes survive, and should: they are amounts per winner rather than shares
   * of a total, so they are true whether or not the money has been counted.
   */
  it('still states what a gameweek and the best gameweek are worth', () => {
    const text = renderPrizeStructure({ ...base, potSet: false, potCents: 0 })

    expect(text).toMatch(/^Each GW winner +\$15\.00$/m)
    expect(text).toMatch(/^Best GW of season +\$100\.00$/m)
  })

  /**
   * Why the expense is printed rather than quietly folded into a smaller pot: the pot
   * line says what the league collected, and the prizes below it are shares of what is
   * left. Without the deduction between them the block invites eighteen people to do
   * arithmetic that does not come out.
   */
  describe('with league expenses', () => {
    const withEngraving: PrizeSummary = {
      ...base,
      expenses: [{ label: 'Trophy engraving', amountCents: 10_000 }],
    }

    /**
     * Negative, not prefixed with "Less". The sign is what marks a deduction in a column
     * of figures, and unlike a prefix it survives right-alignment rather than pushing the
     * label along.
     */
    it('names each cost and shows it as a negative amount', () => {
      const text = renderPrizeStructure(withEngraving)
      expect(text).toMatch(/^Trophy engraving +-\$100\.00$/m)
      expect(text).not.toContain('Less')
    })

    it('keeps the pot line above the deduction, in the order the money moves', () => {
      const lines = renderPrizeStructure(withEngraving).split('\n')
      expect(lines.findIndex((l) => l.startsWith('Pot'))).toBeLessThan(
        lines.findIndex((l) => l.startsWith('Trophy engraving')),
      )
    })

    it('adds nothing for a league with no costs', () => {
      expect(renderPrizeStructure(base)).not.toContain('Trophy')
      // No stray minus sign either — every figure in a costless league is money owed out.
      expect(renderPrizeStructure(base)).not.toContain('-$')
    })

    // A subtraction with nothing above it to subtract from, next to prizes that are
    // stated in full — the pot's own "unset is not zero" rule, one line down.
    it('omits the costs when there is no pot, as it omits the pot', () => {
      const text = renderPrizeStructure({ ...withEngraving, potSet: false, potCents: 0 })
      expect(text).not.toContain('Trophy engraving')
    })
  })
})

describe('ordinal', () => {
  it('labels the places a league actually pays', () => {
    expect([1, 2, 3, 4, 6].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '6th'])
  })

  /**
   * Not reachable today — no league pays eleven places — but the rule is the whole reason
   * this is a function rather than a suffix lookup, and getting it wrong reads as a typo
   * in a message sent to the whole league.
   */
  it('knows the teens are all th, and that 21 is not', () => {
    expect([11, 12, 13, 21].map(ordinal)).toEqual(['11th', '12th', '13th', '21st'])
  })
})

/**
 * The guard that survives a stale draft.
 *
 * Greying out the checkboxes is not enough on its own: a draft saved after last week's
 * gameweek, or a league whose defaults switch standings on, arrives with blocks already
 * selected. Without this, the message composed mid-gameweek would still carry a table of
 * scores that change before the day is out.
 */
describe('effectiveBlocks', () => {
  const all: BlockSelection = {
    overallStandings: true,
    gwResults: true,
    prizeStructure: true,
  }

  it('honours the selection once the figures are real', () => {
    expect(effectiveBlocks(all, true)).toEqual(all)
  })

  it('drops the gameweek-derived blocks while it is unsettled, whatever was selected', () => {
    expect(effectiveBlocks(all, false)).toEqual({
      overallStandings: false,
      gwResults: false,
      // Kept: the prize figures come from the league's settings, not from any match.
      prizeStructure: true,
    })
  })

  it('knows which blocks a live gameweek actually affects', () => {
    expect(dependsOnGameweek('overallStandings')).toBe(true)
    expect(dependsOnGameweek('gwResults')).toBe(true)
    expect(dependsOnGameweek('prizeStructure')).toBe(false)
  })

  it('leaves an already-empty selection alone', () => {
    expect(effectiveBlocks(NO_BLOCKS, false)).toEqual(NO_BLOCKS)
    expect(effectiveBlocks(NO_BLOCKS, true)).toEqual(NO_BLOCKS)
  })
})
