/**
 * Sentry, for the failures nobody is watching.
 *
 * This app has one user who opens it about once a week, so "is it up" is close to
 * meaningless — the things that actually go wrong are silent and server-side: Cloudflare
 * starting to block Railway's egress (`FplBlockedError`), a digest half-sending through
 * Resend, a database error inside a Server Action. All of those currently end as a line in
 * a log nobody reads.
 *
 * **Entirely optional.** With no `SENTRY_DSN` the SDK is never initialised and every
 * `Sentry.*` call becomes a no-op, so local dev, `npm test` and the Playwright suite send
 * nothing and need no configuration. That is deliberate rather than lazy: a monitoring tool
 * that has to be present for the app to boot is a new way for the app not to boot.
 *
 * Node only. There is no middleware and no route opts into the edge runtime, and no client
 * SDK is installed — the browser bundle is unchanged and there is no public DSN to manage.
 * Add `sentry.edge.config.ts` and `instrumentation-client.ts` if either of those changes.
 */
import * as Sentry from '@sentry/nextjs'

const dsn = process.env.SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    /**
     * Railway sets no environment name of its own that distinguishes prod from a PR
     * deploy, so this is explicit. Local runs stay out of the way as `development`.
     */
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',

    /**
     * No performance tracing. One user and ~100 cron polls a week produce nothing worth
     * sampling, and traces are what consume a free-tier quota. Errors and cron check-ins
     * are the whole point here; turn this up if there is ever a latency question.
     */
    tracesSampleRate: 0,

    /**
     * The FPL API is unofficial and flaky by nature — a single transient 502 that the
     * client already retries past is not news. `FplClient` throws only after its retries
     * are exhausted, so what reaches Sentry is already the durable failure.
     */
    ignoreErrors: [
      // Next's own navigation control-flow, thrown deliberately and caught by the framework.
      'NEXT_REDIRECT',
      'NEXT_NOT_FOUND',
    ],

    /**
     * Never send the request body or headers. A Server Action's payload can carry the
     * digest text and, on the email path, the league's recipient addresses — none of which
     * belongs in a third-party error tracker for an app whose members never signed up to
     * anything. Stack traces and messages are enough to debug from.
     */
    sendDefaultPii: false,
  })
}
