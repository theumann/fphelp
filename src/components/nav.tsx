'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useFormStatus } from 'react-dom'

import { signOutAction } from '@/app/auth-actions'
import { Logo } from '@/components/logo'

const LINKS = [
  { href: '/send', label: 'Compose' },
  { href: '/dues', label: 'Dues' },
  { href: '/setup', label: 'Setup' },
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
 * `who` is the signed-in owner's email, resolved in the layout and passed down — this
 * is a client component for `usePathname`, so it cannot read the session itself.
 *
 * Showing who is signed in is not decoration. Co-owners may share a device, and the
 * digest is signed by whoever sends it, so "which owner am I right now" changes the
 * output of the app rather than just the greeting.
 */
export function Nav({ who }: { who?: string | null }) {
  const pathname = usePathname()

  // Hidden on the sign-in page and the landing page, where there is nowhere to go yet.
  if (pathname === '/signin' || pathname === '/') return null

  return (
    <nav className="border-b border-line bg-surface">
      {/**
       * Three columns rather than a flex row: `1fr auto 1fr` centres the mark against the
       * bar itself, not against whatever the two sides happen to weigh, so the logo does
       * not drift as the signed-in address changes length or a link becomes active.
       */}
      <div className="mx-auto grid w-full max-w-xl grid-cols-[1fr_auto_1fr] items-center gap-1 p-2">
        <div className="flex items-center gap-1">
          {LINKS.map(({ href, label }) => (
            <Link
              key={href}
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
          ))}
        </div>

        <Link href="/send" className="justify-self-center px-1" aria-label="FPheLp">
          {/* `h-auto` is required with the CSS width override, or next/image keeps the
              intrinsic height attribute and the mark is squashed. */}
          <Logo width={68} className="h-auto w-14 sm:w-[68px]" />
        </Link>

        <div className="flex items-center justify-end">
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
