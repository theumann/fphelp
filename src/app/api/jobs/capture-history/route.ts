import { createHash, timingSafeEqual } from 'node:crypto'

import { ensureLeague, saveHistory, upsertManagers } from '@/db/queries'
import { FplBlockedError, fpl } from '@/lib/fpl/client'
import { droppedGameweeks, historyRows, type HistoryRow } from '@/lib/fpl/history'
import { buildRoster } from '@/lib/fpl/roster'
import { REFERENCE_LEAGUE } from '@/lib/league-config'

export const dynamic = 'force-dynamic'

/**
 * Snapshots every manager's gameweek history.
 *
 * Not wired to a scheduler yet — this is the endpoint a Railway cron will call, and
 * until then it is triggered by hand. Kept out of the page render deliberately: it
 * makes one FPL call per manager, which has no business adding seconds to a page load
 * or breaking the composer when the API is flaky.
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
  await upsertManagers(league.id, roster)

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
