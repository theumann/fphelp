import { AuthError } from 'next-auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { auth, signIn } from '@/auth'
import { Logo } from '@/components/logo'
import { rateLimit, SIGNIN_PER_EMAIL, SIGNIN_PER_IP } from '@/lib/rate-limit'

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

/**
 * The "or write to a human" half of the refusal, appended only when there is a human.
 *
 * An environment variable rather than a literal, for two reasons. It is rendered to
 * anyone who reaches the sign-in page, so it wants to be an address chosen for that —
 * changeable without a deploy, and not necessarily the same one in local development as
 * in production. And a repo should not carry a personal address that ends up scraped off
 * a public page.
 *
 * Unset means the sentence simply does not appear, which is the right default: promising
 * a reply nobody is reading is worse than not offering one.
 */
function contactSentence(): string {
  const contact = process.env.SUPPORT_EMAIL?.trim()
  return contact ? ` Still stuck? Write to ${contact}.` : ''
}

/**
 * Built per render rather than held as a module constant, so `SUPPORT_EMAIL` is read at
 * request time. A constant would capture whatever the variable was when the module first
 * loaded — on Railway that is the build, where a runtime-only variable is simply absent,
 * and the contact line would vanish for reasons nobody could see from the page.
 */
function signInErrors(): Record<string, { title: string; detail: string }> {
  return {
    // `Configuration` is what a refused send actually produces: `EmailSignInError` is not
    // in Auth.js's client-visible allowlist, so it collapses to this before reaching the
    // URL. The raw name is mapped too, in case a future path surfaces it unsanitised.
    Configuration: MAIL_FAILURE,
    EmailSignInError: MAIL_FAILURE,
    /**
     * Deliberately says nothing about a league.
     *
     * It used to read "not an owner of *this* league", which was true when a deployment
     * served exactly one. It is now wrong twice over: the allowlist is `users`, which is
     * global and says nothing about leagues, and someone can legitimately be on it with no
     * league at all — that is exactly what `add-owner.mts --invite` produces for a person
     * who is about to create their own. Naming a league here would send a reader looking
     * for the wrong fix.
     *
     * Two populations land here — someone typing an address speculatively, and someone who
     * should have access but was added under a different address. Only the second can act,
     * which is what the one instruction and the optional contact line are for. Kept to a
     * sentence deliberately: this is read by someone already stuck, and the longer version
     * explaining the allowlist was answering a question nobody in that position is asking.
     */
    AccessDenied: {
      title: "That address doesn't have access",
      detail:
        'If you administer a league here, ask a co-owner to add your email address from ' +
        'their Setup page.' + contactSentence(),
    },
    /**
     * Not "you have been blocked". The overwhelmingly likely reader is an owner whose
     * first link was eaten by a chat app's preview and who pressed the button a few more
     * times — telling them they are rate limited invites a support message, where telling
     * them to check their inbox and wait resolves it.
     */
    RateLimited: {
      title: 'Too many sign-in requests',
      detail:
        'Several links have already been sent to that address. Check your inbox — including spam — and try again in a few minutes.' +
        contactSentence(),
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
}

const UNKNOWN_ERROR = {
  title: "That didn't work",
  detail: 'Request a new link below. If it keeps failing, check the app logs.',
}

function SignInError({ code }: { code: string }) {
  const { title, detail } = signInErrors()[code] ?? UNKNOWN_ERROR
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
          const email = String(formData.get('email') ?? '')
            .trim()
            .toLowerCase()

          /**
           * Rate limited **before** `signIn`, and deliberately before the allowlist too.
           *
           * The allowlist callback refuses unknown addresses before any mail is sent, so
           * limiting only after it would mean a rate-limit response could only ever be
           * produced by a real owner's address — a second enumeration oracle on a page
           * that already leaks enough. Applying it to every submission, known or not,
           * leaks nothing new.
           *
           * The address is lower-cased for the key so `Owner@` and `owner@` share a
           * bucket rather than being two free windows.
           *
           * The key is `signin:form:`, distinct from the `signin:send:` one the provider
           * uses. Sharing a key would count every form submission twice — here and again
           * in `sendVerificationRequest` — halving the limit for the only people who use
           * the form, which is everyone legitimate.
           *
           * This is the message; `sendVerificationRequest` in `src/auth.ts` is the
           * guarantee. A Server Action is not the only door — Auth.js's own
           * `/api/auth/signin/resend` accepts a POST — so a check here alone would be
           * bypassable by anyone who read the network tab.
           */
          const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'

          const byEmail = rateLimit(`signin:form:${email}`, SIGNIN_PER_EMAIL)
          const byIp = rateLimit(`signin:ip:${ip}`, SIGNIN_PER_IP)

          if (!byEmail.allowed || !byIp.allowed) {
            redirect('/signin?error=RateLimited')
          }

          try {
            await signIn('resend', {
              email,
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
