import { and, desc, eq } from 'drizzle-orm'

import type { DigestStats } from '@/lib/digest/stats'
import type { BlockSelection } from '@/lib/render/blocks'

import { db } from './index'
import { digests, leagues, leagueUsers, messages, users } from './schema'

/** Creates the league row on first use, or returns the existing one. */
export async function ensureLeague(fplLeagueId: number, name: string) {
  const existing = await db.query.leagues.findFirst({
    where: eq(leagues.fplLeagueId, fplLeagueId),
  })
  if (existing) return existing

  const [created] = await db.insert(leagues).values({ fplLeagueId, name }).returning()
  return created
}

/**
 * Stores the computed stats for a gameweek, or updates them if already present.
 *
 * `digests` is unique on (league_id, gameweek), which is what stops a cron poll and a
 * manual page load from double-preparing. The upsert makes preparation idempotent
 * rather than an error.
 */
export async function upsertDigest(leagueId: string, gameweek: number, stats: DigestStats) {
  const [row] = await db
    .insert(digests)
    .values({ leagueId, gameweek, stats })
    .onConflictDoUpdate({
      target: [digests.leagueId, digests.gameweek],
      set: { stats, preparedAt: new Date() },
    })
    .returning()

  return row
}

/**
 * The current draft for a gameweek — the most recent unsent message.
 *
 * Deliberately scoped to the league, not the user: co-owners share one draft so they
 * don't independently write the same week's update.
 */
export async function findDraft(leagueId: string, gameweek: number) {
  const digest = await db.query.digests.findFirst({
    where: and(eq(digests.leagueId, leagueId), eq(digests.gameweek, gameweek)),
  })
  if (!digest) return null

  const draft = await db.query.messages.findFirst({
    where: and(eq(messages.leagueId, leagueId), eq(messages.digestId, digest.id)),
    orderBy: [desc(messages.createdAt)],
  })

  return draft ?? null
}

export interface SaveDraftInput {
  leagueId: string
  digestId: string
  messageId?: string
  body: string
  blocks: BlockSelection
}

/** Saves or updates the shared draft. Returns the message row. */
export async function saveDraft(input: SaveDraftInput) {
  if (input.messageId) {
    const [updated] = await db
      .update(messages)
      .set({ body: input.body, blocks: input.blocks })
      .where(eq(messages.id, input.messageId))
      .returning()
    return updated
  }

  const [created] = await db
    .insert(messages)
    .values({
      leagueId: input.leagueId,
      digestId: input.digestId,
      body: input.body,
      blocks: input.blocks,
    })
    .returning()

  return created
}

/**
 * Records that a message was sent.
 *
 * `sentText` is stored because an edited message is not reproducible from the API — it
 * is the only record of what the league actually received. A null `sentAt` means
 * unknown, never failed: the send happens inside WhatsApp and is unobservable.
 */
export async function markSent(messageId: string, sentText: string, userId?: string) {
  const [updated] = await db
    .update(messages)
    .set({ sentText, sentAt: new Date(), markedSentBy: userId ?? null })
    .where(eq(messages.id, messageId))
    .returning()

  return updated
}

/** Throws unless the user is an owner of the league. Use in every Server Action. */
export async function assertOwner(leagueId: string, userId: string) {
  const membership = await db.query.leagueUsers.findFirst({
    where: and(eq(leagueUsers.leagueId, leagueId), eq(leagueUsers.userId, userId)),
  })
  if (!membership) throw new Error('Not an owner of this league')
  return membership
}

/**
 * Ensures the signed-in user is an owner of this league, creating the link on first
 * sign-in for the reference league. Returns the membership row.
 */
export async function ensureMembership(leagueId: string, userId: string) {
  const existing = await db.query.leagueUsers.findFirst({
    where: and(eq(leagueUsers.leagueId, leagueId), eq(leagueUsers.userId, userId)),
  })
  if (existing) return existing

  const [created] = await db
    .insert(leagueUsers)
    .values({ leagueId, userId })
    .onConflictDoNothing()
    .returning()

  return created ?? existing!
}

/**
 * Builds the per-sender signature: "[Name] — [Team Name] Manager and [League] Admin".
 *
 * Co-owners sign differently because they have different FPL entries, so this is
 * resolved at render time from the sending owner's row. It degrades gracefully: an owner
 * who does not play in the league they administer — plausibly the treasurer — has no
 * `manager_entry`, and simply signs without a team.
 */
export async function ownerSignature(
  leagueId: string,
  userId: string,
  leagueName: string,
  roster: { entry: number; entryName: string }[],
): Promise<string> {
  const membership = await ensureMembership(leagueId, userId)
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) })

  const who = user?.name ?? user?.email ?? 'Admin'
  const team = membership?.managerEntry
    ? roster.find((m) => m.entry === membership.managerEntry)?.entryName
    : undefined

  return team
    ? `${who} — ${team} Manager and ${leagueName} Admin`
    : `${who} — ${leagueName} Admin`
}

/** Sent history for a league, most recent first. */
export async function sentMessages(leagueId: string, limit = 10) {
  return db.query.messages.findMany({
    where: eq(messages.leagueId, leagueId),
    orderBy: [desc(messages.createdAt)],
    limit,
  })
}
