import {
  FAKE_MANAGER_NAMES,
  FAKE_TEAM_NAMES,
  SYNTHETIC_LEAGUE_ID,
  SYNTHETIC_LEAGUE_NAME,
} from '../fake-names'

/**
 * Strips real people out of recorded FPL payloads, preserving their shape.
 *
 * `npm run fpl:record` calls this before anything touches the disk, so a recording never
 * exists in the working tree carrying real names. `scripts/anonymise.mts` is a thin CLI
 * over the same functions, for re-anonymising payloads recorded before this existed.
 *
 * **Why anonymise rather than fabricate.** These files are the change detector: their job
 * is proving the app can read what the real API sends, and a hand-authored replacement
 * proves only that the app can read something we wrote ourselves — which is what
 * `fixtures.ts` is already for. So every key, every type, every null and the pagination
 * envelope are left exactly as the API sent them. Only identity is substituted.
 *
 * **The mapping is deterministic**, and that is not a nicety. The recordings are re-taken
 * each season and the diff *is* the finding — if the same real manager mapped to a
 * different invented name on each run, every re-record would produce a diff where every
 * row changed and a genuine shape change would be buried in it. A given real value always
 * yields the same invented one, so a season-over-season diff shows only what the API
 * actually changed.
 *
 * The hash is not a security boundary and is not meant to be one: it picks an index in a
 * fixed pool, and only the pool entry is ever written. Nothing derived from the real value
 * survives into the output, so there is nothing in a published file to reverse.
 *
 * This lives under `src/` rather than in `scripts/` for two reasons: scripts import from
 * here cleanly under `moduleResolution: "bundler"`, where a script importing another script
 * does not resolve; and it puts the functions where `vitest` can reach them, so determinism
 * and "no real value survives" are pinned by tests rather than by a one-off check.
 */

/** Synthetic entry IDs start here, well clear of the seven-digit range real entries use. */
const SYNTHETIC_ENTRY_BASE = 8_000_001

/** A fixed creation date, so the real league's cannot be used to find it. */
const SYNTHETIC_CREATED = '2026-07-01T12:00:00.000000Z'

/**
 * A stable, order-independent index for a string.
 *
 * FNV-1a, chosen because it is short enough to read and has no dependencies. Any stable
 * hash would do — what matters is that it does not vary between runs or Node versions,
 * which `Math.random` and object iteration order both would.
 */
function hashIndex(value: string, modulo: number): number {
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h % modulo
}

/**
 * Assigns each distinct real value its own pool entry.
 *
 * Collisions are resolved by scanning forward to the next free slot, and the inputs are
 * sorted first so that resolution order does not depend on the order the API happened to
 * return people in. Two managers therefore never share an invented name, which would make
 * a roster of 17 look like a roster of 15.
 */
function buildMap(values: string[], pool: readonly string[]): Map<string, string> {
  if (new Set(values).size > pool.length) {
    throw new Error(
      `Need ${new Set(values).size} invented names but the pool holds ${pool.length}. ` +
        'Add more to src/lib/fake-names.ts.',
    )
  }

  const map = new Map<string, string>()
  const taken = new Set<number>()

  for (const value of [...new Set(values)].sort()) {
    let i = hashIndex(value, pool.length)
    while (taken.has(i)) i = (i + 1) % pool.length
    taken.add(i)
    map.set(value, pool[i]!)
  }

  return map
}

type StandingsRow = {
  entry: number
  entry_name: string
  player_name: string
  club_badge_src: string | null
}

type NewEntryRow = {
  entry: number
  entry_name: string
  player_first_name: string
  player_last_name: string
}

/**
 * Rewrites an uploaded club badge URL, keeping `null` as `null`.
 *
 * **This field is not always null, whatever the endpoint table once said.** Six of the
 * reference league's seventeen managers had uploaded a badge, and the URL embeds both the
 * real entry ID and a per-upload GUID — a live, publicly fetchable image belonging to a
 * real person. It was the least obvious identifier in the whole payload, because the field
 * reads as decorative and is null often enough to look like it always is.
 *
 * The string/null distinction is preserved rather than flattened: `recorded.test.ts`
 * asserts the key exists, and a recording that nulled every badge would stop being evidence
 * of what the API actually sends.
 */
function anonymiseBadge(src: string | null, syntheticEntry: number): string | null {
  if (typeof src !== 'string') return src
  return (
    'https://fantasy.premierleague.com/gcs/plfpl-production-adobe-approved/' +
    `plfpl-production/${syntheticEntry}/00000000-0000-4000-8000-000000000000.png`
  )
}

/**
 * Rewrites a `leagues-classic/{id}/standings/` payload.
 *
 * Returns the entry-ID mapping as well, because `bootstrap-static` and `entry-history` have
 * to agree with it — a recording whose history belongs to an entry that appears nowhere in
 * the standings would be internally inconsistent in a way the real API never is.
 */
