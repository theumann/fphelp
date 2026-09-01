import { seedLeague, seedStranger } from './support/db'
import { expect, leagueUrl, test, useSession } from './support/test'

/**
 * League resolution — the routing half of multi-league (docs/MULTI-LEAGUE.md phase A).
 *
 * The pages themselves are covered by `setup.spec.ts` and `send.spec.ts`, which now
 * navigate straight to `/l/<id>/…`. What is left, and what these cover, is everything
 * about *which* league a URL means: the redirects that keep old links working, the chooser
 * for an owner with more than one, and — the one that matters — that a URL naming someone
 * else's league does not open it.
 */

/** Distinct from the fixture league, so a mix-up between the two is visible by name. */
const OTHER_LEAGUE = 990001

test('a single-league owner still lands on their composer', async ({ ownerPage }) => {
  // The behaviour from before leagues had URLs, preserved deliberately: a chooser listing
  // one league is a click charged for nothing, every week.
  await ownerPage.goto('/')
  await expect(ownerPage).toHaveURL(leagueUrl('/send'))
})

test('the old paths forward, carrying their query', async ({ ownerPage }) => {
  await ownerPage.goto('/send')
  await expect(ownerPage).toHaveURL(leagueUrl('/send'))

  // The tab has to survive, or a stale link forwards to the wrong panel — which looks
  // like the page opening on the wrong thing rather than like a broken redirect.
  await ownerPage.goto('/setup?tab=money')
  await expect(ownerPage).toHaveURL(leagueUrl('/setup?tab=money'))
  await expect(ownerPage.getByRole('tab', { name: 'Pot & prizes' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
})

test('an owner of two leagues chooses, and stays inside the one they picked', async ({
  page,
  db,
  league,
}) => {
  await seedLeague(db, { fplLeagueId: OTHER_LEAGUE, ownerId: league.ownerId })
  await useSession(page, league.sessionToken)

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Your leagues' })).toBeVisible()

  await page.getByRole('link', { name: new RegExp(`${OTHER_LEAGUE}`) }).click()
  await expect(page).toHaveURL(`/l/${OTHER_LEAGUE}/send`)

  // The nav is the thing most likely to leak across leagues, since its links were absolute
  // paths until leagues had URLs. Following one has to stay in this league, not fall back
  // to whichever league is first.
  await page.getByRole('link', { name: 'Setup' }).click()
  await expect(page).toHaveURL(`/l/${OTHER_LEAGUE}/setup`)
  await expect(page.locator('header')).toContainText(`FPL league ${OTHER_LEAGUE}`)
})

test("an owner of one league cannot open another league's pages", async ({
  page,
  db,
  league,
}) => {
  // The league exists and has an owner — just not this one. This is the isolation that
  // multi-tenancy rests on, and the only place a URL could grant access that a Server
  // Action's `assertOwner` would not catch.
  const other = await seedLeague(db, { fplLeagueId: OTHER_LEAGUE, email: 'someone@example.test' })
  expect(other.leagueId).not.toEqual(league.leagueId)

  await useSession(page, league.sessionToken)
  await page.goto(`/l/${OTHER_LEAGUE}/setup`)

  await expect(page.getByRole('heading', { name: /don't have access/i })).toBeVisible()

  // The league is real, so the layout renders — but every link in it would refuse them,
  // so the bar reduces. Sign out has to survive, or the refusal is a dead end.
  await expect(page.getByRole('link', { name: 'Compose' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
})

test('a league ID that names nothing is a 404, not a new league', async ({ ownerPage, db }) => {
  const response = await ownerPage.goto('/l/424242/send')
  expect(response?.status()).toBe(404)

  /**
   * The nav must not appear here at all.
   *
   * The regression: the bar used to work its league out of the pathname, which on a 404
   * still contains `/l/424242/`, so it offered Compose, Dues and Setup for a league that
   * does not exist — three links, three more 404s. The pathname says what was asked for;
   * only the server knows whether it resolved. The 404 boundary is at the root precisely
   * so it renders outside the league layout that draws the bar.
   */
  await expect(ownerPage.getByRole('link', { name: 'Compose' })).toHaveCount(0)
  await expect(ownerPage.getByRole('link', { name: 'Setup' })).toHaveCount(0)
  await expect(ownerPage.getByRole('link', { name: 'Your leagues' })).toBeVisible()

  // The regression this guards is the reason resolution is read-only: pages used to call
  // `ensureLeague`, which would have created a row for any number typed in the address bar.
  const { rows } = await db.query('SELECT count(*)::int AS n FROM leagues')
  expect(rows[0].n).toBe(1)
})

test('a signed-in user with no leagues is told so, and can still sign out', async ({
  page,
  db,
}) => {
  const stranger = await seedStranger(db)
  await useSession(page, stranger.sessionToken)

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'No leagues yet' })).toBeVisible()

  // They stay on `/` now rather than being redirected through it, so the nav has to render
  // here — without it there is no way out of this page at all.
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
})
