import { describe, expect, it } from 'vitest'

import { parseLeagueId } from './league-config'

describe('parseLeagueId', () => {
  it('falls back to the reference league when unset', () => {
    expect(parseLeagueId(undefined)).toBe(9999999)
  })

  it('treats an empty or blank value as unset', () => {
    expect(parseLeagueId('')).toBe(9999999)
    expect(parseLeagueId('   ')).toBe(9999999)
  })

  it('reads a configured numeric id', () => {
    expect(parseLeagueId('314')).toBe(314)
  })

  /** The documented trap: the join code is not the league ID and never converts to one. */
  it('rejects an invite code rather than yielding NaN', () => {
    expect(() => parseLeagueId('1xrliv')).toThrow(/invite code/i)
  })

  it.each(['0', '-5', '12.5', 'abc'])('rejects %s', (raw) => {
    expect(() => parseLeagueId(raw)).toThrow(/FPL_LEAGUE_ID/)
  })
})