export function anonymiseStandings(payload: unknown): {
  payload: unknown
  entryIds: Map<number, number>
} {
  const doc = payload as {
    league: { id: number; name: string; admin_entry: number; created: string }
    standings: { results: StandingsRow[] }
    new_entries: { results: NewEntryRow[] }
  }

  const rows = doc.standings.results ?? []
  const joiners = doc.new_entries.results ?? []

  const names = buildMap(
    [
      ...rows.map((r) => r.player_name),
      ...joiners.map((j) => `${j.player_first_name} ${j.player_last_name}`),
    ],
    FAKE_MANAGER_NAMES,
  )
  const teams = buildMap(
    [...rows.map((r) => r.entry_name), ...joiners.map((j) => j.entry_name)],
    FAKE_TEAM_NAMES,
  )

  // Entry IDs are assigned by sorted real ID, so the mapping is stable and the synthetic
  // IDs come out in a readable ascending run rather than scattered.
  const entryIds = new Map<number, number>()
  const realIds = [...new Set([...rows.map((r) => r.entry), ...joiners.map((j) => j.entry)])]
  realIds.sort((a, b) => a - b)
  realIds.forEach((id, i) => entryIds.set(id, SYNTHETIC_ENTRY_BASE + i))

  for (const row of rows) {
    row.player_name = names.get(row.player_name)!
    row.entry_name = teams.get(row.entry_name)!
    row.club_badge_src = anonymiseBadge(row.club_badge_src, entryIds.get(row.entry)!)
    row.entry = entryIds.get(row.entry)!
  }

  for (const joiner of joiners) {
    const full = names.get(`${joiner.player_first_name} ${joiner.player_last_name}`)!
    const [first, ...rest] = full.split(' ')
    joiner.player_first_name = first!
    joiner.player_last_name = rest.join(' ')
    joiner.entry_name = teams.get(joiner.entry_name)!
    joiner.entry = entryIds.get(joiner.entry)!
  }

  doc.league.id = SYNTHETIC_LEAGUE_ID
  doc.league.name = SYNTHETIC_LEAGUE_NAME
  doc.league.created = SYNTHETIC_CREATED
  // The admin is a real manager, so it must land on that manager's synthetic ID rather than
  // on an arbitrary one — otherwise the league claims an admin who is not in it.
  doc.league.admin_entry = entryIds.get(doc.league.admin_entry) ?? SYNTHETIC_ENTRY_BASE

  return { payload: doc, entryIds }
}

/**
 * Rewrites `bootstrap-static`.
 *
 * `highest_scoring_entry` names the single highest-scoring FPL manager *in the world* that
 * gameweek — a real stranger, unconnected to this league, and an ID that maps to a public
 * profile. It is not ours to publish either, so it is replaced with a synthetic ID rather
 * than nulled: nulling would change the field's type on a payload whose job is to record
 * what the real type is.
 */
export function anonymiseBootstrap(payload: unknown): unknown {
  const doc = payload as { events: { highest_scoring_entry: number | null }[] }

  for (const event of doc.events ?? []) {
    if (typeof event.highest_scoring_entry === 'number') {
      event.highest_scoring_entry = SYNTHETIC_ENTRY_BASE + (event.highest_scoring_entry % 1000)
    }
  }

  return doc
}

/**
 * Rewrites `entry/{id}/history/`.
 *
 * This payload carries no names, which makes it look harmless — but seven seasons of exact
 * `(total_points, rank)` pairs is a fingerprint, and every one of those values is queryable
 * against the public API. Someone sufficiently motivated could match the series back to the
 * entry it came from, so the numbers are perturbed rather than left alone.
 *
 * Perturbation is proportional and deterministic, and deliberately does **not** touch types,
 * key order, array lengths or the string-typed percentage fields — `rank_percentage` and
 * `overall_rank_percentage` arrive as strings, which is a real finding this recording exists
 * to pin, and a rewrite that quietly made them numbers would erase it.
 */
export function anonymiseHistory(payload: unknown): unknown {
  const doc = payload as {
    current: Record<string, unknown>[]
    past: Record<string, unknown>[]
  }

  const nudge = (value: unknown, factor: number): unknown =>
    typeof value === 'number' && value > 0 ? Math.max(1, Math.round(value * factor)) : value

  doc.current?.forEach((row, i) => {
    row.rank = nudge(row.rank, 1.07 + i * 0.01)
    row.rank_sort = nudge(row.rank_sort, 1.07 + i * 0.01)
    row.overall_rank = nudge(row.overall_rank, 1.07 + i * 0.01)
  })

  doc.past?.forEach((row, i) => {
    row.rank = nudge(row.rank, 0.93 + i * 0.02)
    row.total_points = nudge(row.total_points, 0.98 + i * 0.005)
  })

  return doc
}
