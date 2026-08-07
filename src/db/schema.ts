import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

// Terminology, because "manager" is overloaded (see CLAUDE.md):
//   users    - people with a login here (owners / co-owners)
//   managers - FPL entries competing in the league; they never log in

export const ownerRole = pgEnum('owner_role', ['communicator', 'treasurer'])

/** Prize kinds. Fixed amounts come off the top; percentages apply to the remainder. */
export const prizeKind = pgEnum('prize_kind', [
  'gw_winner_fixed',
  'season_best_gw_fixed',
  'season_rank_pct',
])

/** Rank and best-GW prizes stay provisional until the final gameweek is scored. */
export const winningStatus = pgEnum('winning_status', ['provisional', 'final'])

export const messageChannel = pgEnum('message_channel', ['whatsapp', 'email'])

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name'),
  // Required by the Auth.js Drizzle adapter.
  emailVerified: timestamp('email_verified', { withTimezone: true }),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// --- Auth.js adapter tables -------------------------------------------------
// Shapes are dictated by @auth/drizzle-adapter, not by us. `accounts` is unused
// while magic link is the only sign-in method, but the adapter expects it.

export const accounts = pgTable(
  'accounts',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
)

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { withTimezone: true }).notNull(),
})

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
)

export const leagues = pgTable('leagues', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** The numeric FPL league ID — NOT the invite code. */
  fplLeagueId: integer('fpl_league_id').notNull().unique(),
  name: text('name').notNull(),
  startEvent: integer('start_event'),
  /** Entered by the owner, never derived from headcount x fee (pagination + new_entries undercount). */
  potTotal: numeric('pot_total', { precision: 12, scale: 2 }),
  currency: text('currency').notNull().default('USD'),
  /** Display only ("$100 x 18 players"); not load-bearing. */
  entryFee: numeric('entry_fee', { precision: 12, scale: 2 }),
  /** Default block selection for new drafts; overridable per message. */
  defaultBlocks: jsonb('default_blocks')
    .$type<{ overallStandings: boolean; gwResults: boolean; prizeStructure: boolean }>()
    .notNull()
    .default({ overallStandings: true, gwResults: true, prizeStructure: false }),
  emailEnabled: boolean('email_enabled').notNull().default(false),
  notifyOnGwFinish: boolean('notify_on_gw_finish').notNull().default(false),
  /** Set once the final gameweek is scored; locks prize rules against edits. */
  finalisedAt: timestamp('finalised_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Many-to-many both ways: several owners per league, and later several leagues per owner. */
export const leagueUsers = pgTable(
  'league_users',
  {
    leagueId: uuid('league_id')
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Recorded for future permission work; grants nothing in v1. */
    role: ownerRole('role').notNull().default('communicator'),
    /** This owner's own FPL entry, used to sign messages they send. Optional. */
    managerEntry: integer('manager_entry'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.leagueId, t.userId] })],
)

/** FPL entries in the league. Sourced from standings.results AND new_entries.results. */
export const managers = pgTable(
  'managers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id')
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    /** FPL `entry`. Unique per league; the dedupe key across the two collections. */
    entry: integer('entry').notNull(),
    entryName: text('entry_name').notNull(),
    playerName: text('player_name').notNull(),
    /** Set for managers seen only in new_entries — they have no scores yet. */
    joinedTime: timestamp('joined_time', { withTimezone: true }),
    active: boolean('active').notNull().default(true),
  },
  (t) => [unique('managers_league_entry_key').on(t.leagueId, t.entry)],
)

/** Owner-maintained email list. Separate from `managers` — the FPL API gives no addresses. */
export const recipients = pgTable('recipients', {
  id: uuid('id').primaryKey().defaultRandom(),
  leagueId: uuid('league_id')
    .notNull()
    .references(() => leagues.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  name: text('name'),
})

/** One row per manager per gameweek, from entry/{id}/history -> current[]. */
export const managerGwHistory = pgTable(
  'manager_gw_history',
  {
    leagueId: uuid('league_id')
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    entry: integer('entry').notNull(),
    gameweek: integer('gameweek').notNull(),
    points: integer('points').notNull(),
    totalPoints: integer('total_points').notNull(),
    rank: integer('rank'),
    overallRank: integer('overall_rank'),
    pointsOnBench: integer('points_on_bench'),
    eventTransfersCost: integer('event_transfers_cost'),
  },
  (t) => [primaryKey({ columns: [t.leagueId, t.entry, t.gameweek] })],
)

/**
 * One row per prize rule. The number of `season_rank_pct` rows IS the number of
 * paid places — configurable, no schema change needed.
 *   value = fixed amount for *_fixed kinds, percentage (0-100) for season_rank_pct.
 */
export const prizeRules = pgTable('prize_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  leagueId: uuid('league_id')
    .notNull()
    .references(() => leagues.id, { onDelete: 'cascade' }),
  kind: prizeKind('kind').notNull(),
  /** Set for season_rank_pct only; must be contiguous from 1 across the set. */
  rank: integer('rank'),
  value: numeric('value', { precision: 12, scale: 4 }).notNull(),
})

export const dues = pgTable(
  'dues',
  {
    leagueId: uuid('league_id')
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    entry: integer('entry').notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }),
    paid: boolean('paid').notNull().default(false),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    note: text('note'),
  },
  (t) => [primaryKey({ columns: [t.leagueId, t.entry] })],
)

/** Who won what. Tracks winnings, not whether money changed hands (payout tracking is deferred). */
export const winnings = pgTable('winnings', {
  id: uuid('id').primaryKey().defaultRandom(),
  leagueId: uuid('league_id')
    .notNull()
    .references(() => leagues.id, { onDelete: 'cascade' }),
  entry: integer('entry').notNull(),
  kind: prizeKind('kind').notNull(),
  /** Set for gw_winner_fixed; null for season-end prizes. */
  gameweek: integer('gameweek'),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  status: winningStatus('status').notNull().default('provisional'),
})

/**
 * Computed structured stats for a gameweek — NOT rendered text, because blocks are
 * toggled per message and rendering happens at send time.
 * Unique per (league, gameweek): this is what stops a cron poll and a manual
 * refresh from double-preparing.
 */
export const digests = pgTable(
  'digests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id')
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    gameweek: integer('gameweek').notNull(),
    stats: jsonb('stats').notNull(),
    preparedAt: timestamp('prepared_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('digests_league_gameweek_key').on(t.leagueId, t.gameweek)],
)

/**
 * The owner's message. Deliberately MANY per gameweek — a results post and a
 * midweek follow-up are both legitimate. Never add a uniqueness constraint here.
 */
export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  leagueId: uuid('league_id')
    .notNull()
    .references(() => leagues.id, { onDelete: 'cascade' }),
  digestId: uuid('digest_id').references(() => digests.id, { onDelete: 'set null' }),
  channel: messageChannel('channel').notNull().default('whatsapp'),
  /** The owner's own prose, before generated blocks are composed in. */
  body: text('body').notNull().default(''),
  /** Which generated blocks this message included — recorded, not inferred from settings. */
  blocks: jsonb('blocks')
    .$type<{ overallStandings: boolean; gwResults: boolean; prizeStructure: boolean }>()
    .notNull(),
  /** The final composed text. Once edited, it is not reproducible from the API. */
  sentText: text('sent_text'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /** Null means unknown, not failed — the send happens inside WhatsApp and is unobservable. */
  sentAt: timestamp('sent_at', { withTimezone: true }),
  markedSentBy: uuid('marked_sent_by').references(() => users.id, { onDelete: 'set null' }),
})
