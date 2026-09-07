import { afterEach, describe, expect, it } from 'vitest'

import { authorisedJobRequest } from './jobs-auth'

/**
 * The token check for the operator-only routes.
 *
 * Worth testing despite being ten lines, because every failure mode here is silent: a
 * check that wrongly returns `true` looks exactly like a working endpoint, and the one
 * that matters most — an unset `JOBS_TOKEN` — is the state a fresh environment starts in.
 */

const original = process.env.JOBS_TOKEN

afterEach(() => {
  if (original === undefined) delete process.env.JOBS_TOKEN
  else process.env.JOBS_TOKEN = original
})

const withHeader = (value?: string) =>
  new Request('https://example.test/api/jobs/capture-history', {
    method: 'POST',
    headers: value === undefined ? {} : { authorization: value },
  })

describe('authorisedJobRequest', () => {
  it('accepts the configured token', () => {
    process.env.JOBS_TOKEN = 'correct-horse'
    expect(authorisedJobRequest(withHeader('Bearer correct-horse'))).toBe(true)
  })

  it('rejects a wrong token', () => {
    process.env.JOBS_TOKEN = 'correct-horse'
    expect(authorisedJobRequest(withHeader('Bearer battery-staple'))).toBe(false)
  })

  it('rejects a missing header', () => {
    process.env.JOBS_TOKEN = 'correct-horse'
    expect(authorisedJobRequest(withHeader())).toBe(false)
  })

  /** The token without the scheme is the shape a hand-written curl gets wrong. */
  it('rejects the bare token with no Bearer prefix', () => {
    process.env.JOBS_TOKEN = 'correct-horse'
    expect(authorisedJobRequest(withHeader('correct-horse'))).toBe(false)
  })

  /**
   * The case the whole thing exists for. An unset variable is how a new environment and a
   * mistyped variable name both present, and reading it as "no check required" would leave
   * the endpoint open exactly when nobody is looking.
   */
  it('fails closed when JOBS_TOKEN is unset', () => {
    delete process.env.JOBS_TOKEN
    expect(authorisedJobRequest(withHeader('Bearer anything'))).toBe(false)
    expect(authorisedJobRequest(withHeader())).toBe(false)
  })

  it('fails closed on an empty JOBS_TOKEN, rather than matching an empty header', () => {
    process.env.JOBS_TOKEN = ''
    expect(authorisedJobRequest(withHeader('Bearer '))).toBe(false)
  })

  /**
   * Hashing before comparing is what lets tokens of different lengths be compared at all —
   * `timingSafeEqual` throws on unequal buffers, so an unhashed version would 500 rather
   * than reject.
   */
  it('rejects a token of a different length without throwing', () => {
    process.env.JOBS_TOKEN = 'short'
    expect(() =>
      authorisedJobRequest(withHeader('Bearer ' + 'x'.repeat(500))),
    ).not.toThrow()
    expect(authorisedJobRequest(withHeader('Bearer ' + 'x'.repeat(500)))).toBe(false)
  })
})
