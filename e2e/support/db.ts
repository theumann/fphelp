import { randomUUID } from 'node:crypto'

import { Pool } from 'pg'

import { FIXTURE_LEAGUE_ID, FIXTURE_LEAGUE_NAME } from '../../src/lib/fpl/fixtures'

/**
 * Direct database access for tests, deliberately not going through `src/db`.
 *
 * That module memoises a pool on `globalThis` and is imported by the app under test; a
 * second copy in the Playwright process would be a different pool against the same
 * database, and sharing it would tangle test setup with the server's connection
 * lifecycle. A plain `pg.Pool` here is simpler and disposable.
 */

export const OWNER_EMAIL = 'owner@example.test'
export const CO_OWNER_EMAIL = 'co-owner@example.test'

function url(): string {
  const value = process.env.DATABASE_URL
  if (!value) throw new Error('DATABASE_URL is not set for the e2e suite')

  /**
   * The guard that makes the rest of this file safe to run.
   *
   * Everything below truncates tables. Pointed at the wrong database it would delete a
   * real league's digests and dues, and the owner's own writing is not reproducible from
   * the API. So the suite refuses any database whose name does not say it is the test
   * one, rather than trusting whatever `.env` happens to hold.
   */
  if (!/\/fphelp_e2e(\?|$)/.test(value)) {
    throw new Error(
      `Refusing to run the e2e suite against "${value.replace(/:[^:@]*@/, ':***@')}". ` +
        'The database name must be `fphelp_e2e` — these tests truncate every table.',
    )
  }

  return value
}

export function pool(): Pool {
  return new Pool({ connectionString: url() })
}

/**
 * Empties every table between tests.
 *
 * `TRUNCATE ... CASCADE` rather than dropping and re-migrating: it is fast enough to run
 * per test, which is what keeps tests independent of the order they run in.
 */
export async function resetDatabase(p: Pool) {
  await p.query(`
    TRUNCATE TABLE
      deliveries, messages, digests, dues, winnings, prize_rules,
      manager_gw_history, managers, recipients, league_users,
      sessions, accounts, verification_tokens, users, leagues
    RESTART IDENTITY CASCADE
  `)
}

export interface SeededLeague {
  leagueId: string
  ownerId: string
  /** The cookie value that authenticates the owner. */
  sessionToken: string
}

/**
 * Creates a league with one signed-in owner, and returns a usable session.
 *
 * Auth is a magic link, so the honest route would be requesting one and following it out
 * of the dev server's console. That is slow, serialises the suite on an email flow that
 * is not what any of these tests are about, and cannot run against a production build,
 * where the link is emailed rather than logged. Inserting the session row the adapter
 * would have written gets the same state — `session.strategy` is `'database'`, so the
 * cookie is only a lookup key, and nothing else about the session is derived.
 *
 * The cost is real and worth naming: **these tests never exercise sign-in.** That path
 * needs its own test, driving the link end to end.
 */
export async function seedLeague(
  p: Pool,
  opts: { email?: string; name?: string; managerEntry?: number | null } = {},
): Promise<SeededLeague> {
  const email = opts.email ?? OWNER_EMAIL

  const { rows: users } = await p.query<{ id: string }>(
    `INSERT INTO users (email, name, email_verified) VALUES ($1, $2, now()) RETURNING id`,
    [email, opts.name ?? 'Test Owner'],
  )
  const ownerId = users[0].id

  const { rows: leagues } = await p.query<{ id: string }>(
    `INSERT INTO leagues (fpl_league_id, name) VALUES ($1, $2) RETURNING id`,
    [FIXTURE_LEAGUE_ID, FIXTURE_LEAGUE_NAME],
  )
  const leagueId = leagues[0].id

  await p.query(
    `INSERT INTO league_users (league_id, user_id, manager_entry) VALUES ($1, $2, $3)`,
    [leagueId, ownerId, opts.managerEntry ?? null],
  )

  const sessionToken = randomUUID()
  await p.query(
    `INSERT INTO sessions (session_token, user_id, expires) VALUES ($1, $2, now() + interval '1 day')`,
    [sessionToken, ownerId],
  )

  return { leagueId, ownerId, sessionToken }
}

/** Adds a second owner to an existing league, for the co-owner cases. */
export async function addOwnerRow(p: Pool, leagueId: string, email: string, name?: string) {
  const { rows } = await p.query<{ id: string }>(
    `INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`,
    [email, name ?? null],
  )
  await p.query(`INSERT INTO league_users (league_id, user_id) VALUES ($1, $2)`, [
    leagueId,
    rows[0].id,
  ])
  return rows[0].id
}

/** A signed-in user who owns no league — the `NotAnOwner` case. */
export async function seedStranger(p: Pool, email = 'stranger@example.test') {
  const { rows } = await p.query<{ id: string }>(
    `INSERT INTO users (email, email_verified) VALUES ($1, now()) RETURNING id`,
    [email],
  )
  const sessionToken = randomUUID()
  await p.query(
    `INSERT INTO sessions (session_token, user_id, expires) VALUES ($1, $2, now() + interval '1 day')`,
    [sessionToken, rows[0].id],
  )
  return { userId: rows[0].id, sessionToken }
}

export async function listOwnerEmails(p: Pool, leagueId: string): Promise<string[]> {
  const { rows } = await p.query<{ email: string }>(
    `SELECT u.email FROM league_users lu
       JOIN users u ON u.id = lu.user_id
      WHERE lu.league_id = $1
      ORDER BY lu.created_at`,
    [leagueId],
  )
  return rows.map((r) => r.email)
}
