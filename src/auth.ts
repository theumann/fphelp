import { DrizzleAdapter } from '@auth/drizzle-adapter'
import NextAuth from 'next-auth'
import Resend from 'next-auth/providers/resend'

import { db } from '@/db'
import { accounts, sessions, users, verificationTokens } from '@/db/schema'
import { rateLimit, SIGNIN_PER_EMAIL } from '@/lib/rate-limit'
import { renderSignInEmail } from '@/lib/render/signin-email'

/**
 * Magic-link auth. Single owner plus co-owners, so there are no passwords to reset and
 * no social providers to maintain — and the emailed link doubles as the way into the
 * send page.
 *
 * Access is allowlist-based: only addresses already present in `users` may sign in.
 * Without that, anyone who knows the URL could request a link and get an account, since
 * magic link has no other barrier to entry. Co-owners are added deliberately, not by
 * self-signup.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: 'database' },
  /**
   * All three point at the one page, which shows the right thing for the state it is in.
   *
   * None of them may carry a query string. Auth.js appends its own parameters with a `?`
   * unconditionally — `@auth/core` builds the verify-request redirect as
   * `${baseUrl}/verify-request?provider=…&type=…`, and the handler for that route then
   * forwards to whatever `verifyRequest` names, appending the same pair again. Give it
   * `/signin?sent=1` and the result is `/signin?sent=1?provider=resend&type=email`: two
   * `?` in one URL, with `sent` parsing as the string `1?provider=resend`. It happened to
   * work only because the page tested that value for truthiness rather than for `1`.
   *
   * So the page reads `provider`, which Auth.js always supplies, instead of a flag we
   * cannot attach.
   */
  pages: {
    signIn: '/signin',
    verifyRequest: '/signin',
    error: '/signin',
  },
  providers: [
    Resend({
      apiKey: process.env.AUTH_RESEND_KEY,
      from: process.env.AUTH_EMAIL_FROM ?? 'onboarding@resend.dev',
      /**
       * Without a Resend key the link is logged to the server console instead. That
       * keeps local development working before a domain is verified — and it is gated
       * on NODE_ENV so a missing production key fails loudly rather than silently
       * printing sign-in links into logs.
       */
      async sendVerificationRequest(params) {
        /**
         * The backstop, and the only check that actually holds.
         *
         * `/signin` limits before calling `signIn`, which is where the readable message
         * comes from — but a Server Action is not the only door. Auth.js publishes
         * `/api/auth/signin/resend`, which accepts a POST directly, so a check that lived
         * only in the form would be bypassed by anyone who opened the network tab.
         *
         * Here it is unavoidable: every magic link, from every entry path, is sent from
         * this function. Refusing throws, which Auth.js turns into an error redirect —
         * the message is less precise than the one `/signin` produces, and that is the
         * correct trade for a path only an attacker takes.
         *
         * **A different key from `/signin`'s, deliberately.** Sharing one would make the
         * form path count every attempt twice — once in the action, once here — so a
         * legitimate owner would burn two of their five, while someone posting straight to
         * the API burned one. Two keys means each path counts each attempt once, both
         * stop at five, and the limits mean the same thing whichever door was used.
         */
        const { allowed } = rateLimit(
          `signin:send:${params.identifier.trim().toLowerCase()}`,
          SIGNIN_PER_EMAIL,
        )
        if (!allowed) {
          throw new Error(`Rate limited: too many sign-in emails for ${params.identifier}`)
        }

        if (!process.env.AUTH_RESEND_KEY) {
          if (process.env.NODE_ENV === 'production') {
            throw new Error('AUTH_RESEND_KEY is not set; cannot send sign-in emails.')
          }
          console.log(`\n[auth] Sign-in link for ${params.identifier}:\n${params.url}\n`)
          return
        }

        const email = renderSignInEmail(params.url)

        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.AUTH_RESEND_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: params.provider.from,
            to: params.identifier,
            subject: email.subject,
            html: email.html,
            // Sent alongside the HTML, never instead of it: an HTML-only email scores as
            // spam, and a sign-in link in the spam folder is indistinguishable from broken
            // auth to the person waiting for it.
            text: email.text,
          }),
        })

        if (!res.ok) {
          throw new Error(`Resend refused the sign-in email: ${await res.text()}`)
        }
      },
    }),
  ],
  callbacks: {
    /** Allowlist: the address must already exist in `users`. */
    async signIn({ user }) {
      if (!user.email) return false
      const existing = await db.query.users.findFirst({
        where: (u, { eq }) => eq(u.email, user.email!),
      })
      return Boolean(existing)
    },
    session({ session, user }) {
      if (session.user) session.user.id = user.id
      return session
    },
  },
})
