import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end configuration.
 *
 * Three things this has to arrange before a browser can reach a single page, because the
 * app renders everything server-side:
 *
 * 1. **A database** — `fphelp_e2e`, separate from the development one, since the suite
 *    truncates every table. `npm run e2e:db` creates and migrates it.
 * 2. **A stubbed FPL API** — `FPL_FIXTURES=1`. The real API is unofficial, rate-limited
 *    and behind Cloudflare; a suite that called it would be slow, flaky, and would spend
 *    egress reputation the app depends on. See `src/lib/fpl/fixtures.ts`.
 * 3. **A session** — inserted directly, since sign-in is a magic link. See
 *    `e2e/support/db.ts`.
 *
 * Environment comes from `.env.e2e`, loaded by `dotenv`-free means: the `webServer`
 * command passes it through `--env-file`, and this config reads the same file for the
 * database URL the fixtures need.
 */

const PORT = 3210
const BASE_URL = `http://localhost:${PORT}`

process.loadEnvFile?.('.env.e2e')

export default defineConfig({
  testDir: './e2e',
  // Every test truncates the shared database, so they cannot run concurrently. Correct
  // before fast: parallelism here would make failures depend on timing.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    /**
     * A production build, not `next dev`.
     *
     * Not a preference — Next 16 allows only one dev server per directory, so a suite
     * that ran `next dev` would fail whenever the developer had their own server up,
     * which is always. `next start` has no such restriction.
     *
     * It costs a build per run and buys something back: server/client boundary errors
     * that only a production build catches are caught here too. `NEXT_DIST_DIR` keeps
     * the output out of `.next`, so building for tests does not disturb a dev server
     * running in the same directory.
     */
    command: `npm run build && npm run start -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      FPL_FIXTURES: '1',
      NEXT_DIST_DIR: '.next-e2e',
      // Explicit rather than inherited: the dev server must not come up against the
      // development database when the suite is about to truncate everything.
      DATABASE_URL: process.env.DATABASE_URL ?? '',
      AUTH_SECRET: process.env.AUTH_SECRET ?? 'e2e-secret-not-used-anywhere-real',
      AUTH_TRUST_HOST: 'true',
      // Absent on purpose: no AUTH_RESEND_KEY, so nothing can send mail from the suite.
    },
  },
})
