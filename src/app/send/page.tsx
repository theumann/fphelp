import { redirect } from 'next/navigation'

import { auth } from '@/auth'
import { Composer } from '@/components/composer'
import { NotAnOwner } from '@/components/not-an-owner'
import {
  ensureLeague,
  findDelivery,
  findDraft,
  findMembership,
  getSettings,
  listRecipients,
  ownerSignature,
  upsertDigest,
} from '@/db/queries'
import { demoRoster } from '@/lib/demo'
import { computeDigestStats } from '@/lib/digest/stats'
import { FplBlockedError, fpl } from '@/lib/fpl/client'
import {
  type ReadinessReason,
  gameweekCount,
  isGameweekReady,
  lastFinishedGameweek,
} from '@/lib/fpl/gameweek'
import { buildRoster } from '@/lib/fpl/roster'
import { REFERENCE_LEAGUE } from '@/lib/league-config'
import { DEFAULT_SETTINGS, summarise } from '@/lib/league-settings'
import type { BlockSelection } from '@/lib/render/blocks'

// Live FPL data — never serve a cached table as this week's result.
export const dynamic = 'force-dynamic'

/**
 * Why the gameweek isn't safe to send yet. Phrased as "what FPL is still doing" rather
 * than as an error — nothing has gone wrong, the data just isn't settled.
 */
const NOT_READY_REASONS: Record<Exclude<ReadinessReason, 'ready'>, string> = {
  'not-finished': 'the gameweek is still in progress.',
  'no-event-status': "FPL isn't reporting a status for this gameweek yet.",
  'bonus-pending': "bonus points haven't been applied to every match yet.",
  'leagues-not-updated': "match points are in, but FPL hasn't recalculated the league tables yet.",
  'data-not-checked': "FPL hasn't finished verifying the gameweek's data.",
}

function NotReady({
  gameweek,
  reason,
}: {
  gameweek: number
  reason: ReadinessReason
}) {
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-lg font-semibold">GW{gameweek} isn&apos;t final yet</h1>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        The standings can still change, because{' '}
        {reason === 'ready' ? 'the gameweek is settling.' : NOT_READY_REASONS[reason]}
      </p>
      <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
        Sending now would post a table that looks right and isn&apos;t. This usually clears
        within a few hours of the last match — reload then.
      </p>
    </main>
  )
}

