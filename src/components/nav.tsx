'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useFormStatus } from 'react-dom'

import { signOutAction } from '@/app/auth-actions'
import { Logo } from '@/components/logo'

const LINKS = [
  { suffix: '/send', label: 'Compose' },
  { suffix: '/dues', label: 'Dues' },
  { suffix: '/setup', label: 'Setup' },
]

function SignOutButton() {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg px-3 py-2 text-sm text-muted disabled:opacity-50"
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  )
}

/**
 * `who` is the signed-in owner's email, and `prefix` is the league the links belong to.
 *
 * Showing who is signed in is not decoration. Co-owners may share a device, and the
 * digest is signed by whoever sends it, so "which owner am I right now" changes the
 * output of the app rather than just the greeting.
 *
 * **`prefix` is given, never derived.** It was briefly read out of `usePathname`, which
 * is wrong in the one case that matters: on a 404 the path still contains a league
 * segment, so the bar cheerfully offered three links into a league that does not exist,
 * each of which 404s in turn. The pathname says what was *asked for*; only the server
 * knows whether it resolved. So the league layout passes this down after checking, and
 * `null` means "no league here" — on `/`, and on any 404 or refusal, where the bar
 * reduces to the mark and Sign out.
 *
 * Still a client component, for `aria-current` on the active link.
 */
export function Nav({ who, prefix = null }: { who?: string | null; prefix?: string | null }) {
  const pathname = usePathname()

  return (
    <nav className="border-b border-line bg-surface">
      {/**
       * The mark is centred in the space *between* the two groups, not against the bar.
       *
       * So its position depends on what flanks it, and it shifts at the `sm` breakpoint
       * where the signed-in address appears. That is accepted deliberately: centring on
       * the gap keeps equal breathing room on both sides at every width, which is what
       * actually reads as deliberate, whereas centring on the bar looks off whenever the
       * two sides differ — which on a phone is always.
       *
       * Flow layout rather than absolute positioning, so the groups push the mark instead
       * of it overlapping them. At 390px the three links are wider than half the bar, and
       * an absolutely centred mark would sit on top of "Setup".
       */}
      <div className="mx-auto flex w-full max-w-xl items-center gap-1 p-2">
        <div className="flex items-center gap-1">
          {prefix
            ? LINKS.map(({ suffix, label }) => {
                const href = `${prefix}${suffix}`
                return (
                  <Link
                    key={suffix}
                    href={href}
                    aria-current={pathname === href ? 'page' : undefined}
                    className={`rounded-lg px-2.5 py-2 text-sm transition-colors sm:px-3 ${
                      pathname === href
                        ? 'bg-accent font-medium text-accent-foreground'
                        : 'text-muted hover:bg-surface-muted hover:text-foreground'
                    }`}
                  >
                    {label}
                  </Link>
                )
              })
            : null}
        </div>

        {/* `min-w-0` lets this column give way before the links do when space runs out;
            `shrink-0` on the mark keeps it from being squeezed narrower than itself. */}
        <div className="flex min-w-0 flex-1 justify-center">
          {/* The mark goes to the chooser, not to `/`. `/` routes an owner with one league
              straight back to their composer, so pointing here would make the mark a
              no-op from inside that league — and would leave a creator with one league
              no way to reach the create form. `/leagues` always renders. */}
          <Link href="/leagues" className="shrink-0 px-1" aria-label="FPheLp">
            {/* `h-auto` is required with the CSS width override, or next/image keeps the
                intrinsic height attribute and the mark is squashed. */}
            <Logo width={68} className="h-auto w-14 sm:w-[68px]" />
          </Link>
        </div>

        <div className="flex shrink-0 items-center justify-end">
          {who ? (
            <form action={signOutAction} className="flex items-center gap-2">
              {/* Hidden on narrow screens: the phone is the primary device, and the centre
                  column has to stay centred rather than be pushed off by an address. */}
              <span className="hidden max-w-[16ch] truncate text-xs text-muted sm:inline">
                {who}
              </span>
              <SignOutButton />
            </form>
          ) : null}
        </div>
      </div>
    </nav>
  )
}
