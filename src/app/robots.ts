import type { MetadataRoute } from 'next'

/**
 * What crawlers are asked to fetch.
 *
 * Written as a route rather than a static `public/robots.txt` for the same reason
 * `manifest.ts` is: it sits with the rest of the app's metadata, and the paths below stay
 * next to the routes they name instead of in a file nobody opens when routes move.
 *
 * **This grants and denies nothing.** robots.txt is a request that well-behaved crawlers
 * honour, not an access control — every path below already refuses a signed-out visitor
 * through `requireLeagueAccess` and the Server Actions' own checks, and that is what keeps
 * them private. Nothing here should ever be the reason something is safe. A crawler that
 * ignores this file learns exactly what a stranger with a browser would: a 404, or a page
 * telling them to sign in.
 *
 * What it is actually for is the two things a disallow can do:
 *
 * 1. **Keeping league URLs out of search results.** `/l/<fplLeagueId>/…` contains a real
 *    league's numeric ID. Those pages refuse anyone who is not an owner, so the risk is not
 *    disclosure — it is that a league ID is a durable, guessable-looking identifier, and
 *    there is no reason to publish a list of the ones in use.
 * 2. **Keeping the crawl on the one page with anything to say.** The landing page is the
 *    whole public surface. Everything else costs a fetch and returns a refusal.
 *
 * `/signin` is disallowed for a third reason: it is a form that sends mail, rate limited in
 * two places precisely because it can be POSTed at. There is nothing to index on it and no
 * reason to invite automated traffic.
 *
 * No `sitemap` entry, because there is no sitemap — one page does not need an index of
 * itself, and pointing at a route that does not exist is worse than saying nothing.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      /**
       * `/send`, `/setup` and `/dues` are the bare redirects an owner with exactly one
       * league lands on; `/l/` covers the real, league-scoped versions. Both forms are
       * listed because both resolve.
       */
      disallow: ['/api/', '/l/', '/leagues', '/signin', '/send', '/setup', '/dues'],
    },
  }
}
