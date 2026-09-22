import { addOwnerRow, listOwnerEmails, seedStranger } from './support/db'
import { expect, leagueUrl, test, useSession } from './support/test'

/**
 * The Setup page.
 *
 * These are the flows that have no unit tests by design — pages, Server Actions and
 * components are deliberately out of Vitest's scope — and where the interesting bugs are
 * about a guard not holding rather than a number being wrong.
 */

test('a signed-out visitor is sent to sign in', async ({ page }) => {
  await page.goto(leagueUrl('/setup'))
  await expect(page).toHaveURL(/\/signin/)
})

test('a signed-in stranger is refused, not enrolled', async ({ page, db, league }) => {
  const stranger = await seedStranger(db)
  await useSession(page, stranger.sessionToken)

  await page.goto(leagueUrl('/setup'))
  await expect(page.getByRole('heading', { name: /don't have access/i })).toBeVisible()

  // The regression this guards: visiting the page used to create the membership.
  expect(await listOwnerEmails(db, league.leagueId)).toEqual(['owner@example.test'])
})

test('an owner sees the whole roster, across both collections and both pages', async ({
  ownerPage,
}) => {
  await ownerPage.goto(leagueUrl('/setup'))

  await expect(ownerPage.getByRole('heading', { name: 'League setup' })).toBeVisible()

  /**
   * 18, and every part of that number is load-bearing: 17 scored managers spread over two
   * pages of 10 plus one joiner who appears only in `new_entries`. A regression in either
   * the `has_next` loop or the union of the two collections shows up here as a smaller
   * league, which is exactly how it would show up in a digest.
   */
  await expect(ownerPage.getByRole('banner').or(ownerPage.locator('header'))).toContainText(
    '18 managers',
  )
  await expect(ownerPage.locator('header')).toContainText('38 gameweeks')

  // The joiner has no scores, so it is the one most likely to be dropped on the way in.
  // The team picker is on the People panel now, so this also checks the roster reaches it.
  await ownerPage.getByRole('tab', { name: 'People' }).click()
  await expect(ownerPage.getByRole('combobox')).toContainText('Late To The Party')
})

test.describe('the save bar', () => {
  // Communication leads now, so the money panel is reached by name rather than by
  // being what /setup happens to open on.
  test.beforeEach(async ({ ownerPage }) => {
    await ownerPage.goto(leagueUrl('/setup?tab=money'))
  })

  test('reports clean, then dirty, then saves', async ({ ownerPage }) => {

    const save = ownerPage.getByRole('button', { name: 'Save settings' })
    await expect(ownerPage.getByText('All changes saved')).toBeVisible()
    await expect(save).toBeDisabled()

    await ownerPage.getByLabel('Total pot').fill('1800')
    await expect(ownerPage.getByText('Unsaved changes')).toBeVisible()
    await expect(save).toBeEnabled()

    await save.click()
    await expect(ownerPage.getByText('Settings saved.')).toBeVisible()
    await expect(ownerPage.getByText('All changes saved')).toBeVisible()
  })

  test('refuses to save while the percentages do not total 100', async ({ ownerPage }) => {
    // Defaults are 40/25/15/10/6/4; raising first place to 50 over-commits the remainder.
    await ownerPage.getByLabel('Percentage for place 1').fill('50')
    await expect(ownerPage.getByText(/add up to 110%, not 100%/)).toBeVisible()
    await expect(ownerPage.getByRole('button', { name: 'Save settings' })).toBeDisabled()
  })
})

/**
 * League expenses.
 *
 * The unit tests own the arithmetic; what only this level can show is that a cost
 * survives a save and comes back, since it is stored in its own table and rewritten
 * wholesale on every save — the failure mode is an expense that looks entered and
 * silently isn't.
 */
test.describe('league expenses', () => {
  test.beforeEach(async ({ ownerPage }) => {
    await ownerPage.goto(leagueUrl('/setup?tab=money'))
  })

  test('a cost is saved, comes back, and comes off the remainder', async ({ ownerPage }) => {
    await ownerPage.getByLabel('Total pot').fill('1800')
    await ownerPage.getByRole('button', { name: 'Add an expense' }).click()
    await ownerPage.getByLabel('Expense 1 label').fill('Trophy engraving')
    await ownerPage.getByLabel('Expense 1 amount').fill('100')

    // $1,800 − (38 × $15 + $100) − $100 of engraving.
    await expect(ownerPage.getByText('$1,030.00').first()).toBeVisible()

    await ownerPage.getByRole('button', { name: 'Save settings' }).click()
    await expect(ownerPage.getByText('Settings saved.')).toBeVisible()

    await ownerPage.reload()
    await expect(ownerPage.getByLabel('Expense 1 label')).toHaveValue('Trophy engraving')
    await expect(ownerPage.getByLabel('Expense 1 amount')).toHaveValue('100')
  })

  test('an unnamed cost blocks the save, since the digest prints the label', async ({
    ownerPage,
  }) => {
    await ownerPage.getByRole('button', { name: 'Add an expense' }).click()
    await ownerPage.getByLabel('Expense 1 amount').fill('100')

    await expect(ownerPage.getByText(/Expense 1 needs a name/)).toBeVisible()
    await expect(ownerPage.getByRole('button', { name: 'Save settings' })).toBeDisabled()
  })

  /** The over-commitment: the fixed prizes fit, and the engraving is what tips it over. */
  test('a cost that overdraws the pot is refused with the expenses named', async ({
    ownerPage,
  }) => {
    await ownerPage.getByLabel('Total pot').fill('700')
    await ownerPage.getByRole('button', { name: 'Add an expense' }).click()
    await ownerPage.getByLabel('Expense 1 label').fill('Trophy engraving')
    await ownerPage.getByLabel('Expense 1 amount').fill('100')

    await expect(ownerPage.getByText('Fixed prizes and expenses cost more than the pot')).toBeVisible()
    await expect(ownerPage.getByRole('button', { name: 'Save settings' })).toBeDisabled()
  })
})

test.describe('owners', () => {
  test.beforeEach(async ({ ownerPage }) => {
    await ownerPage.goto(leagueUrl('/setup'))
    await ownerPage.getByRole('tab', { name: 'People' }).click()
  })

  test('adding an address grants access without sending anything', async ({
    ownerPage,
    db,
    league,
  }) => {
    await ownerPage.getByLabel('Add an owner').fill('co-owner@example.test')
    await ownerPage.getByRole('button', { name: 'Add', exact: true }).click()

    await expect(ownerPage.getByText(/co-owner@example.test can now sign in/)).toBeVisible()
    await expect(ownerPage.getByText('Has not signed in yet')).toBeVisible()

    // Both rows, since either one alone is useless: `users` is what sign-in allowlists,
    // `league_users` is what the pages check.
    expect(await listOwnerEmails(db, league.leagueId)).toEqual([
      'owner@example.test',
      'co-owner@example.test',
    ])
  })

  test('adding the same address twice is a no-op, not an error', async ({ ownerPage, db, league }) => {
    await addOwnerRow(db, league.leagueId, 'co-owner@example.test')
    await ownerPage.getByLabel('Add an owner').fill('co-owner@example.test')
    await ownerPage.getByRole('button', { name: 'Add', exact: true }).click()

    await expect(ownerPage.getByText(/is already an owner/)).toBeVisible()
    expect(await listOwnerEmails(db, league.leagueId)).toHaveLength(2)
  })

  test('a co-owner can be removed', async ({ ownerPage, db, league }) => {
    await addOwnerRow(db, league.leagueId, 'co-owner@example.test')
    await ownerPage.reload()

    await ownerPage
      .getByRole('listitem')
      .filter({ hasText: 'co-owner@example.test' })
      .getByRole('button', { name: 'Remove' })
      .click()

    await expect(ownerPage.getByText('co-owner@example.test')).toBeHidden()
    expect(await listOwnerEmails(db, league.leagueId)).toEqual(['owner@example.test'])
  })

  test('the only owner cannot remove themselves', async ({ ownerPage }) => {
    const you = ownerPage.getByRole('listitem').filter({ hasText: 'owner@example.test' })
    await expect(you).toContainText('you')
    await expect(you.getByRole('button', { name: 'Remove' })).toHaveCount(0)
  })

  /**
   * NOT COVERED: the server-side halves of these two guards.
   *
   * `removeOwnerAction` refuses self-removal and last-owner removal on the server as well
   * as in the component, and that is the half that matters — a Server Action is a public
   * endpoint, so the hidden button is a courtesy and the check is the rule. Reaching it
   * from here means posting a crafted Server Action request with its internal action id,
   * which is a private protocol and would make this suite fragile against Next upgrades
   * for a guard that is four lines long.
   *
   * Left deliberately untested rather than covered by a test that only re-checks the UI
   * and reads as though it checked more.
   */
})

test.describe('email recipients', () => {
  test.beforeEach(async ({ ownerPage }) => {
    await ownerPage.goto(leagueUrl('/setup'))
    await ownerPage.getByRole('tab', { name: 'Communication' }).click()
  })

  test('the list is hidden until email is turned on', async ({ ownerPage }) => {

    await expect(ownerPage.getByText(/sends by WhatsApp only/)).toBeVisible()
    await expect(ownerPage.getByLabel('Add addresses')).toBeHidden()

    await ownerPage.getByRole('checkbox', { name: /digest by email/ }).check()
    await expect(ownerPage.getByLabel('Add addresses')).toBeVisible()
  })

  test('a pasted list reports what it could not read', async ({ ownerPage }) => {
    await ownerPage.getByRole('checkbox', { name: /digest by email/ }).check()

    await ownerPage
      .getByLabel('Add addresses')
      .fill('sam@example.test, Alex Nowak <alex@example.test>, not-an-address')
    await ownerPage.getByRole('button', { name: 'Add to list' }).click()

    await expect(ownerPage.getByText('Added 2.')).toBeVisible()
    await expect(ownerPage.getByText(/Couldn't read 1/)).toBeVisible()
    await expect(ownerPage.getByText('Alex Nowak —')).toBeVisible()
  })
})

test.describe('reply model', () => {
  test('hiding is on until the owner turns it off, and says what changes', async ({
    ownerPage,
  }) => {
    await ownerPage.goto(leagueUrl('/setup?tab=messages'))
    await ownerPage.getByRole('checkbox', { name: /digest by email/ }).check()

    const hide = ownerPage.getByRole('checkbox', { name: /Hide recipients/ })
    await expect(hide).toBeChecked()
    await expect(ownerPage.getByText(/only reply to you/)).toBeVisible()

    // Each state describes what it does to the league, so the owner is choosing between
    // two outcomes rather than between two mail headers.
    await hide.uncheck()
    await expect(ownerPage.getByText(/reaches all league members/)).toBeVisible()

    // Reloaded without the parameter on purpose: `?tab=` survives the reload because the
    // component writes it back, and the setting has to survive independently of that.
    await ownerPage.reload()
    await expect(ownerPage.getByRole('checkbox', { name: /Hide recipients/ })).not.toBeChecked()
  })
})
