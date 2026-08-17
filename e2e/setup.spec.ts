import { addOwnerRow, listOwnerEmails, seedStranger } from './support/db'
import { expect, test, useSession } from './support/test'

/**
 * The Setup page.
 *
 * These are the flows that have no unit tests by design — pages, Server Actions and
 * components are deliberately out of Vitest's scope — and where the interesting bugs are
 * about a guard not holding rather than a number being wrong.
 */

test('a signed-out visitor is sent to sign in', async ({ page }) => {
  await page.goto('/setup')
  await expect(page).toHaveURL(/\/signin/)
})

test('a signed-in stranger is refused, not enrolled', async ({ page, db, league }) => {
  const stranger = await seedStranger(db)
  await useSession(page, stranger.sessionToken)

  await page.goto('/setup')
  await expect(page.getByRole('heading', { name: /don't have access/i })).toBeVisible()

  // The regression this guards: visiting the page used to create the membership.
  expect(await listOwnerEmails(db, league.leagueId)).toEqual(['owner@example.test'])
})

test('an owner sees the whole roster, across both collections and both pages', async ({
  ownerPage,
}) => {
  await ownerPage.goto('/setup')

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
  await expect(ownerPage.getByRole('combobox')).toContainText('Late To The Party')
})

test.describe('the save bar', () => {
  test('reports clean, then dirty, then saves', async ({ ownerPage }) => {
    await ownerPage.goto('/setup')

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
    await ownerPage.goto('/setup')

    // Defaults are 40/25/15/10/6/4; raising first place to 50 over-commits the remainder.
    await ownerPage.getByLabel('Percentage for place 1').fill('50')
    await expect(ownerPage.getByText(/add up to 110%, not 100%/)).toBeVisible()
    await expect(ownerPage.getByRole('button', { name: 'Save settings' })).toBeDisabled()
  })
})

test.describe('owners', () => {
  test('adding an address grants access without sending anything', async ({
    ownerPage,
    db,
    league,
  }) => {
    await ownerPage.goto('/setup')

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
    await ownerPage.goto('/setup')

    await ownerPage.getByLabel('Add an owner').fill('co-owner@example.test')
    await ownerPage.getByRole('button', { name: 'Add', exact: true }).click()

    await expect(ownerPage.getByText(/is already an owner/)).toBeVisible()
    expect(await listOwnerEmails(db, league.leagueId)).toHaveLength(2)
  })

  test('a co-owner can be removed', async ({ ownerPage, db, league }) => {
    await addOwnerRow(db, league.leagueId, 'co-owner@example.test')
    await ownerPage.goto('/setup')

    await ownerPage
      .getByRole('listitem')
      .filter({ hasText: 'co-owner@example.test' })
      .getByRole('button', { name: 'Remove' })
      .click()

    await expect(ownerPage.getByText('co-owner@example.test')).toBeHidden()
    expect(await listOwnerEmails(db, league.leagueId)).toEqual(['owner@example.test'])
  })

  test('the only owner cannot remove themselves', async ({ ownerPage }) => {
    await ownerPage.goto('/setup')

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
  test('the list is hidden until email is turned on', async ({ ownerPage }) => {
    await ownerPage.goto('/setup')

    await expect(ownerPage.getByText(/sends by WhatsApp only/)).toBeVisible()
    await expect(ownerPage.getByLabel('Add addresses')).toBeHidden()

    await ownerPage.getByRole('checkbox', { name: /digest by email/ }).check()
    await expect(ownerPage.getByLabel('Add addresses')).toBeVisible()
  })

  test('a pasted list reports what it could not read', async ({ ownerPage }) => {
    await ownerPage.goto('/setup')
    await ownerPage.getByRole('checkbox', { name: /digest by email/ }).check()

    await ownerPage
      .getByLabel('Add addresses')
      .fill('steve@example.test, Indigo Mwangi <victor@example.test>, not-an-address')
    await ownerPage.getByRole('button', { name: 'Add to list' }).click()

    await expect(ownerPage.getByText('Added 2.')).toBeVisible()
    await expect(ownerPage.getByText(/Couldn't read 1/)).toBeVisible()
    await expect(ownerPage.getByText('Indigo Mwangi —')).toBeVisible()
  })
})
