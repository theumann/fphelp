import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import * as schema from './schema'

declare global {
  // eslint-disable-next-line no-var
  var __fphelpPool: Pool | undefined
}

function createPool() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')

  return new Pool({
    connectionString: url,
    // Railway Postgres terminates TLS with its own cert; the private-network
    // hostname won't match a public CA chain.
    ssl: url.includes('railway') ? { rejectUnauthorized: false } : undefined,
  })
}

// Reused across hot reloads in dev so we don't exhaust connections.
const pool = globalThis.__fphelpPool ?? createPool()
if (process.env.NODE_ENV !== 'production') globalThis.__fphelpPool = pool

export const db = drizzle(pool, { schema })
export { schema }
