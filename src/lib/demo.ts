import { FAKE_MANAGER_NAMES, FAKE_TEAM_NAMES } from './fake-names'
import type { RosterManager } from './fpl/roster'

/**
 * A synthetic full-strength league, for testing the digest at realistic length before
 * the season starts.
 *
 * Pre-season every manager is a new entry with no scores, so the real message is short
 * and never approaches the ~1,500 character budget. This exercises the ceiling — and the
 * truncation path — on a real device. Delete once GW1 has been scored.
 */
export function demoRoster(count = 18): RosterManager[] {
  const names = FAKE_MANAGER_NAMES
  const teams = FAKE_TEAM_NAMES

  return Array.from({ length: count }, (_, i) => ({
    entry: 1000 + i,
    entryName: teams[i % teams.length],
    playerName: names[i % names.length],
    rank: i + 1,
    // A plausible spread of movement, including a couple of big swings.
    lastRank: i === 0 ? 7 : i === 4 ? 1 : i === 11 ? 3 : i + 1 + ((i % 5) - 2),
    total: 640 - i * 11 - (i % 3),
    eventTotal: 84 - i * 2 - (i % 4),
    pending: false,
  }))
}
