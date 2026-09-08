import {
  capturedEntryCount,
  listAllLeagues,
  saveHistory,
  upsertManagers,
  type LeagueSummary,
} from '@/db/queries'
import { gameweekGate, runVerdict, type LeagueOutcome } from '@/lib/fpl/capture'
import { FplBlockedError, fpl } from '@/lib/fpl/client'
import { droppedGameweeks, historyRows, type HistoryRow } from '@/lib/fpl/history'
import { buildRoster } from '@/lib/fpl/roster'
import { authorisedJobRequest } from '@/lib/jobs-auth'

export const dynamic = 'force-dynamic'

/**
 * Snapshots every manager's gameweek history, for every league.
 *
 * Called by the Railway cron service (`scripts/capture-history.mts`) hourly on
 * Sunday–Wednesday, and safe to call by hand. Most runs do nothing: the gate is checked
 * once from two global calls, and only a settled gameweek makes the run touch a league.
 *
 * Kept out of the page render deliberately: one FPL call per manager has no business
 * adding seconds to a page load or breaking the composer when the API is flaky.
 *
 * `POST ?force=1` re-captures gameweeks already stored — for backfills.
 */

/**
 * How long the run may spend starting new leagues.
 *
 * Not a timeout on work in flight: a league that has started is finished, so a capture is
 * never cut in half. Past this, remaining leagues are reported `deferred` and picked up by
 * the next poll, which is safe because a league with fewer stored entries than its roster
 * reads as outstanding again.
 *
 * Two minutes is chosen against the hourly schedule rather than any hard limit — a run
 * that overlapped the next firing would have two copies walking the same leagues, and the
 * work is idempotent but the FPL call rate would double for no gain.
 */
const RUN_BUDGET_MS = 120_000

interface LeagueReport {
  fplLeagueId: number
  name: string
  outcome: LeagueOutcome
  reason?: string
  managers?: number
  rowsSaved?: number
  gameweeksSeen?: number[]
  dropped?: { entry: number; gameweeks: number[] }[]
  failed?: { entry: number; error: string }[]
  error?: string
}

/**
 * Raised to unwind the whole run when the API starts refusing this host.
 *
 * Carries `savedBeforeBlock` because the single-league version reported it and the number
 * answers the first question anyone asks about a block: did it cost us anything, or did it
 * land between leagues? Rows already written are correct and are kept.
 */
class RunBlocked extends Error {
  constructor(
    readonly cause: FplBlockedError,
    readonly savedBeforeBlock: number,
  ) {
    super(cause.message)
  }
}

export async function POST(req: Request) {
  if (!authorisedJobRequest(req)) {
    return Response.json({ error: 'unauthorised' }, { status: 401 })
  }

  const force = new URL(req.url).searchParams.get('force') === '1'
  const startedAt = Date.now()

  /**
   * Two calls, whatever the league count, and the run usually ends here.
   *
   * Sequential like everything else: the API is behind Cloudflare, which rejects
   * datacenter IPs on reputation and blocked this deployment on 2026-09-01.
   */
  let bootstrap, status
  try {
    bootstrap = await fpl.bootstrapStatic()
    status = await fpl.eventStatus()
  } catch (err) {
    return Response.json({ error: describe(err) }, { status: 502 })
  }

  const gate = gameweekGate(bootstrap, status)

  /**
   * 200, not an error: a poll with nothing to do is the normal outcome, ~95 runs in 96.
   *
   * `?force=1` deliberately does **not** get past this. It exists to re-capture a
   * gameweek already stored, not to capture one that has not settled — `finished` flips
   * before bonus points apply, and history taken in that window stores pre-bonus scores
   * that look entirely plausible. Forcing past the gate would be a one-keystroke way to
   * poison the table.
   */
  if (!gate.ready) {
    return Response.json({
      skipped: true,
      reason: gate.reason,
      gameweek: gate.gameweek,
      leagues: 0,
    })
  }

  const leagues = await listAllLeagues()
  const reports: LeagueReport[] = []
  let blocked: { error: string; savedBeforeBlock: number } | undefined

  for (const league of leagues) {
    if (Date.now() - startedAt > RUN_BUDGET_MS) {
      reports.push({
        fplLeagueId: league.fplLeagueId,
        name: league.name,
        outcome: 'deferred',
        reason: 'run-budget',
      })
      continue
    }

    try {
      reports.push(await captureLeague(league, gate.gameweek, force))
    } catch (err) {
      /**
       * A block is per-IP, not per-league — confirmed on 2026-09-01, when all four
       * endpoints refused this host at once. So the remaining leagues would fail
       * identically, and continuing would spend the run hammering an API that is already
       * refusing us, which is the behaviour most likely to extend the block.
       */
      if (err instanceof RunBlocked) {
        blocked = { error: err.message, savedBeforeBlock: err.savedBeforeBlock }
        break
      }
      reports.push({
        fplLeagueId: league.fplLeagueId,
        name: league.name,
        outcome: 'error',
        error: describe(err),
      })
    }
  }

  /**
   * The leagues the block cut the run short of, including the one it happened in.
   *
   * Guarded rather than left to fall through on an empty slice: every loop iteration
   * pushes exactly one report, so without a block this is always a no-op — and relying on
   * that silently would make the next person wonder what it was for.
   */
  if (blocked) {
    for (const league of leagues.slice(reports.length)) {
      reports.push({
        fplLeagueId: league.fplLeagueId,
        name: league.name,
        outcome: 'deferred',
        reason: 'blocked',
      })
    }
  }

  const verdict = blocked ? 'error' : runVerdict(reports.map((r) => r.outcome))

  return Response.json(
    {
      gameweek: gate.gameweek,
      reason: gate.reason,
      leagues: reports.length,
      captured: reports.filter((r) => r.outcome === 'captured').length,
      elapsedMs: Date.now() - startedAt,
      ...(blocked ? { blocked: true, ...blocked } : {}),
      reports,
    },
    /**
     * A non-2xx is what turns into a failed Sentry check-in, via the cron script's exit
     * code. Any league erroring counts — see `runVerdict`. A deferred league does not:
     * the next poll takes it, and alarming on a healthy budget cut would train the alert
     * to be ignored.
     */
    { status: verdict === 'ok' ? 200 : 502 },
  )
}

