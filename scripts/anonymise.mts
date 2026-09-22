/**
 * Re-anonymises the committed recordings in place.
 *
 *   node --import tsx scripts/anonymise.mts
 *
 * Normally you never run this. `npm run fpl:record` anonymises as it records, so a payload
 * with real names in it never reaches the disk. This exists for the one case that script
 * cannot cover: payloads recorded before anonymisation existed, which have to be rewritten
 * from what is already committed.
 *
 * The substitution itself lives in `src/lib/fpl/anonymise.ts` — this file is only the file
 * I/O around it. See that module for why the recordings are anonymised rather than
 * fabricated, and why the mapping has to be deterministic.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  anonymiseBootstrap,
  anonymiseHistory,
  anonymiseStandings,
} from '../src/lib/fpl/anonymise'
import { SYNTHETIC_LEAGUE_ID } from '../src/lib/fake-names'

const RECORDED = join(process.cwd(), 'src/lib/fpl/recorded')

async function rewrite(name: string, fn: (body: unknown) => unknown) {
  const file = join(RECORDED, `${name}.json`)
  const body = JSON.parse(await readFile(file, 'utf8')) as unknown
  // Same serialisation as `record-fixtures.mts`, so re-anonymising a file produces no
  // formatting diff on top of the identity one.
  await writeFile(file, `${JSON.stringify(fn(body), null, 2)}\n`, 'utf8')
  console.log(`  anonymised ${name}.json`)
}

/**
 * Refuses a second pass.
 *
 * The substitution is not idempotent, and cannot sensibly be: an invented name is just a
 * string, so running it again maps it through the pool to a *different* invented name. The
 * result would still be anonymous, so nothing would look wrong — you would simply get a
 * diff where all seventeen rows changed for no reason, on files whose diff is the one
 * signal this project reads each season.
 */
const standingsFile = join(RECORDED, 'league-standings.json')
const current = JSON.parse(await readFile(standingsFile, 'utf8')) as {
  league: { id: number }
}
if (current.league.id === SYNTHETIC_LEAGUE_ID) {
  console.log('\nAlready anonymised — league is the synthetic one. Nothing to do.\n')
  process.exit(0)
}

console.log('\nAnonymising recorded payloads\n')
await rewrite('league-standings', (b) => anonymiseStandings(b).payload)
await rewrite('bootstrap-static', anonymiseBootstrap)
await rewrite('entry-history', anonymiseHistory)
console.log('\nevent-status.json contains no identifiers and is left alone.\n')
