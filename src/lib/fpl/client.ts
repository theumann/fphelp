import { fixtureFetch, fplFixturesEnabled } from './fixtures'
import type {
  BootstrapStatic,
  ClassicLeagueEntry,
  ClassicLeagueStandings,
  EntryHistory,
  EventStatus,
  NewLeagueEntry,
  Paged,
} from './types'

const BASE = 'https://fantasy.premierleague.com/api'

// The API rejects requests without a browser-ish UA.
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'

/**
 * The FPL API is fronted by Cloudflare, which blocks many datacenter IPs. Railway's
 * egress worked on 2026-08-05, but that's one sample and could change mid-season.
 * A block serves an HTML challenge page rather than a JSON error, so we detect it
 * by content type and surface it instead of retrying into a wall.
 */
export class FplBlockedError extends Error {
  constructor(readonly url: string, readonly status: number) {
    super(
      `FPL API appears to be blocking this host (HTTP ${status}, non-JSON response) at ${url}. ` +
        `See ARCHITECTURE.md "Egress and Cloudflare" — the mitigation is an egress proxy, not a new host.`,
    )
    this.name = 'FplBlockedError'
  }
}

export class FplError extends Error {
  constructor(readonly url: string, readonly status: number, message: string) {
    super(message)
    this.name = 'FplError'
  }
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504])

export interface FplClientOptions {
  /** Retries on transient failures only — never on a block. */
  maxRetries?: number
  baseDelayMs?: number
  fetchImpl?: typeof fetch
}

export class FplClient {
  private readonly maxRetries: number
  private readonly baseDelayMs: number
  private readonly fetchImpl: typeof fetch

  constructor(opts: FplClientOptions = {}) {
    this.maxRetries = opts.maxRetries ?? 3
    this.baseDelayMs = opts.baseDelayMs ?? 400
    this.fetchImpl = opts.fetchImpl ?? fetch
  }

  private async get<T>(path: string): Promise<T> {
    const url = `${BASE}${path}`
    let lastError: Error | undefined

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let res: Response
      try {
        res = await this.fetchImpl(url, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
          cache: 'no-store',
        })
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        if (attempt === this.maxRetries) break
        await this.backoff(attempt)
        continue
      }

      const contentType = res.headers.get('content-type') ?? ''

      // A 403 with HTML is the Cloudflare signature. Fail loudly, don't retry.
      if (!contentType.includes('json') && (res.status === 403 || res.status === 429)) {
        throw new FplBlockedError(url, res.status)
      }

      if (res.ok) {
        if (!contentType.includes('json')) throw new FplBlockedError(url, res.status)
        return (await res.json()) as T
      }

      lastError = new FplError(url, res.status, `FPL request failed: HTTP ${res.status} at ${url}`)
      if (!RETRYABLE.has(res.status) || attempt === this.maxRetries) break
      await this.backoff(attempt)
    }

    throw lastError ?? new FplError(url, 0, `FPL request failed at ${url}`)
  }

  private backoff(attempt: number) {
    const jitter = Math.random() * this.baseDelayMs
    return new Promise((r) => setTimeout(r, this.baseDelayMs * 2 ** attempt + jitter))
  }

  bootstrapStatic() {
    return this.get<BootstrapStatic>('/bootstrap-static/')
  }

  eventStatus() {
    return this.get<EventStatus>('/event-status/')
  }

  entryHistory(entry: number) {
    return this.get<EntryHistory>(`/entry/${entry}/history/`)
  }

  /** A single page. Prefer `leagueStandingsAll` — leagues past 50 managers paginate. */
  leagueStandingsPage(leagueId: number, page = 1) {
    return this.get<ClassicLeagueStandings>(
      `/leagues-classic/${leagueId}/standings/?page_standings=${page}&page_new_entries=${page}`,
    )
  }

  /**
   * Follows `has_next` on BOTH collections. `standings` and `new_entries` paginate
   * independently, so they're exhausted separately — stopping at the first
   * collection to run out would silently drop managers.
   */
  async leagueStandingsAll(leagueId: number): Promise<ClassicLeagueStandings> {
    const first = await this.leagueStandingsPage(leagueId, 1)

    const standings: ClassicLeagueEntry[] = [...first.standings.results]
    const newEntries: NewLeagueEntry[] = [...first.new_entries.results]

    let page = first.standings.page
    let hasNext = first.standings.has_next
    while (hasNext) {
      const next = await this.leagueStandingsPage(leagueId, page + 1)
      standings.push(...next.standings.results)
      page = next.standings.page
      hasNext = next.standings.has_next
    }

    page = first.new_entries.page
    hasNext = first.new_entries.has_next
    while (hasNext) {
      const next = await this.leagueStandingsPage(leagueId, page + 1)
      newEntries.push(...next.new_entries.results)
      page = next.new_entries.page
      hasNext = next.new_entries.has_next
    }

    return {
      ...first,
      standings: { has_next: false, page: 1, results: standings } satisfies Paged<ClassicLeagueEntry>,
      new_entries: { has_next: false, page: 1, results: newEntries } satisfies Paged<NewLeagueEntry>,
    }
  }
}

/**
 * The shared client.
 *
 * Serves canned responses instead of the real API when `FPL_FIXTURES=1`, which is how the
 * Playwright suite gets a renderable league without calling FPL. The branch lives here,
 * in production code, because every page fetches server-side — there is no seam in the
 * browser for a test to intercept, and aliasing the module at build time would mean the
 * suite exercised a different import graph than production does.
 *
 * The variable is set only by `playwright.config.ts` and never in Railway. Activation is
 * announced on stderr: a fake API quietly standing in for a real league, on a deployment
 * that sends messages to actual people, is worse than a crash.
 */
function createClient(): FplClient {
  if (!fplFixturesEnabled()) return new FplClient()

  console.warn(
    '[fpl] FPL_FIXTURES=1 — serving canned fixtures, NOT the real FPL API. ' +
      'Never set this in production.',
  )
  // No retries: a fixture miss is a bug in the fixture, and backing off three times
  // before reporting it only makes the suite slower to tell you.
  return new FplClient({ fetchImpl: fixtureFetch, maxRetries: 0 })
}

export const fpl = createClient()
