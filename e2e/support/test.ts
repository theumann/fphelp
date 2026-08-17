import { test as base, type Page } from '@playwright/test'
import type { Pool } from 'pg'

import { pool, resetDatabase, seedLeague, type SeededLeague } from './db'

/**
 * The suite's own `test`, with a clean database and a signed-in owner.
 *
 * Every test gets a truncated database and its own league, so tests are independent of
 * order and of each other. That matters more than it usually would: this app's state is
 * almost entirely in Postgres — the FPL side is fixtures and the UI holds nothing across
 * a reload — so a leaked row is the only way one test can corrupt another.
 */

/** Auth.js names the cookie by scheme. The suite is http on localhost. */
const SESSION_COOKIE = 'authjs.session-token'

interface Fixtures {
  db: Pool
  /** The league seeded for this test, with its owner. */
  league: SeededLeague
  /** A page already carrying the owner's session cookie. */
  ownerPage: Page
}

export const test = base.extend<Fixtures>({
  db: async ({}, use) => {
    const p = pool()
    await resetDatabase(p)
    await use(p)
    await p.end()
  },

  league: async ({ db }, use) => {
    await use(await seedLeague(db))
  },

  ownerPage: async ({ context, page, league }, use) => {
    await context.addCookies([
      {
        name: SESSION_COOKIE,
        value: league.sessionToken,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ])
    await use(page)
  },
})

/** Signs the given session token into the browser context, for non-owner cases. */
export async function useSession(page: Page, sessionToken: string) {
  await page.context().addCookies([
    {
      name: SESSION_COOKIE,
      value: sessionToken,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
}

export { expect } from '@playwright/test'
