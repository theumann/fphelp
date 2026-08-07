/**
 * Phase 0: which FPL league this deployment serves.
 *
 * Everything else — pot, prize rules, the owner's own team — is configured through
 * /setup and stored in the database. This remains hardcoded because there is still no
 * flow for creating a league, only for configuring the one that exists.
 */
export const REFERENCE_LEAGUE = {
  /** The numeric FPL league ID, not the invite code (`1xrliv` is the join code). */
  fplLeagueId: 9999999,
} as const
