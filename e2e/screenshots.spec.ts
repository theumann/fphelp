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

const SHOTS = 'test-results/screens'

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

  test('setup', async ({ ownerPage }) => {
    await ownerPage.goto('/setup')
    await ownerPage.screenshot({ path: `${SHOTS}/setup-light.png`, fullPage: true })
  })
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

  test('setup', async ({ ownerPage }) => {
    await ownerPage.goto('/setup')
    await ownerPage.screenshot({ path: `${SHOTS}/setup-dark.png`, fullPage: true })
  })
})
