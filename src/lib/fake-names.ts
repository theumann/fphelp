/**
 * Invented managers and team names, used anywhere a real one would otherwise appear.
 *
 * One pool rather than a list per file. Three places need fabricated people — the demo
 * roster, the hand-authored API fixtures, and the anonymiser that rewrites recorded
 * payloads — and when they each kept their own, a real name that leaked into one of them
 * was invisible from the other two. A single source means "is this name real?" has one
 * place to look.
 *
 * **Nothing here may resemble a real member of a real league.** These are deliberately
 * invented: the surnames are drawn from widely-spread names with no connection to the
 * reference league, and the team names are puns that announce themselves as fiction. If a
 * pool entry ever collides with a real manager, change it here — not at the call site.
 *
 * Both pools are longer than the largest roster that uses them, so an anonymiser mapping
 * distinct people onto distinct names does not have to wrap and produce duplicates.
 */

/**
 * The invented league every fixture and recording claims to be.
 *
 * Seven digits, so it has the shape of a real FPL league ID and exercises the same parsing
 * as one — but a run of nines no real league will hold. Deliberately not plausible-looking:
 * anyone reading a test failure should be able to tell at a glance that this is nobody's
 * league. Shared by `fixtures.ts`, the recordings anonymiser and the tests, so the three
 * cannot drift into claiming to be different leagues.
 */
export const SYNTHETIC_LEAGUE_ID = 9_999_999
export const SYNTHETIC_LEAGUE_NAME = 'The Sunday League'

/** Invented manager names. Never a real person. */
export const FAKE_MANAGER_NAMES = [
  'Cyril Fluck',
  'Sam Okafor',
  'Alex Nowak',
  'Jordan Silva',
  'Casey Lindqvist',
  'Riley Fitzgerald',
  'Morgan Achterberg',
  'Taylor Brennan',
  'Jamie Vasquez',
  'Drew Kowalczyk',
  'Quinn Papadopoulos',
  'Reese Andersson',
  'Avery Nakamura',
  'Blake O’Sullivan',
  'Charlie Bergström',
  'Dana Whitfield',
  'Emerson Castellanos',
  'Frankie Delacroix',
  'Georgie Ravensworth',
  'Harper Lindgren',
  'Indigo Mwangi',
  'Jesse Fontaine',
  'Kai Thorvaldsen',
  'Logan Ferreira',
] as const

/** Invented team names. Puns, so they read as fiction at a glance. */
export const FAKE_TEAM_NAMES = [
  'Coming Home FC',
  'Bald Fraud United',
  'Salah Good Men',
  'Kane & Able',
  'Haaland Oates',
  'Sonny Delight',
  'Trent Boyz',
  'Ode to Joy',
  'Bruno Mars Attacks',
  'Saka Potatoes',
  'Rice Rice Baby',
  'Foden Paradise',
  'Palmer Violence',
  'Watkins Glen',
  'Isak Newton',
  'Mbeumo Rhapsody',
  'Gordon Ramsay FC',
  'Wirtz Case Scenario',
  'Semenyo Say',
  'Eze Does It',
  'Pickford Up The Pieces',
  'Guehi Wire',
  'Nketiah Later',
  'Solanke Dream',
] as const
