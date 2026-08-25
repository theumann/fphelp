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
 * Env: APP_URL (scheme optional — a bare `xyz.up.railway.app` is assumed https),
 * JOBS_TOKEN. Optionally SENTRY_DSN, which turns on the check-in below.
 */
import * as Sentry from '@sentry/node'

const appUrl = process.env.APP_URL
const token = process.env.JOBS_TOKEN

if (!appUrl || !token) {
  console.error('APP_URL and JOBS_TOKEN must both be set')
  process.exit(1)
}

const force = process.argv.includes('--force')

/**
 * Sentry Crons: alert when this job stops running at all.
 *
 * The one failure mode nothing else catches. An exception gets reported, a bad deploy
 * shows up in Railway — but a cron that silently stops firing looks exactly like a cron
 * with nothing to do, and this job's normal output is "skipped". The gap would surface
 * months later as missing history in the Phase 4 stats.
 *
 * The monitor is upserted from here, so its schedule lives in this repo next to the code
 * rather than only in a dashboard. **That is what makes the schedule safe to narrow.** A
 * fixed-interval heartbeat ("ping me hourly or alarm") would fire every Thursday through
 * Saturday, when `0 * * * 0-3` deliberately does not run; giving Sentry the same cron
 * expression means it expects the silence. If the Railway schedule changes, change it
 * here too — a monitor that disagrees with reality trains you to ignore it.
 */
const MONITOR_SLUG = 'capture-history'
const monitorConfig = {
  schedule: { type: 'crontab', value: '0 * * * 0-3' },
  /** Generous: a run is late, not lost, if a deploy or a slow FPL call pushes it over. */
  checkinMargin: 15,
  maxRuntime: 10,
  timezone: 'UTC',
} as const

const dsn = process.env.SENTRY_DSN
if (dsn) Sentry.init({ dsn, environment: process.env.SENTRY_ENVIRONMENT ?? 'production' })

/** No-ops without a DSN, so the job runs identically unmonitored. */
const checkInId = dsn
  ? Sentry.captureCheckIn({ monitorSlug: MONITOR_SLUG, status: 'in_progress' }, monitorConfig)
  : undefined

/**
 * Railway's own `RAILWAY_PUBLIC_DOMAIN` is a bare hostname with no scheme, so APP_URL
 * is very easily set to something `fetch` rejects outright. Defaulting to https rather
 * than demanding a scheme keeps that from being a deploy-time failure.
 */
const base = /^https?:\/\//.test(appUrl) ? appUrl : `https://${appUrl}`
const url = new URL(
  `/api/jobs/capture-history${force ? '?force=1' : ''}`,
  base.replace(/\/$/, ''),
)

/** The exit code, which is also the check-in verdict. */
async function run(): Promise<number> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })
  } catch (err) {
    // The app being unreachable is a failed run, not a crashed script with no check-in.
    console.error(`Request failed: ${err instanceof Error ? err.message : String(err)}`)
    if (dsn) Sentry.captureException(err)
    return 1
  }

  const body = await res.text()
  console.log(`${res.status} ${body}`)
  return res.ok ? 0 : 1
}

/**
 * A non-2xx exit code is what makes a failed capture visible in Railway rather than a
 * line in a log nobody reads. A skipped poll is a 200 and exits 0 — it is not a failure.
 *
 * The check-in follows the same rule, deliberately: a skip is a healthy run. Reporting
 * skips as errors would alarm on roughly 95 of every 96 weekly runs, and an alert that
 * cries wolf that often is worse than no alert.
 */
const code = await run()

if (dsn && checkInId) {
  Sentry.captureCheckIn(
    { checkInId, monitorSlug: MONITOR_SLUG, status: code === 0 ? 'ok' : 'error' },
    monitorConfig,
  )
  // The process exits immediately after this; without a flush the event never leaves.
  await Sentry.flush(2000)
}

process.exit(code)
