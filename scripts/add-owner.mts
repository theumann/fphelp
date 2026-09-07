/**
 * Grants access: adds an owner to a league, or vouches for someone who will make their own.
 *
 * Sign-in is allowlist-based — only addresses already in `users` can request a magic
 * link — so this is how the first owner, and every co-owner, gets access. There is
 * deliberately no self-signup.
 *
 *   node --env-file=.env --import tsx scripts/add-owner.mts you@example.com "Your Name" [treasurer] [--league 12345]
 *   node --env-file=.env --import tsx scripts/add-owner.mts them@example.com "Their Name" --invite
 *
 * Two modes, and the difference is who ends up able to create a league:
 *
 * - **default / `--league <id>`** — adds them to that league, creating it if absent.
 *   `--league` defaults to `REFERENCE_LEAGUE`.
 * - **`--invite`** — creates the user and nothing else. They sign in, land on `/leagues`
 *   with none, and add their own by pasting its FPL league ID.
 *
 * **Both set `can_create_leagues`**, and that is the point of running this rather than
 * using Setup's owners list. Setup can add a co-owner — necessarily creating a `users` row,
 * since a co-owner who cannot sign in is useless — but that person cannot go on to create
 * leagues of their own. Otherwise the allowlist becomes transitive and "vouched for by the
 * operator" quietly becomes "vouched for by someone the operator vouched for". This script
 * needs production shell access, which is what makes running it the operator's act.
 */
import { eq } from 'drizzle-orm'

import { db } from '../src/db'
import { leagues, leagueUsers, users } from '../src/db/schema'
import { parseLeagueSegment, REFERENCE_LEAGUE } from '../src/lib/league-config'

const argv = process.argv.slice(2)

const invite = argv.includes('--invite')
const flagAt = argv.indexOf('--league')
const leagueArg = flagAt === -1 ? undefined : argv[flagAt + 1]
const positional = (flagAt === -1 ? argv : [...argv.slice(0, flagAt), ...argv.slice(flagAt + 2)])
  .filter((a) => a !== '--invite')

const [email, name, role] = positional

if (!email) {
  console.error(
    'Usage: add-owner.mts <email> [name] [communicator|treasurer] [--league <fplLeagueId> | --invite]',
  )
  process.exit(1)
}

if (invite && leagueArg !== undefined) {
  console.error('--invite and --league are mutually exclusive: pick a league, or no league.')
  process.exit(1)
}

/**
 * The user row, and the flag.
 *
 * `can_create_leagues` is set on an existing user too, not only on creation: someone added
 * as a co-owner through Setup already has a row, and this is how they are promoted to
 * making their own leagues. The name is only ever set on creation, so re-running this
 * cannot rename somebody.
 */
const existing = await db.query.users.findFirst({ where: eq(users.email, email) })

const user = existing
  ? (
      await db
        .update(users)
        .set({ canCreateLeagues: true })
        .where(eq(users.id, existing.id))
        .returning()
    )[0]
  : (
      await db
        .insert(users)
        .values({ email, name: name ?? null, canCreateLeagues: true })
        .returning()
    )[0]

console.log(`user: ${user.email} (${user.id}) — can create leagues`)

if (invite) {
  console.log('invited with no league. They sign in and add their own at /leagues.')
  process.exit(0)
}

// Validated rather than coerced: `--league 1xrliv` is the invite code, and unchecked it
// becomes NaN and then a league row nobody can ever reach by URL.
const fplLeagueId =
  leagueArg === undefined ? REFERENCE_LEAGUE.fplLeagueId : parseLeagueSegment(leagueArg)

if (fplLeagueId === null) {
  console.error(
    `--league must be the numeric league ID from the league URL, got "${leagueArg}". ` +
      'An invite code like "1xrliv" is not the league ID.',
  )
  process.exit(1)
}

const ownerRole = role === 'treasurer' ? 'treasurer' : 'communicator'

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
