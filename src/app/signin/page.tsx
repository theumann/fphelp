import { AuthError } from 'next-auth'
import { redirect } from 'next/navigation'

import { auth, signIn } from '@/auth'

/**
 * Auth.js sanitises errors before they reach the URL: only its `clientErrors` set
 * survives as-is, and everything else — including `EmailSignInError`, which is what a
 * refusal from the mail provider raises — collapses to `Configuration`.
 *
 * That collapse is the useful part. `Configuration` here means the app never managed to
 * send the email, so the address the owner typed is irrelevant and telling them it might
 * not be an owner sends them to the database to debug a mail problem. Keep the three
 * causes apart, and point the operator at the logs, since on an owner-only tool the
 * person reading this is the person who can fix it.
 */
const MAIL_FAILURE = {
  title: "The sign-in email couldn't be sent",
  detail:
    'This is a server-side problem, not your address — the mail provider refused the ' +
    'request. Check the app logs for the reason; a common one is Resend declining to ' +
    'send to any address but the account owner until a domain is verified.',
}

const SIGNIN_ERRORS: Record<string, { title: string; detail: string }> = {
  // `Configuration` is what a refused send actually produces: `EmailSignInError` is not
  // in Auth.js's client-visible allowlist, so it collapses to this before reaching the
  // URL. The raw name is mapped too, in case a future path surfaces it unsanitised.
  Configuration: MAIL_FAILURE,
  EmailSignInError: MAIL_FAILURE,
  AccessDenied: {
    title: 'That address is not an owner of this league',
    detail:
      'Sign-in is allowlist-based and there is no self-signup. Ask an existing owner to ' +
      'add you.',
  },
  Verification: {
    title: 'That link is no longer valid',
    detail: 'Sign-in links expire shortly and work once. Request a fresh one below.',
  },
}

const UNKNOWN_ERROR = {
  title: "That didn't work",
  detail: 'Request a new link below. If it keeps failing, check the app logs.',
}

function SignInError({ code }: { code: string }) {
  const { title, detail } = SIGNIN_ERRORS[code] ?? UNKNOWN_ERROR
  return (
    <div className="rounded-lg bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-200">
      <p className="font-medium">{title}</p>
      <p className="mt-1">{detail}</p>
    </div>
  )
}

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

      {error && <SignInError code={error} />}

      <form
        action={async (formData: FormData) => {
          'use server'
          /**
           * `pages.error` only covers Auth.js's own HTTP routes. A `signIn` called from a
           * server action throws instead of redirecting, so without this the failure
           * surfaced as an unhandled server-action error and the page never received an
           * `error` code at all.
           *
           * Note `signIn` also signals *success* by throwing — `redirect` raises
           * NEXT_REDIRECT — so only AuthError means something actually went wrong, and
           * everything else must be rethrown untouched.
           *
           * Which failures reach this catch is not obvious, and was established by
           * testing rather than from the docs: an allowlist rejection throws and is
           * handled here, but a mail-provider refusal is dealt with inside Auth.js, which
           * redirects to `pages.error` itself with the code already sanitised. So both
           * paths are live and the page must read codes from either.
           */
          try {
            await signIn('resend', {
              email: String(formData.get('email') ?? ''),
              redirectTo: '/send',
            })
          } catch (err) {
            if (err instanceof AuthError) redirect(`/signin?error=${err.type}`)
            throw err
          }
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