/**
 * One league's capture. Throws `RunBlocked` if the API starts refusing this host.
 *
 * Whatever was collected before a block is saved rather than discarded — the rows are
 * already correct, and re-fetching them would spend the very calls the block is
 * punishing.
 */
async function captureLeague(
  league: LeagueSummary,
  gameweek: number,
  force: boolean,
): Promise<LeagueReport> {
  const base = { fplLeagueId: league.fplLeagueId, name: league.name }

  let standings
  try {
    standings = await fpl.leagueStandingsAll(league.fplLeagueId)
  } catch (err) {
    // Blocked on the standings call, before any history was fetched: nothing was saved
    // for this league, and nothing was lost either.
    if (err instanceof FplBlockedError) throw new RunBlocked(err, 0)
    throw err
  }

  const roster = buildRoster(standings)
  // The record of who was in this league at capture time, refreshed off the standings
  // call the capture needed anyway.
  await upsertManagers(league.id, roster)

  if (!force && roster.length > 0) {
    const captured = await capturedEntryCount(league.id, gameweek)
    // `>=` not `===`: a manager who left shrinks the roster without removing their stored
    // rows, and that must not stall the poll into re-capturing forever.
    if (captured >= roster.length) {
      return { ...base, outcome: 'skipped', reason: 'already-captured', managers: roster.length }
    }
  }

  const rows: HistoryRow[] = []
  const failed: { entry: number; error: string }[] = []
  const dropped: { entry: number; gameweeks: number[] }[] = []

  /**
   * Sequential on purpose, and the reason a per-league loop is not parallelised either:
   * firing many requests at once from a shared Railway egress IP is exactly the traffic
   * shape that gets one blocked.
   */
  for (const manager of roster) {
    try {
      const history = await fpl.entryHistory(manager.entry)
      rows.push(...historyRows(manager.entry, history))

      const bad = droppedGameweeks(history)
      if (bad.length > 0) dropped.push({ entry: manager.entry, gameweeks: bad })
    } catch (err) {
      if (err instanceof FplBlockedError) {
        // Keep what was collected: the rows are already correct, and re-fetching them
        // would spend the very calls the block is punishing.
        throw new RunBlocked(err, await saveHistory(league.id, rows))
      }
      // One manager failing is not a reason to lose the other seventeen.
      failed.push({ entry: manager.entry, error: describe(err) })
    }
  }

  const saved = await saveHistory(league.id, rows)

  return {
    ...base,
    // A manager the API refused is missing history, and the next poll will try again —
    // but the run should not report itself healthy in the meantime.
    outcome: failed.length > 0 ? 'error' : 'captured',
    managers: roster.length,
    rowsSaved: saved,
    gameweeksSeen: [...new Set(rows.map((r) => r.gameweek))].sort((a, b) => a - b),
    /** Non-empty means data was skipped rather than stored wrong — worth investigating. */
    dropped,
    failed,
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
