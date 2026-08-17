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
      <div className="mx-auto flex w-full max-w-xl items-center gap-1 p-2">
        {/* Hidden on narrow screens: on a phone the three destinations matter more than
            the mark, and the app is only ever reached by someone who knows what it is. */}
        <Link href="/send" className="mr-1 hidden shrink-0 sm:block" aria-label="FPheLp">
          <Logo width={72} />
        </Link>

        {LINKS.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            aria-current={pathname === href ? 'page' : undefined}
            className={`rounded-lg px-3 py-2 text-sm transition-colors ${
              pathname === href
                ? 'bg-accent font-medium text-accent-foreground'
                : 'text-muted hover:bg-surface-muted hover:text-foreground'
            }`}
          >
            {label}
          </Link>
        ))}

        {who ? (
          <form action={signOutAction} className="ml-auto flex items-center gap-2">
            {/* Hidden on narrow screens: the phone is the primary device and the nav
                links must not wrap to make room for an address. */}
            <span className="hidden max-w-[16ch] truncate text-xs text-muted sm:inline">
              {who}
            </span>
            <SignOutButton />
          </form>
        ) : null}
      </div>
    </nav>
  )
}
