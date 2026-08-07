import { redirect } from 'next/navigation'

import { auth, signIn } from '@/auth'

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>
}) {
  const { sent, error } = await searchParams
  const session = await auth()
  if (session?.user) redirect('/send')

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">FPheLp</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Sign in with your email — no password.
        </p>
      </div>

      {sent && (
        <p className="rounded-lg bg-green-50 p-3 text-sm text-green-900 dark:bg-green-950 dark:text-green-200">
          Check your email for a sign-in link.
        </p>
      )}

      {error && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-200">
          That didn&apos;t work. The link may have expired or already been used, or the
          address may not be an owner of this league.
        </p>
      )}

      <form
        action={async (formData: FormData) => {
          'use server'
          await signIn('resend', {
            email: String(formData.get('email') ?? ''),
            redirectTo: '/send',
          })
        }}
        className="flex flex-col gap-3"
      >
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className="rounded-lg border border-neutral-300 p-3 text-base dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="submit"
          className="rounded-lg bg-neutral-900 p-3 text-base font-medium text-white dark:bg-white dark:text-neutral-900"
        >
          Email me a link
        </button>
      </form>

      <p className="text-xs text-neutral-500">
        Only league owners can sign in. Ask an existing owner to add you.
      </p>
    </main>
  )
}
