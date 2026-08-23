import { expect, test } from './support/test'

/**
 * The sign-in page's three states.
 *
 * Worth covering because the confirmation is keyed on a parameter Auth.js supplies rather
 * than one we control — `pages.verifyRequest` cannot carry a query string, see the note in
 * `src/auth.ts`. If that coupling ever breaks, the page still renders and still sends the
 * email; it just stops telling the owner it did, which is the sort of regression nobody
 * notices until someone asks why nothing happened.
 *
 * The real submit is not exercised here: it would post to Resend. These drive the page
 * through the URLs Auth.js redirects to.
 */

test('offers the form to a signed-out visitor', async ({ page }) => {
  await page.goto('/signin')

  await expect(page.getByRole('textbox')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Email me a link' })).toBeVisible()
  await expect(page.getByText(/Check your email/)).toHaveCount(0)
})

test('confirms the send on the URL Auth.js redirects to', async ({ page }) => {
  // Exactly what `@auth/core` appends: provider and type, no flag of ours.
  await page.goto('/signin?provider=resend&type=email')

  await expect(page.getByText('Check your email for a sign-in link.')).toBeVisible()
})

test('shows a spent link as an error, not as a confirmation', async ({ page }) => {
  await page.goto('/signin?error=Verification')

  await expect(page.getByText(/no longer valid/)).toBeVisible()
  await expect(page.getByText(/Check your email/)).toHaveCount(0)

  /**
   * The actionable half, asserted separately because it is the half that gets trimmed.
   * The title alone tells someone their link is dead; this tells them why it probably
   * died and what to do differently, which is the only reason the page is worth reading.
   */
  await expect(page.getByText(/forwarded it through WhatsApp/)).toBeVisible()
  await expect(page.getByText(/open it on this device/)).toBeVisible()
})

/**
 * Both parameters can arrive together. Telling the owner their email is on its way while
 * also telling them the link failed is worse than either message alone.
 */
test('never shows both a confirmation and an error', async ({ page }) => {
  await page.goto('/signin?provider=resend&type=email&error=Verification')

  await expect(page.getByText(/no longer valid/)).toBeVisible()
  await expect(page.getByText(/Check your email/)).toHaveCount(0)
})

/**
 * Submitting the form — the FAILED send only.
 *
 * Says so in the name because this cannot reach the success path and it would be easy to
 * assume otherwise. The suite runs a production build with no `AUTH_RESEND_KEY`, so
 * `sendVerificationRequest` throws every time and the action always takes its error
 * branch. Verified rather than assumed: this test passes unchanged against the version
 * before the fix.
 *
 * **The success path is therefore untested**, and it is the one that broke — an owner was
 * parked on `/api/auth/verify-request` after a *successful* send. Covering it would mean
 * mailing through Resend on every run, or adding a fetch seam to `src/auth.ts` of the kind
 * `FPL_FIXTURES` gives the FPL client. Worth doing if this area is touched again; not
 * worth destabilising auth for today.
 */
test('a failed send lands back on the sign-in page, not on an API route', async ({ page }) => {
  await page.goto('/signin')

  await page.getByRole('textbox').fill('owner@example.test')
  await page.getByRole('button', { name: 'Email me a link' }).click()

  await page.waitForURL(/\/signin/)
  expect(page.url()).not.toContain('/api/auth/')
  // Whatever the outcome, the page renders and says something about it.
  await expect(page.getByRole('button', { name: 'Email me a link' })).toBeVisible()
})
