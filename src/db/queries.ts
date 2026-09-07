import { and, desc, eq, sql } from 'drizzle-orm'

import type { DigestStats } from '@/lib/digest/stats'
import type { HistoryRow } from '@/lib/fpl/history'
import type { RosterManager } from '@/lib/fpl/roster'
import {
  DEFAULT_SETTINGS,
  fromPrizeRules,
  toPrizeRules,
  type LeagueSettings,
} from '@/lib/league-settings'
import type { BlockSelection } from '@/lib/render/blocks'

import { db } from './index'
import {
  deliveries,
  digests,
  dues,
  leagueExpenses,
  leagues,
  leagueUsers,
  managerGwHistory,
  managers,
  messages,
  prizeRules,
  recipients,
  users,
} from './schema'

/**
 * `ensureLeague` was removed here, and the space is left with a note because the function
 * is the obvious thing to reach for and reintroducing it would reopen a closed hole.
 *
 * It created a league row on first use, which every page called on load. That was safe
 * only while the league ID came from the environment. Once the ID comes from a URL segment
 * it means anyone can mint a league by typing a number, and once the cron iterates the
 * `leagues` table it means a typo in a script could quietly add a league to be captured.
 * Leagues are now created deliberately, by `bootstrap-owner.mts` and `add-owner.mts`.
 *
 * If you need "find or create", you almost certainly need `findLeagueByFplId` and an
 * explicit refusal.
 */

/**
 * The league a URL segment names, or null.
 *
 * Deliberately not `ensureLeague`. Every page used to create the league row as a side
 * effect of being loaded, which was harmless while the ID came from the environment and
 * meant exactly one league could ever exist. With the ID coming from the URL it would
 * mean anyone could mint a league row by typing a number into the address bar, so
 * resolution is read-only and an unknown ID is a 404.
 */
export async function findLeagueByFplId(fplLeagueId: number) {
  return (
    (await db.query.leagues.findFirst({ where: eq(leagues.fplLeagueId, fplLeagueId) })) ?? null
  )
}

/**
 * Keeps `leagues.name` in step with what FPL currently calls the league.
 *
 * `ensureLeague` used to set the name as a side effect of every page load, and that went
 * with it when league resolution became read-only. Something still has to write it: the
 * name is what the chooser at `/` lists, a league created by `add-owner.mts` starts as the
 * placeholder "FPL league", and owners do rename leagues mid-season.
 *
 * A no-op unless the name actually changed, so the common case is a read the page had
 * already done and no write at all.
 */
export async function syncLeagueName(leagueId: string, name: string, current: string) {
  if (name === current || name.trim() === '') return
  await db.update(leagues).set({ name }).where(eq(leagues.id, leagueId))
}

/** Whether this person may create leagues. See `users.can_create_leagues`. */
export async function canCreateLeagues(userId: string): Promise<boolean> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) })
  return user?.canCreateLeagues ?? false
}

export type CreateLeagueOutcome =
  | { ok: true; league: LeagueSummary }
  | { ok: false; reason: 'already-claimed' }

/**
 * Creates a league and makes this user its first owner.
 *
 * The two rows go in one transaction because a league with no owners is unreachable —
 * nothing in the UI can adopt it, and the cron would capture history for a league nobody
 * can see. A crash between the inserts would leave exactly that.
 *
 * **First claim wins, and the loser is told.** `fpl_league_id` is unique, so the second
 * person to claim a league gets `already-claimed` rather than a unique-violation crash.
 * That is the whole of the ownership model for now: nothing proves the claimant runs the
 * league on FPL's side. It is defensible only because creation is gated on
 * `can_create_leagues`, which the operator grants by hand — see docs/MULTI-LEAGUE.md,
 * "how do you prove someone runs FPL league X".
 *
 * The insert is the check. Reading first and inserting after is a race that ends in a 500
 * when two people claim the same league at once, and `onConflictDoNothing` turns that into
 * an outcome the caller can render.
 */
