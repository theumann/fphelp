import { describe, expect, it } from 'vitest'

import {
  NO_BLOCKS,
  dependsOnGameweek,
  effectiveBlocks,
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
  rankPrizeCents: [45_200, 28_250, 16_950, 11_300, 6_780, 4_520],
}

describe('renderPrizeStructure', () => {
  it('states the pot and every place when one is set', () => {
    const text = renderPrizeStructure(base)
    expect(text).toContain('Pot: $1,800.00')
    expect(text).toContain('Final table:')
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

    expect(text).toContain('Each GW winner: $15.00')
    expect(text).toContain('Best GW of season: $100.00')
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
