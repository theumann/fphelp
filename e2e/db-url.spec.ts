import { expect, test } from '@playwright/test'

import { checkE2eDatabaseUrl, redact } from './support/db-url'

/**
 * The database guard.
 *
 * A plain unit test that happens to live under Playwright, because everything in `e2e/`
 * belongs to Playwright and Vitest is scoped to `src/**` — see `vitest.config.ts`. No
 * browser is involved, so it costs nothing to run here.
 *
 * Worth testing at all because this is the only thing standing between `npm run e2e` and
 * a real database, and its interesting behaviour is entirely in the paths that throw.
 */

const OK = 'postgresql://postgres:secret@localhost:5432/fphelp_e2e'

test('accepts a local fphelp_e2e database', () => {
  expect(checkE2eDatabaseUrl(OK)).toMatchObject({ host: 'localhost', database: 'fphelp_e2e' })
})

test('accepts loopback addresses, including IPv6', () => {
  expect(checkE2eDatabaseUrl('postgresql://u:p@127.0.0.1:5432/fphelp_e2e').host).toBe('127.0.0.1')
  expect(checkE2eDatabaseUrl('postgresql://u:p@[::1]:5432/fphelp_e2e').host).toBe('::1')
})

test('refuses the development database', () => {
  expect(() => checkE2eDatabaseUrl('postgresql://u:p@localhost:5432/fphelp_dev')).toThrow(
    /must be named "fphelp_e2e"/,
  )
})

/** The case the name check alone cannot see, and the reason the host check exists. */
test('refuses a remote host even when the name is right', () => {
  expect(() =>
    checkE2eDatabaseUrl('postgresql://u:p@postgres.railway.internal:5432/fphelp_e2e'),
  ).toThrow(/must be local/)
})

test('refuses a missing or unparseable value', () => {
  expect(() => checkE2eDatabaseUrl(undefined)).toThrow(/not set/)
  expect(() => checkE2eDatabaseUrl('   ')).toThrow(/not set/)
  expect(() => checkE2eDatabaseUrl('not-a-url')).toThrow(/not a valid URL/)
})

/** The message names the URL, so it must not name the password. */
test('never repeats the password back', () => {
  const secret = 'hunter2'
  let message = ''
  try {
    checkE2eDatabaseUrl(`postgresql://postgres:${secret}@localhost:5432/fphelp_dev`)
  } catch (err) {
    message = err instanceof Error ? err.message : String(err)
  }

  expect(message).toContain('fphelp_dev')
  expect(message).not.toContain(secret)
  expect(redact(OK)).toBe('postgresql://postgres:***@localhost:5432/fphelp_e2e')
})