export async function createLeague(
  fplLeagueId: number,
  name: string,
  userId: string,
): Promise<CreateLeagueOutcome> {
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(leagues)
      .values({ fplLeagueId, name })
      .onConflictDoNothing({ target: leagues.fplLeagueId })
      .returning()

    if (!created) return { ok: false, reason: 'already-claimed' }

    await tx.insert(leagueUsers).values({ leagueId: created.id, userId })

    return {
      ok: true,
      league: { id: created.id, fplLeagueId: created.fplLeagueId, name: created.name },
    }
  })
}

export interface LeagueSummary {
  id: string
  fplLeagueId: number
  name: string
}

/**
 * Every league this user administers, oldest membership first.
 *
 * Drives the chooser at `/` and the redirect for the common case of owning exactly one.
 * Ordered by when they were made an owner, so the league they have had longest leads —
 * with a real league and a throwaway test one, that is the order that puts the real one
 * on top.
 */
export async function listLeaguesForUser(userId: string): Promise<LeagueSummary[]> {
  return db
    .select({ id: leagues.id, fplLeagueId: leagues.fplLeagueId, name: leagues.name })
    .from(leagueUsers)
    .innerJoin(leagues, eq(leagues.id, leagueUsers.leagueId))
    .where(eq(leagueUsers.userId, userId))
    .orderBy(leagueUsers.createdAt)
}

/**
 * Every league, oldest first — the capture cron's work list.
 *
 * The order is load-bearing rather than tidy. A run that exhausts its time budget stops
 * starting new leagues, so whatever sorts last is what gets deferred to the next poll;
 * oldest-first means the long-established league is captured before a throwaway test one
 * ever costs it a place. Deferral is safe either way — the next poll picks it up — but
 * "safe" and "the real league goes first" are worth having together.
 *
 * Unfiltered on purpose. A league with no owners still has managers whose history cannot
 * be backfilled once they leave, and dropping it from capture would be a silent decision
 * to lose that.
 */
export async function listAllLeagues(): Promise<LeagueSummary[]> {
  return db
    .select({ id: leagues.id, fplLeagueId: leagues.fplLeagueId, name: leagues.name })
    .from(leagues)
    .orderBy(leagues.createdAt)
}

/**
 * Records who is in the league right now.
 *
 * This is the only record of league membership at a point in time. The FPL API only
 * ever reports the *current* members, so once someone leaves they vanish from
 * standings and their history rows would otherwise be orphaned integers with no name
 * attached. Managers are marked inactive rather than deleted for the same reason.
 *
 * Name and team name are refreshed on every run, since managers rename their teams
 * mid-season and the latest value is the one worth showing.
 */
export async function upsertManagers(leagueId: string, roster: RosterManager[]) {
  if (roster.length === 0) return 0

  await db
    .insert(managers)
    .values(
      roster.map((m) => ({
        leagueId,
        entry: m.entry,
        entryName: m.entryName,
        playerName: m.playerName,
        joinedTime: m.joinedTime ? new Date(m.joinedTime) : null,
        active: true,
      })),
    )
    .onConflictDoUpdate({
      target: [managers.leagueId, managers.entry],
      set: {
        entryName: sql`excluded.entry_name`,
        playerName: sql`excluded.player_name`,
        active: true,
      },
    })

  return roster.length
}

/**
 * Stores gameweek history, overwriting any existing row for the same gameweek.
 *
 * Keyed on (league_id, entry, gameweek), so re-running is harmless — which is what
 * makes the job safe to call repeatedly and safe to retry after a partial failure.
 * Overwriting rather than ignoring matters because a gameweek captured before bonus
 * points landed must be correctable by a later run.
 */
