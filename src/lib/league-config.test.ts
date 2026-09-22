import { describe, expect, it } from 'vitest'

import { parseLeagueId, parseLeagueSegment } from './league-config'

describe('parseLeagueId', () => {
  /**
   * There is no default league, and an unset value must not resolve to a guess — a script
   * acting on a league nobody named is the failure this replaced.
   */
  it('throws when unset rather than falling back to a league', () => {
    expect(() => parseLeagueId(undefined)).toThrow(/no default league/i)
  })

  it('treats an empty or blank value as unset', () => {
    expect(() => parseLeagueId('')).toThrow(/no default league/i)
    expect(() => parseLeagueId('   ')).toThrow(/no default league/i)
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

/**
 * The URL segment parser, which is a different job from the one above.
 *
 * A bad `FPL_LEAGUE_ID` is a misconfigured deployment and throws; a bad URL segment is a
 * stranger in the address bar and returns null, which the caller turns into a 404. These
 * cases are all reachable by typing, so the parser is the boundary rather than a
 * formality — everything it lets through becomes a database lookup.
 */
describe('parseLeagueSegment', () => {
  it('reads a plain numeric id', () => {
    expect(parseLeagueSegment('9999999')).toBe(9999999)
  })

  it('returns null rather than throwing, since the caller renders a 404', () => {
    expect(parseLeagueSegment('1xrliv')).toBeNull()
    expect(parseLeagueSegment('')).toBeNull()
  })

  /**
   * The reason this is stricter than `Number()`. Every one of these coerces to a valid
   * number, so a laxer parser would send them all to the database and give the same
   * league two or more URLs — `/l/9999999` and `/l/0x98967f` resolving alike.
   */
  it.each(['0x98967f', '1e5', ' 9999999 ', '9999999\n', '+9999999', 'Infinity'])(
    'rejects %j, which Number() would accept',
    (raw) => {
      expect(parseLeagueSegment(raw)).toBeNull()
    },
  )

  /** A leading zero is a second spelling of the same id, so it is refused too. */
  it('rejects leading zeros and zero itself', () => {
    expect(parseLeagueSegment('09999999')).toBeNull()
    expect(parseLeagueSegment('0')).toBeNull()
  })

  it.each(['-5', '12.5', 'abc', '12abc', '../9999999'])('rejects %j', (raw) => {
    expect(parseLeagueSegment(raw)).toBeNull()
  })

  /** Past 2^53 the value stops round-tripping, so it can never match a stored id. */
  it('rejects an integer too large to be exact', () => {
    expect(parseLeagueSegment('9007199254740993')).toBeNull()
    expect(parseLeagueSegment('9007199254740991')).toBe(9_007_199_254_740_991)
  })
})
