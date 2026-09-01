import Link from 'next/link'

import { Logo } from '@/components/logo'

/**
 * The 404, reached most often by a league URL that names nothing.
 *
 * Deliberately at the root and nowhere else. A `not-found.tsx` inside `l/[leagueId]/`
 * would render *inside* that league's layout — which is exactly the bug this replaces,
 * since that layout's whole job is to put a league's nav on the page. Keeping the only
 * boundary here means a bad league ID falls all the way out of the league chrome and
 * cannot be offered links into a league that does not exist.
 *
 * The way out is the chooser rather than "go back": whoever lands here followed a link to
 * a league they cannot see, and the useful next step is the list of the ones they can.
 */
export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-20 text-center">
      <Logo width={200} />

      <div className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold tracking-tight">Nothing here</h1>
        <p className="max-w-sm text-balance text-sm leading-relaxed text-muted">
          That page doesn&apos;t exist. If you followed a link to a league, the ID in it
          may be wrong — or the league may never have been set up here.
        </p>
      </div>

      <Link
        href="/"
        className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
      >
        Your leagues
      </Link>
    </main>
  )
}
