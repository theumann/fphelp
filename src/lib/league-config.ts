/**
 * Which FPL league a request is about.
 *
 * The **web app no longer reads this**. Pages take the league from the URL
 * (`/l/<fplLeagueId>/…`) and resolve it against `leagues` rows the user is a member of,
 * so one deployment serves as many leagues as have been created — see
 * docs/MULTI-LEAGUE.md phase A.
 *
 * The **capture cron no longer reads it either** — since phase B it iterates the `leagues`
 * table, so every league is captured and none has to be named in the environment.
 *
 * What is left is the **operational scripts**, where it is only a default: `add-owner`,
 * `clear-test-digest`, `fpl-snapshot` and `record-fixtures` all act on one league and use
 * this when none is given on the command line. So `FPL_LEAGUE_ID` now changes nothing
 * about a running deployment — it changes what a script does when you do not tell it.
 */

/** The reference league, used when nothing is configured. */
const DEFAULT_LEAGUE_ID = 9999999

/**
 * Parses the configured league ID, or throws.
 *
 * Fails loudly on a bad value instead of falling back to the default: silently serving
 * the wrong league is exactly the class of bug this project keeps guarding against, and
 * a deployment that names a league it cannot serve should not start.
 *
 * The invite code is the trap this exists for. `1xrliv` is what the FPL UI shows for
 * joining a league; the API needs the number from the league URL, and there is no
 * unauthenticated way to convert one to the other. Unvalidated it becomes `NaN` and
 * surfaces much later as an unexplained 404 from the standings endpoint.
 */
export function parseLeagueId(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_LEAGUE_ID

  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(
      `FPL_LEAGUE_ID must be the numeric league ID from the league URL, got "${raw}". ` +
        'An invite code like "1xrliv" is not the league ID and cannot be converted to one.',
    )
  }

  return id
}

/**
 * Parses an FPL league ID out of a URL segment, or returns null.
 *
 * Separate from `parseLeagueId` because the two failure modes are different. A bad
 * `FPL_LEAGUE_ID` is a misconfigured deployment and should stop it starting; a bad URL
 * segment is a stranger typing in the address bar and should be a 404, not a 500.
 *
 * Stricter than `Number()` on purpose: that accepts `" 9999999 "`, `0x98967f`, `1e5` and
 * `Infinity`, each of which would then be looked up as a perfectly ordinary league ID
 * and produce a 404 anyway — but only after a database round trip, and with two URLs
 * naming the same league.
 */
export function parseLeagueSegment(raw: string): number | null {
  if (!/^[1-9][0-9]*$/.test(raw)) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) ? id : null
}

export const REFERENCE_LEAGUE = {
  /** The numeric FPL league ID, not the invite code (`1xrliv` is the join code). */
  fplLeagueId: parseLeagueId(process.env.FPL_LEAGUE_ID),
} as const
