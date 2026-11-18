import { seedGameweekScores } from './support/db'
import { expect, leagueUrl, test } from './support/test'

/**
 * The winnings ledger on the Dues page.
 *
 * The arithmetic is covered in `ledger.test.ts`. What only a page can show is that the
 * pieces meet: stored history, the fixture's settled gameweek, the default prize rules,
 * and the rule that a provisional figure is never presented as won.
 */

/** The fixture's 17 scored managers, in standings order. See `src/lib/fpl/fixtures.ts`. */
const SCORED = [
  1000001, 1000002, 1000003,
  ...Array.from({ length: 14 }, (_, i) => 1_000_013 + i),
]

test('pays a tied gameweek split, and holds back one still being captured', async ({
  ownerPage,
  db,
  league,
}) => {
  await seedGameweekScores(db, league.leagueId, [
    // GW1: the top two tie on 90, so the $15 default prize pools and splits.
    ...SCORED.map((entry, i) => ({ entry, gameweek: 1, points: i < 2 ? 90 : 50 })),
    // GW2 is settled in the fixture but one manager is not captured yet. They might have
    // won it, so the ledger must not name a winner.
    ...SCORED.slice(0, -1).map((entry) => ({ entry, gameweek: 2, points: entry === 1000003 ? 99 : 40 })),
  ])

  await ownerPage.goto(leagueUrl('/dues'))

  const managers = ownerPage.getByRole('list', { name: 'Winnings by manager' })
  const salah = managers.getByRole('listitem').filter({ hasText: 'Salah Bin Dover' })
  await expect(salah).toContainText('GW1')
  await expect(salah).toContainText('$7.50')
  // The best gameweek is shared too, and shown as a projection rather than as won.
  await expect(salah).toContainText('+$50.00 projected')

  // Sonny Delight's 99 is in the half-captured gameweek, so it wins nothing yet.
  await expect(managers).not.toContainText('Sonny Delight')
  await expect(ownerPage.getByText(/GW2 is still being captured/)).toBeVisible()

  // The fixture league has no pot, so the places have nothing to be a share of.
  await expect(ownerPage.getByText(/Set the pot in Setup/)).toBeVisible()

  await ownerPage.getByText('By gameweek').click()
  await expect(ownerPage.getByRole('list', { name: 'Winnings by gameweek' })).toContainText(
    '$15.00 split',
  )
})

test('says so when no gameweek has been captured', async ({ ownerPage }) => {
  await ownerPage.goto(leagueUrl('/dues'))

  // The fixture has two settled gameweeks and nothing stored for either. That is a gap
  // in the ledger, and it must read as one rather than as nobody having won.
  await expect(ownerPage.getByText(/No scores were captured for GW1, GW2/)).toBeVisible()
})
