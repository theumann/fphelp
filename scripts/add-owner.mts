/**
 * Adds an owner to the reference league.
 *
 * Sign-in is allowlist-based — only addresses already in `users` can request a magic
 * link — so this is how the first owner, and every co-owner, gets access. There is
 * deliberately no self-signup.
 *
 *   node --env-file=.env --import tsx scripts/add-owner.mts you@example.com "Your Name" [treasurer]
 */
import { eq } from 'drizzle-orm'

import { db } from '../src/db'
import { leagues, leagueUsers, users } from '../src/db/schema'
import { REFERENCE_LEAGUE } from '../src/lib/league-config'

const [email, name, role] = process.argv.slice(2)

if (!email) {
  console.error('Usage: add-owner.mts <email> [name] [communicator|treasurer]')
  process.exit(1)
}

const ownerRole = role === 'treasurer' ? 'treasurer' : 'communicator'

const user =
  (await db.query.users.findFirst({ where: eq(users.email, email) })) ??
  (await db.insert(users).values({ email, name: name ?? null }).returning())[0]

console.log(`user: ${user.email} (${user.id})`)

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
  .values({ leagueId: league.id, userId: user.id, role: ownerRole })
  .onConflictDoNothing()

console.log(`added to league ${league.name} as ${ownerRole}`)
process.exit(0)
