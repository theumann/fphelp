'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useFormStatus } from 'react-dom'

import { signOutAction } from '@/app/auth-actions'

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
      className="rounded-lg px-3 py-2 text-sm text-neutral-600 disabled:opacity-50 dark:text-neutral-400"
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
    <nav className="border-b border-neutral-200 dark:border-neutral-800">
      <div className="mx-auto flex w-full max-w-xl items-center gap-1 p-2">
        {LINKS.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={`rounded-lg px-3 py-2 text-sm ${
              pathname === href
                ? 'bg-neutral-900 font-medium text-white dark:bg-white dark:text-neutral-900'
                : 'text-neutral-600 dark:text-neutral-400'
            }`}
          >
            {label}
          </Link>
        ))}

        {who ? (
          <form action={signOutAction} className="ml-auto flex items-center gap-2">
            {/* Hidden on narrow screens: the phone is the primary device and the nav
                links must not wrap to make room for an address. */}
            <span className="hidden max-w-[16ch] truncate text-xs text-neutral-500 sm:inline">
              {who}
            </span>
            <SignOutButton />
          </form>
        ) : null}
      </div>
    </nav>
  )
}
