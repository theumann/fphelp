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
