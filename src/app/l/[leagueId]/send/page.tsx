import { Composer } from '@/components/composer'
import { NotAnOwner } from '@/components/not-an-owner'
import {
  findDelivery,
  findDraft,
  getSettings,
  listRecipients,
  ownerSignature,
  syncLeagueName,
  upsertDigest,
} from '@/db/queries'
import { demoRoster } from '@/lib/demo'
import { computeDigestStats } from '@/lib/digest/stats'
import { FplBlockedError, fpl } from '@/lib/fpl/client'
import { gameweekCount, sendGate } from '@/lib/fpl/gameweek'
import { buildRoster } from '@/lib/fpl/roster'
import { requireLeagueAccess } from '@/lib/league-access'
import { DEFAULT_SETTINGS, summarise } from '@/lib/league-settings'
import type { BlockSelection } from '@/lib/render/blocks'

// Live FPL data — never serve a cached table as this week's result.
export const dynamic = 'force-dynamic'

export default async function SendPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>
  searchParams: Promise<{ demo?: string }>
}) {
  const [{ leagueId }, { demo }] = await Promise.all([params, searchParams])

  /**
   * Access is resolved before anything else, and — unlike before — `?demo=1` no longer
   * skips it. The demo path used to be reachable by any signed-in user, because the
   * membership check lived inside `if (!demo)` along with everything that touches the
   * database. Harmless when there was one league and everyone in `users` owned it; not a
   * property to carry into a world where a URL names the league.
   */
  const access = await requireLeagueAccess(leagueId)
  if (!access.member) return <NotAnOwner />
  const { league } = access

  let standings
  let bootstrap
  let eventStatus

  try {
    ;[standings, bootstrap, eventStatus] = await Promise.all([
      fpl.leagueStandingsAll(league.fplLeagueId),
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
            ? 'The API appears to be blocking this host. This is the Cloudflare datacenter-IP risk - see ARCHITECTURE.md; the fix is an egress proxy, not a redeploy.'
            : 'The request failed. This is usually transient - the FPL API goes down around deadlines.'}
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

  /**
   * The readiness gate, decided in `sendGate` so it can be tested — this page cannot be.
   *
   * It withholds the generated blocks rather than the whole page. Writing to the group
   * mid-week is a normal thing for an owner to do and nothing about it is unsafe; what
   * cannot be undone is attaching a table of provisional scores to it. Blocking the page
   * outright stopped both, and the one it needed to stop was the second.
   *
   * Demo mode is exempt because it is synthetic and exists to test message length.
   */
  const gate = sendGate(bootstrap, eventStatus)
  const statsReady = demo ? true : gate.statsReady

  const gameweek = demo ? 5 : gate.gameweek
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
  let signature = `${access.userName ?? access.userEmail} - ${standings.league.name} Admin`
  // Demo mode has no league, so no pot — `undefined` rather than 0, which would render a
  // prize block claiming the pot is nothing.
  let prize = summarise(
    {
      ...DEFAULT_SETTINGS,
      potTotal: undefined,
      rankPercentages: [...DEFAULT_SETTINGS.rankPercentages],
    },
    gameweekCount(bootstrap),
  )

  if (!demo) {
    await syncLeagueName(league.id, standings.league.name, league.name)

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
    signature = await ownerSignature(league.id, access.userId, standings.league.name, roster)

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
        statsReady={statsReady}
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
