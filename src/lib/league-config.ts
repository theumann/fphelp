/**
 * Phase 0: which FPL league this deployment serves.
 *
 * Everything else — pot, prize rules, the owner's own team — is configured through
 * /setup and stored in the database. The league itself is deployment-level rather than
 * a setting because there is still no flow for creating a league, only for configuring
 * the one that exists.
 *
 * `FPL_LEAGUE_ID` overrides the default so a second deployment (staging, a friend's
 * league) needs a variable rather than a recompile.
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

export const REFERENCE_LEAGUE = {
  /** The numeric FPL league ID, not the invite code (`1xrliv` is the join code). */
  fplLeagueId: parseLeagueId(process.env.FPL_LEAGUE_ID),
} as const