export async function saveHistory(leagueId: string, rows: HistoryRow[]) {
  if (rows.length === 0) return 0

  await db
    .insert(managerGwHistory)
    .values(rows.map((r) => ({ leagueId, ...r })))
    .onConflictDoUpdate({
      target: [managerGwHistory.leagueId, managerGwHistory.entry, managerGwHistory.gameweek],
      set: {
        points: sql`excluded.points`,
        totalPoints: sql`excluded.total_points`,
        rank: sql`excluded.rank`,
        overallRank: sql`excluded.overall_rank`,
        pointsOnBench: sql`excluded.points_on_bench`,
        eventTransfersCost: sql`excluded.event_transfers_cost`,
      },
    })

  return rows.length
}

/**
 * How many distinct managers have a stored row for this gameweek.
 *
 * The capture job compares this against the roster size to decide whether a poll has
 * anything left to do. Counting entries rather than storing a "captured" flag means a
 * run that lost a manager to a flaky API is retried by the next poll for free.
 */
export async function capturedEntryCount(leagueId: string, gameweek: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(distinct ${managerGwHistory.entry})::int` })
    .from(managerGwHistory)
    .where(and(eq(managerGwHistory.leagueId, leagueId), eq(managerGwHistory.gameweek, gameweek)))

  return row?.count ?? 0
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

export async function getLeague(leagueId: string) {
  return db.query.leagues.findFirst({ where: eq(leagues.id, leagueId) })
}

/** The digest row for a gameweek, whose `stats` the email is re-rendered from server-side. */
export async function findDigest(leagueId: string, gameweek: number) {
  return db.query.digests.findFirst({
    where: and(eq(digests.leagueId, leagueId), eq(digests.gameweek, gameweek)),
  })
}

/** What the league has already had delivered this gameweek, per channel. */
export async function findDelivery(leagueId: string, gameweek: number, kind: 'whatsapp' | 'email') {
  return db.query.deliveries.findFirst({
    where: and(
      eq(deliveries.leagueId, leagueId),
      eq(deliveries.gameweek, gameweek),
      eq(deliveries.kind, kind),
    ),
  })
}

/**
 * Records the outcome of a delivery attempt, successful or not.
 *
 * Upsert rather than insert: the unique key is what stops a double-click sending twice,
 * so a deliberate resend has to update the existing row. `attempts` accumulates, and a
 * previous failure is cleared only by the attempt that overwrites it — a row must never
 * read `sent` while still carrying the error from a different attempt.
 */
export async function recordDelivery(input: {
  leagueId: string
  gameweek: number
  kind: 'whatsapp' | 'email'
  messageId?: string
  status: 'sent' | 'failed'
  providerId?: string | null
  recipientCount: number
  error?: string | null
  sentBy?: string
}) {
  const [row] = await db
    .insert(deliveries)
    .values({
      leagueId: input.leagueId,
      gameweek: input.gameweek,
      kind: input.kind,
      messageId: input.messageId,
      status: input.status,
      providerId: input.providerId ?? null,
      recipientCount: input.recipientCount,
      error: input.error ?? null,
      sentBy: input.sentBy,
    })
    .onConflictDoUpdate({
      target: [deliveries.leagueId, deliveries.gameweek, deliveries.kind],
      set: {
        messageId: input.messageId,
        status: input.status,
        providerId: input.providerId ?? null,
        recipientCount: input.recipientCount,
        error: input.error ?? null,
        attempts: sql`${deliveries.attempts} + 1`,
        sentBy: input.sentBy,
        updatedAt: new Date(),
      },
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

/** Loads a league's settings, falling back to defaults when it has no rules yet. */
export async function getSettings(leagueId: string): Promise<LeagueSettings> {
  const league = await db.query.leagues.findFirst({ where: eq(leagues.id, leagueId) })
  const rows = await db.query.prizeRules.findMany({
    where: eq(prizeRules.leagueId, leagueId),
  })
  // Ordered explicitly so the digest lists costs in the order the owner entered them,
  // and Setup does not reshuffle its rows on every save.
  const expenseRows = await db.query.leagueExpenses.findMany({
    where: eq(leagueExpenses.leagueId, leagueId),
    orderBy: leagueExpenses.position,
  })

  return fromPrizeRules(
    rows.map((r) => ({ kind: r.kind, rank: r.rank, value: r.value })),
    {
      expenses: expenseRows.map((e) => ({ label: e.label, amount: Number(e.amount) })),
      // Null stays undefined rather than collapsing to 0: "nobody has set this" and
      // "the pot is zero" are different claims, and only one of them is safe to print.
      potTotal: league?.potTotal != null ? Number(league.potTotal) : undefined,
      currency: league?.currency ?? DEFAULT_SETTINGS.currency,
      entryFee: league?.entryFee ? Number(league.entryFee) : undefined,
    },
  )
}

/**
 * Replaces a league's settings.
 *
 * Prize rules are rewritten wholesale inside a transaction rather than diffed: the set
 * must stay coherent (contiguous ranks, percentages totalling 100), and a partial
 * update that left a stale row behind would silently misallocate the pot.
 *
 * Expenses go the same way and for the same reason — they are a term in that arithmetic,
 * and a stale engraving row is a deduction nobody entered. The cost is that their `id`s
 * and `created_at` are reissued on every save; nothing references either, and the entry
 * order is preserved by re-inserting in array order.
 */
export async function saveSettings(leagueId: string, settings: LeagueSettings) {
  await db.transaction(async (tx) => {
    await tx
      .update(leagues)
      .set({
        potTotal: settings.potTotal !== undefined ? String(settings.potTotal) : null,
        currency: settings.currency,
        entryFee: settings.entryFee !== undefined ? String(settings.entryFee) : null,
      })
      .where(eq(leagues.id, leagueId))

    await tx.delete(prizeRules).where(eq(prizeRules.leagueId, leagueId))
    await tx.insert(prizeRules).values(
      toPrizeRules(settings).map((r) => ({
        leagueId,
        kind: r.kind,
        rank: r.rank,
        value: r.value,
      })),
    )

    await tx.delete(leagueExpenses).where(eq(leagueExpenses.leagueId, leagueId))
    if (settings.expenses.length > 0) {
      await tx.insert(leagueExpenses).values(
        settings.expenses.map((e, position) => ({
          leagueId,
          label: e.label.trim(),
          amount: String(e.amount),
          position,
        })),
      )
    }
  })
}

/** True once the season's ledger is settled — after which prize rules must not change. */
export async function isFinalised(leagueId: string): Promise<boolean> {
  const league = await db.query.leagues.findFirst({ where: eq(leagues.id, leagueId) })
  return Boolean(league?.finalisedAt)
}

/** Records the owner's own FPL entry, used to sign the messages they send. */
export async function setManagerEntry(
  leagueId: string,
  userId: string,
  managerEntry: number | null,
) {
  await db
    .update(leagueUsers)
    .set({ managerEntry })
    .where(and(eq(leagueUsers.leagueId, leagueId), eq(leagueUsers.userId, userId)))
}

/**
 * Who has paid in, keyed by FPL entry.
 *
 * A manager with no row has simply never been touched — absence means unpaid, not
 * missing data, so the caller can render the full roster without seeding rows first.
 */
export async function listDues(leagueId: string): Promise<Map<number, boolean>> {
  const rows = await db.query.dues.findMany({ where: eq(dues.leagueId, leagueId) })
  return new Map(rows.map((r) => [r.entry, r.paid]))
}

/** Records whether a manager has paid their dues. */
export async function setDuePaid(leagueId: string, entry: number, paid: boolean) {
  await db
    .insert(dues)
    .values({ leagueId, entry, paid, paidAt: paid ? new Date() : null })
    .onConflictDoUpdate({
      target: [dues.leagueId, dues.entry],
      set: { paid, paidAt: paid ? new Date() : null },
    })
}

/** The league's email list, ordered so the UI is stable across reloads. */
export async function listRecipients(leagueId: string) {
  return db.query.recipients.findMany({
    where: eq(recipients.leagueId, leagueId),
    orderBy: (r, { asc }) => [asc(r.email)],
  })
}

export interface AddRecipientsResult {
  added: number
  /** Addresses already on the list. Reported, not treated as an error. */
  skipped: number
}

/**
 * Adds parsed recipients, ignoring any already present.
 *
 * `onConflictDoNothing` rather than an upsert: re-pasting the same list is the normal
 * way an owner adds two new members, and it must not overwrite names they have since
 * corrected by hand.
 */
export async function addRecipients(
  leagueId: string,
  entries: { email: string; name: string | null }[],
): Promise<AddRecipientsResult> {
  if (entries.length === 0) return { added: 0, skipped: 0 }

  const inserted = await db
    .insert(recipients)
    .values(entries.map((e) => ({ leagueId, email: e.email, name: e.name })))
    .onConflictDoNothing({ target: [recipients.leagueId, recipients.email] })
    .returning({ id: recipients.id })

  return { added: inserted.length, skipped: entries.length - inserted.length }
}

/** Scoped by league as well as id, so an id from another league cannot be deleted. */
export async function removeRecipient(leagueId: string, id: string) {
  await db.delete(recipients).where(and(eq(recipients.leagueId, leagueId), eq(recipients.id, id)))
}

/**
 * The league's default block selection — what a new draft starts with.
 *
 * A default, not a setting that applies retroactively: `messages.blocks` records what each
 * message actually included, so changing this never rewrites what the league was already
 * sent. That separation is the whole reason both exist.
 */
export async function setDefaultBlocks(leagueId: string, blocks: BlockSelection) {
  await db.update(leagues).set({ defaultBlocks: blocks }).where(eq(leagues.id, leagueId))
}

/**
 * Whether the digest bcc's its recipients or cc's them.
 *
 * Turning it off is irreversible in the only sense that matters: the next send publishes
 * every address to every member, and switching it back on afterwards un-publishes nothing.
 */
export async function setHideRecipients(leagueId: string, hide: boolean) {
  await db.update(leagues).set({ hideRecipients: hide }).where(eq(leagues.id, leagueId))
}

/** Email is opt-in per league: a WhatsApp-only league never touches the recipient list. */
export async function setEmailEnabled(leagueId: string, enabled: boolean) {
  await db.update(leagues).set({ emailEnabled: enabled }).where(eq(leagues.id, leagueId))
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
 * The signed-in user's membership of this league, or `null`.
 *
 * Deliberately read-only. This used to create the link on first visit, which made
 * *visiting a page* the act that granted ownership — anyone who could sign in became an
 * owner of the reference league by loading `/setup`. That was survivable only because
 * sign-in is allowlisted to a hand-curated `users` table, so the set of people it could
 * promote was the set already trusted. It stops being survivable the moment `users`
 * holds someone who owns a different league, and that is a change to a table, not to
 * this file — the kind of latent hole that opens without anyone touching the code near
 * it.
 *
 * Membership is now granted deliberately: `scripts/bootstrap-owner.mts` at deploy time,
 * and `addOwner` below, called by the owners list in Setup.
 */
export async function findMembership(leagueId: string, userId: string) {
  return (
    (await db.query.leagueUsers.findFirst({
      where: and(eq(leagueUsers.leagueId, leagueId), eq(leagueUsers.userId, userId)),
    })) ?? null
  )
}

export interface Owner {
  userId: string
  email: string
  name: string | null
  role: 'communicator' | 'treasurer'
  /** Set once they have signed in at least once — an added address has not, yet. */
  hasSignedIn: boolean
}

/** Everyone who can administer this league, oldest membership first. */
export async function listOwners(leagueId: string): Promise<Owner[]> {
  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      role: leagueUsers.role,
      emailVerified: users.emailVerified,
      createdAt: leagueUsers.createdAt,
    })
    .from(leagueUsers)
    .innerJoin(users, eq(users.id, leagueUsers.userId))
    .where(eq(leagueUsers.leagueId, leagueId))
    .orderBy(leagueUsers.createdAt)

  return rows.map((r) => ({
    userId: r.userId,
    email: r.email,
    name: r.name,
    role: r.role,
    hasSignedIn: r.emailVerified !== null,
  }))
}

export type AddOwnerOutcome = 'added' | 'already-owner'

/**
 * Grants ownership of a league to an email address.
 *
 * Two rows, and both are load-bearing. The `users` row is what lets the address sign in
 * at all — `src/auth.ts` allowlists against that table — and the `league_users` row is
 * what any page or Server Action actually checks. Creating only the first would produce
 * someone who can sign in and see nothing; only the second is impossible, since it needs
 * a user id.
 *
 * This is not an invite: nothing is emailed, and the added owner gets in only when they
 * request a sign-in link themselves.
 */
export async function addOwner(
  leagueId: string,
  email: string,
  name: string | null,
): Promise<{ outcome: AddOwnerOutcome; owner: Owner }> {
  // Insert-then-read rather than read-then-insert. Checking for the address first and
  // inserting if absent is a race that ends in a unique-violation crash when two owners
  // add the same person at once; `onConflictDoNothing` makes the collision a no-op and
  // the re-read resolves it. Rare, but the failure is an unhandled 500 rather than a
  // message the owner can act on.
  //
  // A name is only ever set on creation. Overwriting an existing user's name from a
  // pasted `Name <address>` would rename them for every league they own.
  const [created] = await db
    .insert(users)
    .values({ email, name })
    .onConflictDoNothing({ target: users.email })
    .returning()

  const user =
    created ?? (await db.query.users.findFirst({ where: eq(users.email, email) }))!

  const link = await db
    .insert(leagueUsers)
    .values({ leagueId, userId: user.id })
    .onConflictDoNothing()
    .returning({ role: leagueUsers.role })

  return {
    outcome: link.length > 0 ? 'added' : 'already-owner',
    owner: {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: link[0]?.role ?? 'communicator',
      hasSignedIn: user.emailVerified !== null,
    },
  }
}

/**
 * Revokes ownership.
 *
 * Deletes the membership only, never the `users` row. The user row carries authorship —
 * `messages.created_by`, `deliveries.sent_by` — and those references are `set null`, so
 * deleting the account would quietly erase who sent past digests to the league. A removed
 * owner keeps the ability to request a sign-in link and is then met with "not an owner";
 * that is the intended outcome, and access is genuinely gone because every page resolves
 * membership per request rather than trusting the session.
 */
export async function removeOwner(leagueId: string, userId: string) {
  await db
    .delete(leagueUsers)
    .where(and(eq(leagueUsers.leagueId, leagueId), eq(leagueUsers.userId, userId)))
}

/** Used to refuse the removal that would leave the league unadministrable. */
export async function ownerCount(leagueId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(leagueUsers)
    .where(eq(leagueUsers.leagueId, leagueId))
  return row?.count ?? 0
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
  const membership = await findMembership(leagueId, userId)
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) })

  const who = user?.name ?? user?.email ?? 'Admin'
  const team = membership?.managerEntry
    ? roster.find((m) => m.entry === membership.managerEntry)?.entryName
    : undefined

  return team
    ? `${who} - ${team} Manager and ${leagueName} Admin`
    : `${who} - ${leagueName} Admin`
}

/**
 * Undoes a mark-as-sent.
 *
 * Necessary because "sent" is the owner's assertion, not an observed fact — so it can
 * be wrong, and a wrong one is misleading to a co-owner deciding whether to post.
 * `sentText` is cleared too: it records what the league received, and if nothing was
 * sent it should record nothing.
 */
export async function clearSent(messageId: string) {
  const [updated] = await db
    .update(messages)
    .set({ sentAt: null, sentText: null, markedSentBy: null })
    .where(eq(messages.id, messageId))
    .returning()

  return updated
}

/** Sent history for a league, most recent first. */
export async function sentMessages(leagueId: string, limit = 10) {
  return db.query.messages.findMany({
    where: eq(messages.leagueId, leagueId),
    orderBy: [desc(messages.createdAt)],
    limit,
  })
}
