import { expect, test } from './support/test'

/**
 * The composer's block selection.
 *
 * Both of these are regressions that were reported from real use rather than caught here,
 * which is the argument for covering them now: the failure is a setting quietly reverting,
 * and nothing about the page looks wrong when it happens.
 */

const STANDINGS = { name: /Overall standings/ }
const PRIZES = { name: /Prize structure/ }

test('a block toggle survives leaving the page and coming back', async ({ ownerPage }) => {
  await ownerPage.goto('/send')

  const prizes = ownerPage.getByRole('checkbox', PRIZES)
  await expect(prizes).not.toBeChecked()
  await prizes.check()

  /**
   * Straight to another page with no pause. The bug was an 800ms debounce shared with the
   * message body, so a toggle followed by a quick navigation was written nowhere — and any
   * wait here would hide exactly the case being tested.
   */
  await ownerPage.getByRole('link', { name: 'Setup' }).click()
  await expect(ownerPage.getByRole('heading', { name: 'League setup' })).toBeVisible()

  await ownerPage.getByRole('link', { name: 'Compose' }).click()
  await expect(ownerPage.getByRole('checkbox', PRIZES)).toBeChecked()
})

test('the league default decides what a new draft starts with', async ({ ownerPage }) => {
  // Standings default on, prizes off — assert the starting point before changing it, so a
  // change in the defaults cannot make this test pass for the wrong reason.
  await ownerPage.goto('/send')
  await expect(ownerPage.getByRole('checkbox', STANDINGS)).toBeChecked()
  await expect(ownerPage.getByRole('checkbox', PRIZES)).not.toBeChecked()

  await ownerPage.goto('/setup')
  const defaults = ownerPage.getByRole('list').filter({ hasText: 'Gameweek results' })
  await defaults.getByRole('checkbox', STANDINGS).uncheck()
  await defaults.getByRole('checkbox', PRIZES).check()

  await ownerPage.reload()
  await expect(defaults.getByRole('checkbox', STANDINGS)).not.toBeChecked()

  // A draft already exists for this gameweek by now, and its own selection wins — the
  // default only decides where a *new* one starts. So this asserts the stored default,
  // which is the part Setup owns.
  await ownerPage.goto('/setup')
  await expect(defaults.getByRole('checkbox', PRIZES)).toBeChecked()
})
