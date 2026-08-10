import { createHash, timingSafeEqual } from 'node:crypto'

import { capturedEntryCount, ensureLeague, saveHistory, upsertManagers } from '@/db/queries'
import { captureDecision } from '@/lib/fpl/capture'
import { FplBlockedError, fpl } from '@/lib/fpl/client'
import { lastFinishedGameweek } from '@/lib/fpl/gameweek'
import { droppedGameweeks, historyRows, type HistoryRow } from '@/lib/fpl/history'
import { buildRoster } from '@/lib/fpl/roster'
import { REFERENCE_LEAGUE } from '@/lib/league-config'

export const dynamic = 'force-dynamic'

/**
 * Snapshots every manager's gameweek history.
 *
 * Called by the Railway cron service (`scripts/capture-history.mts`) every 30-60
 * minutes, and safe to call by hand. Most runs do nothing but refresh the roster: the
 * per-manager history calls are gated on `captureDecision`, so the expensive work
 * happens roughly once a week, when a gameweek actually finishes and settles.
 *
 * Kept out of the page render deliberately: one FPL call per manager has no business
 * adding seconds to a page load or breaking the composer when the API is flaky.
 *
 * `POST ?force=1` re-captures a gameweek already stored — for backfills.
 */

function authorised(req: Request): boolean {
  const expected = process.env.JOBS_TOKEN
  // Fail closed. An unset token must not mean an open endpoint.
  if (!expected) return false

  const header = req.headers.get('authorization') ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''

  // Hashing first gives both sides equal length, so timingSafeEqual can't throw and the
  // token's length isn't leaked by an early return.
  const digest = (s: string) => createHash('sha256').update(s).digest()
  return timingSafeEqual(digest(provided), digest(expected))
}

export async function POST(req: Request) {
  if (!authorised(req)) {
    return Response.json({ error: 'unauthorised' }, { status: 401 })
  }

  let standings
  try {
    standings = await fpl.leagueStandingsAll(REFERENCE_LEAGUE.fplLeagueId)
  } catch (err) {
    return Response.json({ error: describe(err) }, { status: 502 })
  }

  const league = await ensureLeague(REFERENCE_LEAGUE.fplLeagueId, standings.league.name)
  const roster = buildRoster(standings)
  // Always kept fresh, even on a skipped poll: new_entries appear between gameweeks and
  // the roster costs nothing beyond the standings call already made.
  await upsertManagers(league.id, roster)

  let bootstrap, status
  try {
    // Sequential, like the loop below: same Cloudflare-shaped egress concern.
    bootstrap = await fpl.bootstrapStatic()
    status = await fpl.eventStatus()
  } catch (err) {
    return Response.json({ error: describe(err) }, { status: 502 })
  }

  const candidate = lastFinishedGameweek(bootstrap)
  const captured = candidate === null ? 0 : await capturedEntryCount(league.id, candidate)

  const decision = captureDecision({
    bootstrap,
    status,
    rosterSize: roster.length,
    capturedEntries: () => captured,
    force: new URL(req.url).searchParams.get('force') === '1',
  })

  if (!decision.capture) {
    // 200, not an error: a poll with nothing to do is the normal outcome.
    return Response.json({
      league: standings.league.name,
      managers: roster.length,
      skipped: true,
      reason: decision.reason,
      gameweek: decision.gameweek,
    })
  }

  const rows: HistoryRow[] = []
  const failed: { entry: number; error: string }[] = []
  const dropped: { entry: number; gameweeks: number[] }[] = []

  /**
   * Sequential on purpose. The FPL API sits behind Cloudflare, which rejects
   * datacenter IPs on reputation, and firing 18 parallel requests from a shared
   * Railway egress IP is exactly the traffic shape that gets one blocked.
   */
  for (const manager of roster) {
    try {
      const history = await fpl.entryHistory(manager.entry)
      rows.push(...historyRows(manager.entry, history))

      const bad = droppedGameweeks(history)
      if (bad.length > 0) dropped.push({ entry: manager.entry, gameweeks: bad })
    } catch (err) {
      // A block affects every subsequent call, so stop rather than retry into a wall.
      if (err instanceof FplBlockedError) {
        await saveHistory(league.id, rows)
        return Response.json(
          { error: describe(err), blocked: true, savedBeforeBlock: rows.length },
          { status: 502 },
        )
      }
      // One manager failing is not a reason to lose the other seventeen.
      failed.push({ entry: manager.entry, error: describe(err) })
    }
  }

  const saved = await saveHistory(league.id, rows)

  return Response.json({
    league: standings.league.name,
    managers: roster.length,
    gameweek: decision.gameweek,
    rowsSaved: saved,
    gameweeksSeen: [...new Set(rows.map((r) => r.gameweek))].sort((a, b) => a - b),
    /** Non-empty means data was skipped rather than stored wrong — worth investigating. */
    dropped,
    failed,
  })
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
