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
    'This is a server-side problem, not your address. The mail provider refused the ' +
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
  /**
   * Names the likely cause rather than only the rule.
   *
   * "Links work once and expire" is true and sends the reader hunting for the wrong
   * explanation — they assume they were slow. In practice the common cause is a link
   * forwarded through a chat app, whose preview fetcher opens the URL to build a card and
   * spends the single-use token seconds before the person taps it. That happened three
   * times in production on 2026-08-17 before the HTTP logs named WhatsApp.
   *
   * This page is read *after* it has gone wrong, so it is the one place where saying so
   * converts a dead end into an instruction.
   */
  Verification: {
    title: 'That link is no longer valid',
    detail:
      'Sign-in links work once and expire quickly. If you forwarded it through WhatsApp ' +
      'or iMessage, the preview spent it - request a fresh one below and open it on this ' +
      'device.',
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
  searchParams: Promise<{ provider?: string; error?: string }>
}) {
  const { provider, error } = await searchParams
  const session = await auth()
  if (session?.user) redirect('/send')

  /**
   * Auth.js redirects here after mailing the link, with `?provider=resend&type=email`.
   *
   * Keyed on its parameter rather than one of ours because `pages.verifyRequest` cannot
   * carry a query string — see the note in `src/auth.ts`. The consequence of getting this
   * wrong is mild and worth knowing: the page renders without the confirmation, so the
   * owner is left unsure whether the email was sent.
   */
  const sent = Boolean(provider) && !error

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <div className="flex flex-col items-center gap-3 text-center">
        {/* The wordmark instead of a text heading — this is the app's first screen. */}
        <Logo width={200} priority />
        <p className="text-sm text-muted">Sign in with your email - no password.</p>
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
          /**
           * `redirect: false` sends the email and hands back the URL instead of
           * navigating, so we can go straight to this page rather than through Auth.js's
           * `/api/auth/verify-request`.
           *
           * That hop used to work by accident. `signIn` finishes with Next's `redirect()`
           * pointed at `${AUTH_URL}/api/auth/verify-request`, and while `AUTH_URL` named a
           * different origin than the browser was on, Next made it a hard navigation and
           * the browser followed the 302 to this page. Pointing `AUTH_URL` at the same
           * origin turned it into a client-side navigation to a Route Handler, which is
           * not a page — so it parked there and the owner never saw the confirmation.
           *
           * Skipping the hop removes the dependency on which of those two Next chooses.
           */
          try {
            await signIn('resend', {
              email: String(formData.get('email') ?? ''),
              redirectTo: '/send',
              redirect: false,
            })
          } catch (err) {
            if (err instanceof AuthError) redirect(`/signin?error=${err.type}`)
            throw err
          }

          // Outside the try: `redirect` signals by throwing, so calling it inside would be
          // caught by the handler above and rethrown as an unexplained failure.
          redirect('/signin?provider=resend')
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
