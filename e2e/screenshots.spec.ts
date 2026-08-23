import { test } from './support/test'

/**
 * Screenshots, for looking at rather than asserting on.
 *
 * Not part of `npm run e2e`: `playwright.config.ts` excludes this file, so it runs only
 * when asked for by name. There are no expectations in it — a visual pass needs a human
 * to look, and a test that merely proves a page rendered without saying what it looked
 * like would be a worse version of the specs next door.
 *
 *   npx playwright test e2e/screenshots.spec.ts --grep-invert=nothing
 */

/**
 * Not under `test-results/`: Playwright empties that directory at the start of every run,
 * so screenshots written there are deleted by the next `npm run e2e` — which is exactly
 * when you want to still have them.
 */
const SHOTS = 'screenshots'

const SETUP_TABS = ['money', 'messages', 'people'] as const

test.describe('light', () => {
  test.use({ colorScheme: 'light' })

  test('landing', async ({ page }) => {
    await page.goto('/')
    await page.screenshot({ path: `${SHOTS}/landing-light.png`, fullPage: true })
  })

  test('signin', async ({ page }) => {
    await page.goto('/signin')
    await page.screenshot({ path: `${SHOTS}/signin-light.png`, fullPage: true })
  })

  // One shot per tab: a single screenshot of /setup now shows only the panel that
  // happens to be open, which is the one thing this suite exists to notice.
  for (const tab of SETUP_TABS) {
    test(`setup ${tab}`, async ({ ownerPage }) => {
      await ownerPage.goto(`/setup?tab=${tab}`)
      await ownerPage.screenshot({ path: `${SHOTS}/setup-${tab}-light.png`, fullPage: true })
    })
  }
})

test.describe('dark', () => {
  test.use({ colorScheme: 'dark' })

  test('landing', async ({ page }) => {
    await page.goto('/')
    await page.screenshot({ path: `${SHOTS}/landing-dark.png`, fullPage: true })
  })

  test('signin', async ({ page }) => {
    await page.goto('/signin')
    await page.screenshot({ path: `${SHOTS}/signin-dark.png`, fullPage: true })
  })

  // One shot per tab: a single screenshot of /setup now shows only the panel that
  // happens to be open, which is the one thing this suite exists to notice.
  for (const tab of SETUP_TABS) {
    test(`setup ${tab}`, async ({ ownerPage }) => {
      await ownerPage.goto(`/setup?tab=${tab}`)
      await ownerPage.screenshot({ path: `${SHOTS}/setup-${tab}-dark.png`, fullPage: true })
    })
  }
})

/**
 * The nav bar at both ends of the range.
 *
 * Cropped tight, because the bar is the subject: it has three groups competing for one
 * row, and whether the centred mark survives a 390px phone is not something the desktop
 * shot can answer.
 */
test.describe('nav', () => {
  for (const [name, width] of [
    ['phone', 390],
    ['desktop', 1280],
  ] as const) {
    test(name, async ({ ownerPage }) => {
      await ownerPage.setViewportSize({ width, height: 700 })
      await ownerPage.goto('/setup')
      await ownerPage.locator('nav').screenshot({ path: `${SHOTS}/nav-${name}.png` })
    })
  }
})
