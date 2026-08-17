import { defineConfig } from '@playwright/test'

import base from './playwright.config'

/**
 * The visual pass: `npm run e2e:screens`.
 *
 * A second config rather than a flag on the first, because `testIgnore` cannot be
 * overridden from the command line — and inverting it through an environment variable
 * would mean the normal suite's behaviour depended on something invisible in the command
 * that ran it.
 *
 * Everything else is inherited, so the screenshots get the same stubbed FPL API, the same
 * `fphelp_e2e` database and the same seeded session as the tests. That is the point: these
 * are pictures of the app under the conditions the suite already establishes, not a second
 * environment to keep in step.
 */
export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: ['**/screenshots*.spec.ts'],
})
