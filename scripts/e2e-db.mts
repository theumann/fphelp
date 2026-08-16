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

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.e2e.example to .env.e2e first.')
  process.exit(1)
}

const parsed = new URL(url)
const dbName = parsed.pathname.replace(/^\//, '')

if (dbName !== 'fphelp_e2e') {
  console.error(`Refusing to prepare "${dbName}" — the e2e database must be fphelp_e2e.`)
  process.exit(1)
}

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