export default async function SendPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>
}) {
  const { demo } = await searchParams

  const session = await auth()
  if (!session?.user?.id) redirect('/signin')

  let standings
  let bootstrap
  let eventStatus

  try {
    ;[standings, bootstrap, eventStatus] = await Promise.all([
      fpl.leagueStandingsAll(REFERENCE_LEAGUE.fplLeagueId),
      fpl.bootstrapStatic(),
      // Fetched unconditionally so the readiness gate below can never be skipped by
      // an early return. If this call fails the page fails closed, which is the
      // intended trade: no digest at all beats a digest built on pre-bonus scores.
      fpl.eventStatus(),
    ])
  } catch (err) {
    const blocked = err instanceof FplBlockedError
    return (
      <main className="mx-auto max-w-xl p-6">
        <h1 className="text-lg font-semibold">Couldn&apos;t reach the FPL API</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          {blocked
            ? 'The API appears to be blocking this host. This is the Cloudflare datacenter-IP risk — see ARCHITECTURE.md; the fix is an egress proxy, not a redeploy.'
            : 'The request failed. This is usually transient — the FPL API goes down around deadlines.'}
        </p>
        <pre className="mt-4 overflow-auto rounded bg-neutral-100 p-3 text-xs dark:bg-neutral-900">
          {err instanceof Error ? err.message : String(err)}
        </pre>
      </main>
    )
  }

  // ?demo=1 substitutes a synthetic scored league so the ~1,500 char budget and the
  // truncation path can be tested before GW1. Remove once the season starts.
  const roster = demo ? demoRoster(Number(demo) > 1 ? Number(demo) : 18) : buildRoster(standings)

  const finished = lastFinishedGameweek(bootstrap)

  /**
   * The readiness gate. `finished` flips before bonus points are applied and league
   * tables recalculate on their own schedule, so a gameweek that reports finished can
   * still be carrying pre-bonus scores — a table that looks entirely normal and is
   * wrong. Once the owner taps through to WhatsApp that is unrecoverable, so this
   * blocks composing rather than warning.
   *
   * Two states are deliberately NOT gated:
   *   - demo mode, which is synthetic and exists to test message length
   *   - pre-season, where no gameweek has finished at all. Nobody has scored, so there
   *     are no stale numbers to show; the roster renders score-less, which is a
   *     documented state (the whole league is in it before GW1).
   */
  if (!demo && finished !== null) {
    const readiness = isGameweekReady(bootstrap, eventStatus, finished)
    if (!readiness.ready) {
      return <NotReady gameweek={finished} reason={readiness.reason} />
    }
  }

  // Pre-season there is no finished gameweek; show GW1 so the page still works.
  const gameweek = demo ? 5 : (finished ?? 1)
  const stats = computeDigestStats(roster, gameweek)

  /**
   * Only reached in demo mode, which has no league row to read defaults from. A real
   * league's defaults come from `leagues.default_blocks` below.
   */
  let defaultBlocks: BlockSelection = {
    overallStandings: true,
    gwResults: true,
    prizeStructure: false,
  }

  // Demo mode persists nothing — it exists to test message length, not to write
  // synthetic rows into the real league's history.
  let persistence
  // Demo mode never gets the email panel: there is no league row to read the opt-in
  // from, and no recipient list that a synthetic roster could correspond to.
  let email
  let signature = `${session.user.name ?? session.user.email} — ${standings.league.name} Admin`
  let prize = summarise(
    { ...DEFAULT_SETTINGS, potTotal: 0, rankPercentages: [...DEFAULT_SETTINGS.rankPercentages] },
    gameweekCount(bootstrap),
  )

  if (!demo) {
    const league = await ensureLeague(REFERENCE_LEAGUE.fplLeagueId, standings.league.name)

    // This page composes and sends to the whole league, so it checks membership like
    // the others. The Server Actions behind it already call assertOwner — this stops a
    // non-owner reading the draft, which those cannot.
    if (!(await findMembership(league.id, session.user.id))) return <NotAnOwner />

    /**
     * The league's own defaults, which is what a new draft starts from and what both
     * panels fall back to. Previously hardcoded here, so the column existed, Setup had no
     * way to change it, and every owner got the same three choices whatever they wanted.
     */
    defaultBlocks = league.defaultBlocks

    const digest = await upsertDigest(league.id, gameweek, stats)
    const draft = await findDraft(league.id, gameweek)

    // Prizes come from the league's saved settings, not a hardcoded config.
    prize = summarise(await getSettings(league.id), gameweekCount(bootstrap))

    // The signature is per-sender: co-owners have different FPL entries and sign with
    // their own team, so it is built at render time from the signed-in owner's row and
    // never baked into the shared digest.
    signature = await ownerSignature(league.id, session.user.id, standings.league.name, roster)

    // Counted even when the list is empty — the panel says so, rather than hiding and
    // leaving the owner to wonder why email vanished.
    const [recipientList, delivered] = await Promise.all([
      listRecipients(league.id),
      findDelivery(league.id, gameweek, 'email'),
    ])

    email = {
      enabled: league.emailEnabled,
      recipientCount: recipientList.length,
      gameweekCount: gameweekCount(bootstrap),
      hideRecipients: league.hideRecipients,
      // Only a success counts as sent — a failed attempt delivered nothing.
      sentAt:
        delivered?.status === 'sent' ? delivered.updatedAt.toISOString() : undefined,
    }

    persistence = {
      leagueId: league.id,
      digestId: digest.id,
      messageId: draft?.id,
      initialBody: draft?.body ?? '',
      initialBlocks: draft?.blocks ?? defaultBlocks,
      sentAt: draft?.sentAt?.toISOString(),
    }
  }

  return (
    <main>
      <Composer
        stats={stats}
        prize={prize}
        signature={signature}
        leagueName={standings.league.name}
        defaultBlocks={defaultBlocks}
        email={email}
        persistence={persistence}
      />
    </main>
  )
}
