import { AuthError } from 'next-auth'
import { redirect } from 'next/navigation'

import { auth, signIn } from '@/auth'
import { Logo } from '@/components/logo'

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
    <div role="alert" className="rounded-lg bg-danger-surface p-3 text-sm text-danger">
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
      <div className="flex flex-col items-start gap-3">
        {/* The wordmark instead of a text heading — this is the app's first screen. */}
        <Logo width={200} priority />
        <p className="text-sm text-muted">Sign in with your email — no password.</p>
      </div>

      {sent && (
        <p className="rounded-lg bg-success-surface p-3 text-sm text-success">
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
          className="rounded-lg border border-line-strong bg-surface p-3 text-base text-foreground placeholder:text-faint"
        />
        <button
          type="submit"
          className="cursor-pointer rounded-lg bg-accent p-3 text-base font-medium text-accent-foreground transition-opacity hover:opacity-90"
        >
          Email me a link
        </button>
      </form>

      <p className="text-xs text-muted">
        Only league owners can sign in. Ask an existing owner to add you.
      </p>
    </main>
  )
}
