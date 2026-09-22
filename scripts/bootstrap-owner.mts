/**
 * Idempotently ensures the bootstrap owner exists, from BOOTSTRAP_OWNER_EMAIL.
 *
 * Runs as part of the pre-deploy command. Sign-in is allowlist-based, so without at
 * least one owner row nobody can get in — and the production database is deliberately
 * not reachable from a developer machine, so this cannot be done by hand.
 *
 * A no-op when the variable is unset, or when the owner already exists.
 *
 * **It must never fail a deploy.** This runs from `preDeployCommand`, so anything it throws
 * stops the new release rather than merely skipping a seeding step. That is why an unset
 * `FPL_LEAGUE_ID` is handled here instead of being allowed to surface from
 * `REFERENCE_LEAGUE`: since there is no longer a default league, reading it unguarded would
 * turn an optional variable into one every deploy depends on.
 *
 * When the league is unset the owner is **still created**, and only the league attachment
 * is skipped. The two halves are not equally important: the `users` row is the sign-in
 * allowlist and the whole reason this script runs unattended, whereas a league can be
 * created afterwards from `/leagues` or `add-owner.mts`. Skipping both would mean a fresh
 * production database where nobody can sign in at all.
 */
import { eq } from 'drizzle-orm'

import { db } from '../src/db'
import { leagues, leagueUsers, users } from '../src/db/schema'
import { REFERENCE_LEAGUE } from '../src/lib/league-config'

const email = process.env.BOOTSTRAP_OWNER_EMAIL?.trim()
const name = process.env.BOOTSTRAP_OWNER_NAME?.trim()

if (!email) {
  console.log('[bootstrap] BOOTSTRAP_OWNER_EMAIL not set — skipping.')
  process.exit(0)
}

const user =
  (await db.query.users.findFirst({ where: eq(users.email, email) })) ??
  (await db.insert(users).values({ email, name: name ?? null }).returning())[0]

/**
 * Read through a `try`, because `REFERENCE_LEAGUE` throws when `FPL_LEAGUE_ID` is unset.
 *
 * Catching rather than testing the variable directly keeps the one definition of what a
 * valid league ID is in `parseLeagueId` — a second `process.env.FPL_LEAGUE_ID` check here
 * would be a second, quietly diverging answer to the same question.
 */
let fplLeagueId: number | null = null
try {
  fplLeagueId = REFERENCE_LEAGUE.fplLeagueId
} catch {
  fplLeagueId = null
}

if (fplLeagueId === null) {
  console.log(
    `[bootstrap] owner ${email} present. FPL_LEAGUE_ID not set — no league attached. ` +
      'Create one from /leagues, or run add-owner.mts --league <id>.',
  )
  process.exit(0)
}

const league =
  (await db.query.leagues.findFirst({
    where: eq(leagues.fplLeagueId, fplLeagueId),
  })) ??
  (await db
    .insert(leagues)
    .values({ fplLeagueId, name: 'FPL league' })
    .returning())[0]

await db
  .insert(leagueUsers)
  .values({ leagueId: league.id, userId: user.id })
  .onConflictDoNothing()

console.log(
  `[bootstrap] owner ${email} present on league ${league.fplLeagueId} — /l/${league.fplLeagueId}/send`,
)
process.exit(0)
