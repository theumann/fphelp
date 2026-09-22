# Security

What this app defends, what it deliberately does not, and what would change those answers.

Kept separate from [ROADMAP.md](./ROADMAP.md) because most of it is *decisions not to build
something* — a roadmap says what is coming, and "user enumeration is an accepted trade"
never arrives. Mechanisms are not repeated here: **Gotchas** in [CLAUDE.md](./CLAUDE.md)
and [ARCHITECTURE.md](./ARCHITECTURE.md) hold those, and this file links to them.

Last reviewed **2026-09-22**, when the source was prepared for publication.

> **No real league's data belongs in this repository, and none is here.**
> `src/lib/fpl/recorded/*.json` are real FPL API responses with the identities substituted:
> names, team names, entry IDs, the league's ID and name, and the uploaded-badge URLs are
> invented, while every key, type, null and pagination envelope is the API's own. The
> substitution runs inside `npm run fpl:record` rather than beside it — see
> `src/lib/fpl/anonymise.ts` — because a separate step is one somebody forgets once, and
> the forgetting is only visible after the commit.
>
> This replaces an earlier note saying the repository had to stay private *because* those
> payloads held seventeen real managers' names. They did. The warning was also incomplete:
> the names had spread to the hand-authored fixtures, three test files and one shipped
> component, and the least obvious identifier of all was `club_badge_src`, documented as
> "null for every manager" and in fact a real, fetchable image URL for six of them. If you
> add a fixture, assume the same: the identifier you miss is the one that does not look
> like an identifier.

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
  than shut. **No longer merely accepted: moving them to Postgres is planned work** (see
  ROADMAP.md). Publishing the source does not make this exploitable — the thresholds were
  always discoverable by probing, and one container still counts correctly — but an
  accepted risk that is now also publicly documented reads better as a to-do than as a
  shrug. **Revisit immediately if** the app is ever run with more than one instance.
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

## Does publishing the source change any of this?

Reviewed line by line on 2026-09-22, with the code public and the app live. **Nothing above
moves from acceptable to unacceptable**, for one reason that applies to most of it: every
accepted item was already observable from outside. The sign-in form tells any visitor
whether an address is an owner; the absence of a CSP is visible in the response headers;
the rate limits' thresholds are findable by probing in minutes. Publishing saves an
attacker reading time, not work they could not otherwise do.

What publishing genuinely changes is the **shape of a mistake**, not the threat model. A
secret committed by accident is now disclosed the moment it is pushed rather than at some
later decision to open the repo, and a fixture added carelessly publishes whoever is in it.
That is why the anonymiser runs inside the recording step and why the blockquote at the top
of this file is written as a rule about fixtures rather than a rule about repository
visibility.

## Reporting

There is no bug bounty, and no formal disclosure process. Mail the address on the landing
page (`SUPPORT_EMAIL`, currently a forwarding alias) and it reaches the one person who can
fix it. There is no SLA, and no expectation that a report gets a same-day answer: this is a
side project serving a handful of fantasy football leagues, run by one person.

If you have found something that discloses another person's data, say so in the first line
and it will be prioritised over anything else here.
