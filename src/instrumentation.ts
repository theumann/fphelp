import type { Instrumentation } from 'next'

/**
 * Next's observability hook, called once per server instance before any request is served.
 *
 * Kept as a thin shim over `sentry.server.config.ts` — the config file is the convention
 * Sentry's build tooling expects, and importing it dynamically here keeps the SDK out of
 * the module graph for runtimes that do not use it.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config')
  }
}

/**
 * Server-side errors Next catches on our behalf — a throw inside a Server Component, a
 * Route Handler, or a Server Action.
 *
 * Without this they are logged and swallowed. `/send` and `/setup` are almost entirely
 * Server Actions, so this is the hook that covers the paths that matter: a failed send, a
 * database error mid-save, an FPL call that dies during a render.
 *
 * `captureRequestError` is a no-op when the SDK was never initialised, so this is safe
 * with no DSN configured.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const { captureRequestError } = await import('@sentry/nextjs')
  captureRequestError(err, request, context)
}
