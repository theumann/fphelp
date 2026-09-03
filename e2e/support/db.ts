import { randomUUID } from 'node:crypto'

import { Pool } from 'pg'

import { FIXTURE_LEAGUE_ID, fixtureLeagueName } from '../../src/lib/fpl/fixtures'

import { checkE2eDatabaseUrl } from './db-url'

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

/**
 * Every pool in the suite comes from here, so the guard cannot be sidestepped by
 * connecting somewhere else. See `db-url.ts` for what it refuses and why.
 */
export function pool(): Pool {
  const { url } = checkE2eDatabaseUrl(process.env.DATABASE_URL)
  return new Pool({ connectionString: url })
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
  opts: {
    email?: string
    name?: string
    managerEntry?: number | null
    /** Turns the league's email channel on, which is what makes /send show its tabs. */
    emailEnabled?: boolean
    /** Addresses on the recipient list. The send button names how many there are. */
    recipients?: string[]
    /** Defaults to the column default (hidden), matching a league that never chose. */
    hideRecipients?: boolean
    /**
     * A second league for the same owner, for the chooser and isolation cases. Defaults
     * to the fixture league; `fixtureLeagueName` decides what the fake API calls it.
     */
    fplLeagueId?: number
    /** Reuses an existing owner instead of creating one, which is what makes them co-exist. */
    ownerId?: string
  } = {},
): Promise<SeededLeague> {
  const email = opts.email ?? OWNER_EMAIL

  let ownerId = opts.ownerId
  if (!ownerId) {
    const { rows: users } = await p.query<{ id: string }>(
      `INSERT INTO users (email, name, email_verified) VALUES ($1, $2, now()) RETURNING id`,
      [email, opts.name ?? 'Test Owner'],
    )
    ownerId = users[0].id
  }

  const fplLeagueId = opts.fplLeagueId ?? FIXTURE_LEAGUE_ID
  const { rows: leagues } = await p.query<{ id: string }>(
    `INSERT INTO leagues (fpl_league_id, name, email_enabled, hide_recipients)
       VALUES ($1, $2, $3, $4) RETURNING id`,
    [
      fplLeagueId,
      fixtureLeagueName(fplLeagueId),
      opts.emailEnabled ?? false,
      opts.hideRecipients ?? true,
    ],
  )
  const leagueId = leagues[0].id

  for (const address of opts.recipients ?? []) {
    await p.query(`INSERT INTO recipients (league_id, email) VALUES ($1, $2)`, [leagueId, address])
  }

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
export async function seedStranger(
  p: Pool,
  email = 'stranger@example.test',
  /** Grants `can_create_leagues` — what `add-owner.mts` does and Setup's owners list does not. */
  mayCreate = false,
) {
  const { rows } = await p.query<{ id: string }>(
    `INSERT INTO users (email, email_verified, can_create_leagues) VALUES ($1, now(), $2) RETURNING id`,
    [email, mayCreate],
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
