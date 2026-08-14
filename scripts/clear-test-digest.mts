/**
 * Deletes a gameweek's digest, its messages and its delivery rows for the reference
 * league — the pre-season test artifacts described in docs/GW1-VERIFICATION.md §6b.
 *
 * Why this needs to exist at all: pre-season, `/send` has no finished gameweek to report
 * and falls back to labelling its digest **gameweek 1**. So every test draft, every test
 * send, and now every test email is stamped with the gameweek that is about to become
 * real. Left in place they are not inert — `findDraft` loads the test prose into the
 * real GW1 composer, a test `sent_at` makes the composer believe the real digest already
 * went out, and a `deliveries` row makes the first genuine email ask for resend
 * confirmation.
 *
 * Run manually, never from a deploy hook. Two reasons: it deletes the owner's own
 * writing, which nothing else in this app does, and a pre-deploy step that silently
 * removes a gameweek's history is precisely the thing nobody would think to check when
 * that history later turns up missing.
 *
 *   npm run db:clear-digest -- --gw 1              # dry run: shows what would go
 *   npm run db:clear-digest -- --gw 1 --confirm    # actually deletes
 */
import { and, eq, inArray } from 'drizzle-orm'

import { db } from '../src/db'
import { deliveries, digests, leagues, messages } from '../src/db/schema'
import type { DigestStats } from '../src/lib/digest/stats'
import { REFERENCE_LEAGUE } from '../src/lib/league-config'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

const confirm = process.argv.includes('--confirm')
const force = process.argv.includes('--force')
const gameweek = Number(arg('gw'))

if (!Number.isInteger(gameweek) || gameweek < 1 || gameweek > 60) {
  console.error('Usage: npm run db:clear-digest -- --gw <n> [--confirm] [--force]')
  process.exit(1)
}

const league = await db.query.leagues.findFirst({
  where: eq(leagues.fplLeagueId, REFERENCE_LEAGUE.fplLeagueId),
})

if (!league) {
  console.error(`No league row for FPL league ${REFERENCE_LEAGUE.fplLeagueId}. Nothing to do.`)
  process.exit(1)
}

const digest = await db.query.digests.findFirst({
  where: and(eq(digests.leagueId, league.id), eq(digests.gameweek, gameweek)),
})

const rows = digest
  ? await db.query.messages.findMany({ where: eq(messages.digestId, digest.id) })
  : []

const delivered = await db.query.deliveries.findMany({
  where: and(eq(deliveries.leagueId, league.id), eq(deliveries.gameweek, gameweek)),
})

if (!digest && rows.length === 0 && delivered.length === 0) {
  console.log(`Nothing stored for GW${gameweek} on league ${league.fplLeagueId}. Already clean.`)
  process.exit(0)
}

/**
 * The guard that matters.
 *
 * Once a gameweek is genuinely scored its digest holds real results, and this script
 * would then be deleting the record of a real send rather than a test. Nobody runs a
 * cleanup script expecting that, and the loss is silent — the standings come back from
 * the API on the next prepare, but the owner's own prose does not, and neither does the
 * evidence that fourteen people were emailed.
 *
 * A pre-season digest is recognisable: nobody has scored. Anything else needs --force,
 * typed deliberately by someone who has read this.
 */
const stats = digest?.stats as DigestStats | undefined
const scored = stats?.standings.some((r) => !r.pending && (r.total ?? 0) > 0) ?? false

console.log(`League ${league.fplLeagueId} — gameweek ${gameweek}`)
console.log(`  digest:     ${digest ? `prepared ${digest.preparedAt.toISOString()}` : 'none'}`)
console.log(`  scored:     ${scored ? 'YES — this looks like real data' : 'no (pre-season shape)'}`)

for (const m of rows) {
  const state = m.sentAt ? `marked sent ${m.sentAt.toISOString()}` : 'draft'
  console.log(`  message:    ${state} — ${JSON.stringify(m.body.slice(0, 60))}`)
}
for (const d of delivered) {
  console.log(`  delivery:   ${d.kind} ${d.status}, ${d.recipientCount} recipients, ${d.attempts} attempts`)
}

if (scored && !force) {
  console.error(
    '\nRefusing: this gameweek has scored managers, so the digest is real data.\n' +
      'If you are certain, re-run with --force.',
  )
  process.exit(1)
}

if (!confirm) {
  console.log('\nDry run. Re-run with --confirm to delete the rows listed above.')
  process.exit(0)
}

/**
 * All three or none.
 *
 * `messages` has no gameweek column — a message is tied to its gameweek only through
 * `digest_id`. So a run that deleted the digest but died before the messages would leave
 * rows that can never again be found by gameweek, and `digest_id` is `set null` on
 * delete, so even the link back is gone. That is unrecoverable by any later run of this
 * script, which is reason enough for a transaction on three small deletes.
 */
await db.transaction(async (tx) => {
  // Deliveries first: they reference messages, and a `set null` on the way out would
  // leave a delivery row pointing at nothing while still claiming a send happened.
  await tx
    .delete(deliveries)
    .where(and(eq(deliveries.leagueId, league.id), eq(deliveries.gameweek, gameweek)))

  if (rows.length > 0) {
    await tx.delete(messages).where(
      inArray(
        messages.id,
        rows.map((m) => m.id),
      ),
    )
  }

  if (digest) {
    await tx.delete(digests).where(eq(digests.id, digest.id))
  }
})

console.log(
  `\nDeleted: ${digest ? 1 : 0} digest, ${rows.length} message(s), ${delivered.length} delivery row(s).`,
)
process.exit(0)
