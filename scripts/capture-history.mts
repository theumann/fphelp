/**
 * Cron entrypoint for the history capture job.
 *
 * Railway cron services run a command, not a URL, so this is the thin shim that turns
 * a schedule into the authenticated POST. It deliberately holds no logic of its own —
 * the decision about whether there is anything to capture lives in the route, so a
 * manual `curl` and a scheduled run behave identically.
 *
 *   node --env-file=.env --import tsx scripts/capture-history.mts [--force]
 *
 * Env: APP_URL (e.g. https://fphelp.up.railway.app), JOBS_TOKEN.
 */
const appUrl = process.env.APP_URL
const token = process.env.JOBS_TOKEN

if (!appUrl || !token) {
  console.error('APP_URL and JOBS_TOKEN must both be set')
  process.exit(1)
}

const force = process.argv.includes('--force')
const url = `${appUrl.replace(/\/$/, '')}/api/jobs/capture-history${force ? '?force=1' : ''}`

const res = await fetch(url, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}` },
})

const body = await res.text()
console.log(`${res.status} ${body}`)

/**
 * A non-2xx exit code is what makes a failed capture visible in Railway rather than a
 * line in a log nobody reads. A skipped poll is a 200 and exits 0 — it is not a failure.
 */
process.exit(res.ok ? 0 : 1)
