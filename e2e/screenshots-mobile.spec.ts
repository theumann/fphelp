import { devices } from '@playwright/test'

import { seedLeague } from './support/db'
import { test, useSession } from './support/test'

/**
 * The composer at phone size. Run by `npm run e2e:screens`; asserts nothing.
 *
 * Its own file because Playwright only accepts device options at the top level of a spec,
 * not inside a `describe`.
 *
 * **This cannot verify the safe-area inset.** `env(safe-area-inset-bottom)` resolves to 0
 * in every headless browser — no engine emulates the iOS home indicator — so the send bar
 * here sits flush to the bottom edge and looks the same whether the fix is present or not.
 * What this shows is the layout at 393px; whether the button clears the home indicator has
 * to be checked on a physical iPhone.
 *
 * `defaultBrowserType` is dropped from the device profile because it names webkit, and the
 * suite installs chromium only. The viewport, scale factor and touch flags are what matter
 * for a layout screenshot, and those survive.
 */
const iPhone = { ...devices['iPhone 15'] }
delete (iPhone as { defaultBrowserType?: string }).defaultBrowserType

test.use(iPhone)

test('send page', async ({ page, db }) => {
  const league = await seedLeague(db)
  await useSession(page, league.sessionToken)
  await page.goto('/send')
  await page.screenshot({ path: 'test-results/screens/send-iphone.png' })
})
