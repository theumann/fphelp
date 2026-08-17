/**
 * The guard that stands between the e2e suite and somebody's real data.
 *
 * Everything the suite does to a database is destructive — it truncates every table
 * between tests — so being pointed at the wrong one is not a failed test, it is data loss.
 * `digests` and `sent_text` hold the owner's own writing, which cannot be recovered from
 * the FPL API.
 *
 * Two independent conditions, because either alone is too weak:
 *
 * - **The name must be `fphelp_e2e`.** Catches the ordinary mistake of inheriting a
 *   `.env` that points at the development database.
 * - **The host must be local.** Catches the mistake the name check cannot see. A remote
 *   database that happens to be named `fphelp_e2e` would otherwise pass, and the whole
 *   point of a guard on destructive work is that it does not depend on a coincidence of
 *   naming. Production is a Railway Postgres on a private-network hostname, so this also
 *   makes it structurally unreachable from here.
 *
 * There is deliberately no override. An escape hatch on a guard like this is the thing
 * that gets set once "just to check something" and then lives in a shell profile. If CI
 * ever needs a non-local host, that should be a visible change to this file.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

const EXPECTED_DATABASE = 'fphelp_e2e'

/** Strips credentials so the URL can appear in an error message or a log. */
export function redact(url: string): string {
  return url.replace(/\/\/([^:/@]+):[^@]*@/, '//$1:***@')
}

export interface CheckedDatabaseUrl {
  url: string
  host: string
  database: string
}

/**
 * Validates a connection string for destructive test use, or throws explaining why not.
 *
 * Exported separately from the pool it protects so it can be tested directly — the branch
 * that matters here is the one that refuses, and a guard whose refusal path never runs is
 * indistinguishable from no guard.
 */
export function checkE2eDatabaseUrl(raw: string | undefined): CheckedDatabaseUrl {
  if (!raw || raw.trim() === '') {
    throw new Error(
      'DATABASE_URL is not set for the e2e suite. Copy .env.e2e.example to .env.e2e first.',
    )
  }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`DATABASE_URL is not a valid URL: ${redact(raw)}`)
  }

  // Node keeps the brackets on an IPv6 hostname; the set holds the bare form.
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const database = parsed.pathname.replace(/^\//, '')

  if (database !== EXPECTED_DATABASE) {
    throw new Error(
      `Refusing to run the e2e suite against database "${database}" (${redact(raw)}). ` +
        `It must be named "${EXPECTED_DATABASE}" — these tests truncate every table.`,
    )
  }

  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Refusing to run the e2e suite against host "${host}" (${redact(raw)}). ` +
        'The e2e database must be local — these tests truncate every table, and a remote ' +
        'database with the right name is still somebody\'s real data.',
    )
  }

  return { url: raw, host, database }
}
