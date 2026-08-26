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

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,

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
