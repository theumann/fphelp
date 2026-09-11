# Security

What this app defends, what it deliberately does not, and what would change those answers.

Kept separate from [ROADMAP.md](./ROADMAP.md) because most of it is *decisions not to build
something* — a roadmap says what is coming, and "user enumeration is an accepted trade"
never arrives. Mechanisms are not repeated here: **Gotchas** in [CLAUDE.md](./CLAUDE.md)
and [ARCHITECTURE.md](./ARCHITECTURE.md) hold those, and this file links to them.

Last reviewed **2026-09-11**, before the app was linked publicly for the first time.

> **The repository must stay private.** `src/lib/fpl/recorded/*.json` holds real managers'
> names from a real league. That is a data disclosure the moment the repo is public, and it
> is unrelated to anything else in this file.

## What the app is, which decides what matters

Owner-only. A league's **members never log in** and have no account — they receive a
WhatsApp message or an email. So there is no user-content surface, no uploads, no public
profile, and nothing an ordinary member can submit. The population who can reach anything
is small, hand-picked, and known.

That shapes everything below: the realistic threats are **abuse of the one public form**
and **one owner reaching another owner's league**, not the usual web application list.

## Enforced

- **Sign-in is allowlisted.** Only an address already in `users` can receive a magic link.
  The quiet second job: **no mail is ever sent to an address nobody approved**, which is
  what stops the app being used as an open relay.
- **Authorization is re-checked server-side on every Server Action.** Guarding the page
  that calls them is not enough — they are public endpoints. Every action re-derives the
  session and calls `assertOwner`/`requireOwner` for the league it writes to.
- **A league URL grants nothing.** `requireLeagueAccess` resolves read-only; an unknown ID
  is a 404, a real league you do not own is a refusal.
- **League creation is gated** on `users.can_create_leagues`, granted only by a script that
  needs production shell access, so the allowlist cannot go transitive.
- **Sign-in is rate limited** in two places with two keys — the form for the message, the
  provider because a POST straight at `/api/auth/signin/resend` never touches the form.
- **Operator endpoints are token-guarded** (`JOBS_TOKEN`), fail closed on an unset token,
  and compare with a timing-safe equality over hashed values.
- **Email HTML is rendered server-side** from stored data, never accepted from the browser,
  and every attacker-influenceable string is escaped — manager and league names come from
  the FPL API and are outside our control.
- **Security headers** on every response: HSTS, `X-Frame-Options: DENY`, `nosniff`,
  `Referrer-Policy`, `Permissions-Policy`. See `next.config.ts`.

## Accepted, with reasons

These are known and deliberately not fixed. Each says what would change the answer.

- **The sign-in form reveals whether an address is an owner.** An allowlisted address gets
  "check your email"; anything else gets "that address doesn't have access". That wording
  exists to help the owner who was added under a mistyped address — the alternative is a
  uniform "check your email" that strands them. **Revisit if** the owner population stops
  being people you know personally.
- **Rate-limit counters are in memory**, which assumes one container. Scale past one and
  each instance counts separately, multiplying the effective limit — it fails open rather
  than shut. **Revisit if** the app is ever run with more than one instance.
- **No Content-Security-Policy.** Reasoning in `next.config.ts`: the injection surface is
  close to nil, and a useful policy needs a nonce threaded through middleware while a lazy
  one would be decoration. **Revisit if** the app ever renders HTML it did not author.
- **Ownership of a league is unproven.** Creating a league is first-claim-wins against a
  unique `fpl_league_id`; nothing checks the claimant is that league's `admin_entry` on
  FPL's side, so a squatter could block the real admin. Tolerable **only** because the set
  of people who can create anything is people the operator vouched for by hand. **Revisit
  before** creation is opened up — which is what the ROADMAP's request-access form is.
- **`role` grants nothing.** Every owner can do everything, including send to the group.
  Fine among co-owners who chose each other. **Revisit when** leagues have unrelated
  co-owners; the first restriction worth making is stopping a treasurer sending.
- **Nothing prunes `sessions` or `verification_tokens`.** Both are read on the auth path
  and grow without bound. Negligible at this volume. **Revisit when** sign-ups are more
  than occasional.

## Operational notes

- `/api/egress-check` is **token-guarded**. It was open until 2026-09-07; an open version
  discloses the egress IP and lets a stranger make the server fire four FPL requests per
  call — a lever on the reputation that decides whether the app works at all.
  Call it with `-H "authorization: Bearer $JOBS_TOKEN"`.
- **A blocked app is only detectable through the cron.** Every page fails, the service
  still reports healthy, and the build is green throughout. If the cron is ever made
  resilient to an FPL block, something else has to notice. See ARCHITECTURE.md
  "Egress and Cloudflare".

## Reporting

There is no bug-bounty and no security contact beyond the address on the landing page. If
something here is wrong, it is wrong in a private repository serving a handful of fantasy
football leagues — mail the operator and it will be read by the person who can fix it.
