/**
 * Adds an owner to a league, creating both the user and the league if needed.
 *
 * Sign-in is allowlist-based — only addresses already in `users` can request a magic
 * link — so this is how the first owner, and every co-owner, gets access. There is
 * deliberately no self-signup.
 *
 *   node --env-file=.env --import tsx scripts/add-owner.mts you@example.com "Your Name" [treasurer] [--league 12345]
 *
 * `--league` defaults to `REFERENCE_LEAGUE`, which is the reference league unless
 * `FPL_LEAGUE_ID` says otherwise. Passing it is **how a second league comes into
 * existence**: there is no create-league UI yet (phase C), and pages resolve leagues
 * read-only, so a throwaway league for testing in production is created here or not at
 * all. See docs/MULTI-LEAGUE.md.
 */
import { eq } from 'drizzle-orm'

import { db } from '../src/db'
import { leagues, leagueUsers, users } from '../src/db/schema'
import { parseLeagueSegment, REFERENCE_LEAGUE } from '../src/lib/league-config'

const argv = process.argv.slice(2)

const flagAt = argv.indexOf('--league')
const leagueArg = flagAt === -1 ? undefined : argv[flagAt + 1]
const positional = flagAt === -1 ? argv : [...argv.slice(0, flagAt), ...argv.slice(flagAt + 2)]

const [email, name, role] = positional

if (!email) {
  console.error(
    'Usage: add-owner.mts <email> [name] [communicator|treasurer] [--league <fplLeagueId>]',
  )
  process.exit(1)
}

// Validated rather than coerced: `--league 1xrliv` is the invite code, and unchecked it
// becomes NaN and then a league row nobody can ever reach by URL.
const fplLeagueId = leagueArg === undefined ? REFERENCE_LEAGUE.fplLeagueId : parseLeagueSegment(leagueArg)
if (fplLeagueId === null) {
  console.error(
    `--league must be the numeric league ID from the league URL, got "${leagueArg}". ` +
      'An invite code like "1xrliv" is not the league ID.',
  )
  process.exit(1)
}

const ownerRole = role === 'treasurer' ? 'treasurer' : 'communicator'

const user =
  (await db.query.users.findFirst({ where: eq(users.email, email) })) ??
  (await db.insert(users).values({ email, name: name ?? null }).returning())[0]

console.log(`user: ${user.email} (${user.id})`)

const league =
  (await db.query.leagues.findFirst({
    where: eq(leagues.fplLeagueId, fplLeagueId),
  })) ??
  (await db.insert(leagues).values({ fplLeagueId, name: 'FPL league' }).returning())[0]

await db
  .insert(leagueUsers)
  .values({ leagueId: league.id, userId: user.id, role: ownerRole })
  .onConflictDoNothing()

// The name is a placeholder until a page loads and reads the real one from FPL; the URL
// is the useful output, since that is now how the league is reached.
console.log(`added to league ${league.name} as ${ownerRole} — /l/${league.fplLeagueId}/send`)
process.exit(0)
