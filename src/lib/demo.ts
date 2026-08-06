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
  const names = [
    'Thierry Heumann', 'Cyril Fluck', 'Sam Okafor', 'Alex Nowak', 'Jordan Silva',
    'Casey Lindqvist', 'Riley Fitzgerald', 'Morgan Achterberg', 'Taylor Brennan',
    'Jamie Vasquez', 'Drew Kowalczyk', 'Quinn Papadopoulos', 'Reese Andersson',
    'Avery Nakamura', 'Blake O’Sullivan', 'Charlie Bergström', 'Dana Whitfield',
    'Emerson Castellanos', 'Frankie Delacroix', 'Georgie Ravensworth',
  ]

  const teams = [
    'Coming Home FC', 'Bald Fraud United', 'Salah Good Men', 'Kane & Able',
    'Haaland Oates', 'Sonny Delight', 'Trent Boyz', 'Ode to Joy',
    'Bruno Mars Attacks', 'Saka Potatoes', 'Rice Rice Baby', 'Foden Paradise',
    'Palmer Violence', 'Watkins Glen', 'Isak Newton', 'Mbeumo Rhapsody',
    'Gordon Ramsay FC', 'Wirtz Case Scenario', 'Semenyo Say', 'Eze Does It',
  ]

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
