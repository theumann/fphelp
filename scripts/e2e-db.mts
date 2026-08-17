/**
 * Creates and migrates the end-to-end test database.
 *
 * Separate from `fphelp_dev` on purpose: the suite truncates every table between tests,
 * and pointing that at the database you develop against would delete the league you were
 * in the middle of testing by hand. `e2e/support/db.ts` refuses any database not named
 * `fphelp_e2e`; this is what creates it.
 *
 * Idempotent — run it whenever migrations change.
 */
import { execSync } from 'node:child_process'

import { Client } from 'pg'

import { checkE2eDatabaseUrl } from '../e2e/support/db-url'

/**
 * The same guard the suite itself uses, rather than a second copy that could drift.
 * This script runs migrations, so pointing it at the wrong database is a schema change
 * somewhere it was not wanted.
 */
let checked: ReturnType<typeof checkE2eDatabaseUrl>
try {
  checked = checkE2eDatabaseUrl(process.env.DATABASE_URL)
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}

const parsed = new URL(checked.url)
const dbName = checked.database

// Connect to the maintenance database to issue CREATE DATABASE, which cannot run
// inside the database it creates.
const admin = new Client({ connectionString: new URL('/postgres', parsed).href })
await admin.connect()

const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
if (rowCount === 0) {
  await admin.query(`CREATE DATABASE ${dbName}`)
  console.log(`[e2e-db] created ${dbName}`)
} else {
  console.log(`[e2e-db] ${dbName} already exists`)
}
await admin.end()

// drizzle-kit reads DATABASE_URL itself, which already points at fphelp_e2e.
// A single command string rather than an args array: passing args with `shell: true`
// trips Node's DEP0190, and there is nothing user-supplied here to escape.
execSync('npx drizzle-kit migrate', { stdio: 'inherit' })
console.log('[e2e-db] migrations applied')
