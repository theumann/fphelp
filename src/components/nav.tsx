'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const LINKS = [
  { href: '/send', label: 'Compose' },
  { href: '/dues', label: 'Dues' },
  { href: '/setup', label: 'Setup' },
]

export function Nav() {
  const pathname = usePathname()

  // Hidden on the sign-in page, where there is nowhere to navigate to yet.
  if (pathname === '/signin' || pathname === '/') return null

  return (
    <nav className="border-b border-neutral-200 dark:border-neutral-800">
      <div className="mx-auto flex w-full max-w-xl gap-1 p-2">
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
      </div>
    </nav>
  )
}
