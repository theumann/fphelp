import { networkInterfaces } from "node:os";

import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

/**
 * This machine's own LAN addresses, so a phone on the same wifi can load the dev server.
 *
 * Next 16 blocks cross-origin requests to dev-only assets, which includes every JS chunk
 * and the HMR socket. Reaching `next dev` by LAN IP therefore serves HTML that never
 * hydrates: the page appears, and nothing on it works. The failure names the origin in the
 * server log and nowhere in the browser, so it reads as the app being broken.
 *
 * Computed rather than hardcoded because the address is handed out by DHCP and moves — it
 * changed under this project mid-session, which silently invalidated a sign-in link that
 * had the old address baked into it. Listing only this machine's addresses also keeps the
 * dev server closed to the rest of the network, which is the point of the block: on a
 * public wifi, `192.168.*.*` would invite anyone on it to read your source maps.
 */
function lanOrigins(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i!.address);
}

/**
 * Response headers, applied to every route.
 *
 * Defence in depth: none of these fixes a known hole, and one of them covers a scenario
 * this app makes unusually plausible — see `X-Frame-Options` below. They were absent until
 * 2026-09-11, when production served nothing but `Server` and `x-powered-by`.
 *
 * **No Content-Security-Policy, deliberately.** A CSP's main job is mitigating XSS, and
 * the injection surface here is close to nil: React escapes everything, nothing uses
 * `dangerouslySetInnerHTML`, and the one place raw HTML is built by hand (`renderEmail`)
 * produces email, which no browser policy governs. Against that, a useful CSP on the App
 * Router needs a nonce threaded through middleware — and one shipped with `unsafe-inline`
 * instead would provide the appearance of protection and little else. There is also
 * something specific to test first: the composer's `whatsapp://send?text=` link is a
 * custom-scheme navigation, exactly the sort of thing a policy breaks quietly on one
 * platform, and it is the app's core feature. Revisit if the app ever renders HTML it did
 * not author.
 */
const securityHeaders = [
  /**
   * HTTPS only, for a year. No `preload` and no `includeSubDomains`: preloading is
   * effectively irreversible — browsers ship the list, so removal takes months — and this
   * is a small app that may yet want a plain-HTTP subdomain for something.
   */
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },

  /**
   * The one with a real scenario rather than a theoretical one.
   *
   * Framed on a hostile page and overlaid, a signed-in owner can be made to click through
   * to **Remove owner** or **Send email to N recipients** without seeing what they hit.
   * Both are one click, consequential, and — for the send — explicitly the button in this
   * app that cannot be taken back. Clickjacking is usually theatre; here it lands on the
   * two controls that matter most.
   *
   * `DENY` rather than `SAMEORIGIN` because nothing here is ever framed, including by
   * itself. It does mean the app can never be embedded anywhere, which is the intent.
   */
  { key: 'X-Frame-Options', value: 'DENY' },

  /** Stops a browser second-guessing a declared content type. Free, and never wrong. */
  { key: 'X-Content-Type-Options', value: 'nosniff' },

  /**
   * URLs here carry league IDs, and the send page links out to `wa.me`. There is no reason
   * to hand a third party the path the owner was on.
   */
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },

  /** Switch off what the app never uses, so a future dependency cannot quietly start. */
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,

  /** Free version disclosure, and nothing depends on it. */
  poweredByHeader: false,

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },

  // Dev-only by construction: Next ignores this outside `next dev`.
  allowedDevOrigins: lanOrigins(),

  /**
   * Build output location, overridable for the end-to-end suite.
   *
   * Playwright builds and serves the app itself. Writing that into `.next` would stamp
   * on the dev server a developer almost certainly has running in the same directory —
   * Next allows only one dev server per directory, and they share this folder. A separate
   * `.next-e2e` lets the suite run without anyone having to stop working first.
   */
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

/**
 * Sentry's build step, which uploads source maps so a stack trace names a line of
 * TypeScript rather than a minified chunk.
 *
 * Gated on `SENTRY_AUTH_TOKEN` being present. Without it the wrapper is skipped entirely,
 * so `npm run build` works unchanged on a fresh clone, in the Playwright suite, and in any
 * CI that has no Sentry credentials — a monitoring tool must not be able to fail a build.
 * Railway has the token; nothing else needs it.
 *
 * The org and project are **literals, not environment variables**. Neither is a secret —
 * they are slugs, visible in every Sentry URL — and putting them here means this file
 * states where errors go, instead of that answer living in a dashboard nobody opens while
 * reading code. The token stays in the environment because it is the only actual
 * credential. Getting these two wrong costs readable stack traces, nothing more: the
 * upload fails, `silent: true` swallows it, and the deploy succeeds regardless.
 *
 * If the project slug is ever changed in Sentry, change it here — the DSN keeps working
 * either way, since it is keyed on the numeric project ID, so the only symptom is source
 * maps quietly ceasing to upload.
 */
const SENTRY_ORG = "theapps";
const SENTRY_PROJECT = "fphelp";

const sentryEnabled = Boolean(process.env.SENTRY_AUTH_TOKEN);

export default sentryEnabled
  ? withSentryConfig(nextConfig, {
      org: SENTRY_ORG,
      project: SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      // The build log is read when a deploy fails; Sentry's own chatter is not the reason.
      silent: true,
      // Uploaded, then deleted from the output — never served to a browser.
      sourcemaps: { deleteSourcemapsAfterUpload: true },
      /**
       * No `disableLogger` (nor its replacement, `webpack.treeshake.removeDebugLogging`).
       * It tree-shakes the SDK's own logging statements to slim the bundle, which is a
       * browser concern — and there is no client SDK here, so there is no browser bundle
       * carrying Sentry code to slim. Setting it bought nothing and printed a deprecation
       * warning into the startup logs on every boot, which are the logs read when a deploy
       * has gone wrong. Add it back under the new name if a client SDK is ever installed.
       */
    })
  : nextConfig;
