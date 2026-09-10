import { beforeEach, describe, expect, it } from 'vitest'

import {
  rateLimit,
  resetRateLimits,
  SIGNIN_PER_EMAIL,
  SIGNIN_PER_IP,
  type RateLimitRule,
} from './rate-limit'

/**
 * The counters are process-global, so every test starts from a clean slate — otherwise
 * these pass or fail depending on the order they run in.
 */
beforeEach(resetRateLimits)

const rule: RateLimitRule = { limit: 3, windowMs: 1_000 }

describe('rateLimit', () => {
  it('allows up to the limit and refuses the next', () => {
    for (let i = 0; i < 3; i++) expect(rateLimit('a', rule, 0).allowed).toBe(true)
    expect(rateLimit('a', rule, 0).allowed).toBe(false)
  })

  it('counts each key separately', () => {
    for (let i = 0; i < 3; i++) rateLimit('a', rule, 0)
    expect(rateLimit('b', rule, 0).allowed).toBe(true)
  })

  it('allows again once the window has passed', () => {
    for (let i = 0; i < 3; i++) rateLimit('a', rule, 0)
    expect(rateLimit('a', rule, 500).allowed).toBe(false)
    expect(rateLimit('a', rule, 1_001).allowed).toBe(true)
  })

  /**
   * The property that stops a burst being cheap: a refused attempt still counts, so
   * hammering keeps the key limited instead of letting the window drain while the
   * attacker keeps trying.
   */
  it('counts refused attempts, so hammering does not shorten the wait', () => {
    for (let i = 0; i < 3; i++) rateLimit('a', rule, 0)
    for (let i = 0; i < 10; i++) rateLimit('a', rule, 900)

    // The window is measured from the most recent attempt, not the first allowed one.
    expect(rateLimit('a', rule, 1_001).allowed).toBe(false)
    expect(rateLimit('a', rule, 1_901).allowed).toBe(true)
  })

  it('reports how long is left, for the message shown to the owner', () => {
    for (let i = 0; i < 3; i++) rateLimit('a', rule, 0)
    expect(rateLimit('a', rule, 400).retryAfterMs).toBe(600)
  })

  /** A limit of zero would refuse everyone; nothing should configure that by accident. */
  it('treats the configured sign-in limits as sane', () => {
    for (const r of [SIGNIN_PER_EMAIL, SIGNIN_PER_IP]) {
      expect(r.limit).toBeGreaterThan(1)
      expect(r.windowMs).toBeGreaterThan(0)
    }
    // Per-IP must be looser than per-address, or the address rule could never bite first.
    expect(SIGNIN_PER_IP.limit).toBeGreaterThan(SIGNIN_PER_EMAIL.limit)
  })
})
