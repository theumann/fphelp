/**
 * Idempotently ensures the bootstrap owner exists, from BOOTSTRAP_OWNER_EMAIL.
 *
 * Runs as part of the pre-deploy command. Sign-in is allowlist-based, so without at
 * least one owner row nobody can get in — and the production database is deliberately
 * not reachable from a developer machine, so this cannot be done by hand.
 *
 * A no-op when the variable is unset, or when the owner already exists.
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

const league =
  (await db.query.leagues.findFirst({
    where: eq(leagues.fplLeagueId, REFERENCE_LEAGUE.fplLeagueId),
  })) ??
  (await db
    .insert(leagues)
    .values({ fplLeagueId: REFERENCE_LEAGUE.fplLeagueId, name: 'FPL league' })
    .returning())[0]

await db
  .insert(leagueUsers)
  .values({ leagueId: league.id, userId: user.id })
  .onConflictDoNothing()

console.log(
  `[bootstrap] owner ${email} present on league ${league.fplLeagueId} — /l/${league.fplLeagueId}/send`,
)
process.exit(0)
