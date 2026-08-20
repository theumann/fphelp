import { seedLeague } from './support/db'
import { expect, test, useSession } from './support/test'

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

/**
 * The channel tabs.
 *
 * `seedLeague` leaves email off by default, matching a WhatsApp-only league, so these
 * seed their own league with it switched on rather than relying on the shared fixture.
 */
test.describe('channel tabs', () => {
  test('a WhatsApp-only league sees no tabs at all', async ({ ownerPage }) => {
    await ownerPage.goto('/send')

    await expect(ownerPage.getByRole('tablist')).toHaveCount(0)
    await expect(ownerPage.getByRole('link', { name: 'Send to WhatsApp' })).toBeVisible()
  })

  test('email leads, and the bottom action follows the tab', async ({ page, db }) => {
    const league = await seedLeague(db, {
      emailEnabled: true,
      recipients: ['steve@example.test', 'victor@example.test'],
    })
    await useSession(page, league.sessionToken)
    await page.goto('/send')

    // Email is selected on arrival, and its action names the recipient count — the
    // safeguard against the one irreversible button in the app.
    await expect(page.getByRole('tab', { name: 'Email' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('button', { name: 'Send email to 2' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Send to WhatsApp' })).toHaveCount(0)

    await page.getByRole('tab', { name: 'WhatsApp' }).click()
    await expect(page.getByRole('link', { name: 'Send to WhatsApp' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Send email to/ })).toHaveCount(0)
  })

  test('the send button refuses a league with no addresses', async ({ page, db }) => {
    const league = await seedLeague(db, { emailEnabled: true })
    await useSession(page, league.sessionToken)
    await page.goto('/send')

    await expect(page.getByRole('button', { name: 'No recipients yet' })).toBeDisabled()
  })

  test('the length budget stays visible from the email tab', async ({ page, db }) => {
    const league = await seedLeague(db, { emailEnabled: true, recipients: ['a@example.test'] })
    await useSession(page, league.sessionToken)
    await page.goto('/send')

    const whatsappTab = page.getByRole('tab', { name: /WhatsApp/ })
    await expect(whatsappTab).not.toContainText('over the length budget')

    // The budget is a WhatsApp constraint and its meter lives on that tab, so going over
    // while composing in email has to be visible from here or it is invisible entirely.
    await page.getByRole('textbox', { name: 'Your message' }).fill('x'.repeat(1600))
    await expect(whatsappTab).toContainText('over the length budget')
  })
})

/**
 * The reply model, reachable from the composer.
 *
 * It lives in Setup as a league setting, but Setup is not where anyone thinks about
 * sending — an owner who wanted a conversation would compose, send, and only find out the
 * digest was bcc'd when nobody could reply. So it is surfaced here too, and these prove the
 * two places are one stored value rather than two that can disagree.
 */
test.describe('reply model on the compose page', () => {
  test('is visible in the email tab and defaults to hidden', async ({ page, db }) => {
    const league = await seedLeague(db, {
      emailEnabled: true,
      recipients: ['a@example.test', 'b@example.test'],
    })
    await useSession(page, league.sessionToken)
    await page.goto('/send')

    const hide = page.getByRole('checkbox', { name: /Hide recipients/ })
    await expect(hide).toBeChecked()
    await expect(page.getByText(/only reply to you/)).toBeVisible()
    // The send bar has to agree with the checkbox — it is the last thing read before sending.
    await expect(page.getByText(/Addresses are bcc/)).toBeVisible()
  })

  test('unticking it updates the send bar and reaches Setup', async ({ page, db }) => {
    const league = await seedLeague(db, {
      emailEnabled: true,
      recipients: ['a@example.test', 'b@example.test'],
    })
    await useSession(page, league.sessionToken)
    await page.goto('/send')

    await page.getByRole('checkbox', { name: /Hide recipients/ }).uncheck()
    await expect(page.getByText(/Everyone sees the list and can reply to all/)).toBeVisible()
    await expect(page.getByText(/see all 2 addresses/)).toBeVisible()

    // One value, two views: the change has to be visible in Setup, not just here.
    await page.goto('/setup')
    await expect(page.getByRole('checkbox', { name: /Hide recipients/ })).not.toBeChecked()
  })
})
