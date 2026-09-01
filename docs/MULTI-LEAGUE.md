# Multi-league: plan and open questions

Written 2026-08-31, before any code. This is the implementation plan for
[ROADMAP.md](../ROADMAP.md) **Phase 5**, which states the blockers; this states the order to
fix them in and the decisions taken.

**Note where this departs from the ROADMAP.** Phase 5 there assumes self-signup ("this
becomes signup plus per-league invites"). Phase C below decides against it: the allowlist
stays, owners are invited by hand, and they create their own leagues. That removes rate
limiting, mail-relay exposure and session pruning from the critical path. Where the two
documents disagree, this one is later.

The goal is one deployment serving many leagues, each with its own owners, so that:

1. **The app can be tested in production at all.** Today it cannot. `FPL_LEAGUE_ID` is
   deployment-level, so one deployment serves exactly one league — there is nowhere to put
   a throwaway league. The only way to sign in to production now is to become an owner of
   the *real* league, where a mis-tap sends a message to eighteen actual people. That is
   not a testing posture, and it is why this work is not purely a growth feature.
2. **Other league managers can be invited.** Which is the growth feature, and the harder
   half, because it means self-signup and strangers' data.

## What already works

**The schema is already multi-tenant** and does not need reshaping:

- every table carries `league_id`;
- `league_users` is a real membership table (`league_id`, `user_id`, `role`,
  `manager_entry`), so a user belonging to several leagues is already representable;
- `digests` is unique on `(league_id, gameweek)`, so idempotency is already per-league;
- `leagues.fpl_league_id` is `notNull().unique()`, so one FPL league maps to one row.

The single-league assumption is not in the data. It is in **five call sites**, all doing
the same two lines — resolve the deployment's league ID, then `ensureLeague`:

| File | What it does |
| --- | --- |
| `src/app/send/page.tsx` | composer |
| `src/app/setup/page.tsx` | settings |
| `src/app/dues/page.tsx` | dues |
| `src/app/page.tsx` | landing |
| `src/app/api/jobs/capture-history/route.ts` | the cron |

Plus operational scripts (`bootstrap-owner`, `add-owner`, `clear-test-digest`,
`fpl-snapshot`, `record-fixtures`), which are lower stakes — they can keep taking a league
as an argument.

So this is less a rewrite than replacing one constant with a resolution step. The hard
parts are elsewhere.

## Phases, in dependency order

### A. Resolve the league from membership, not from the environment

Removes `REFERENCE_LEAGUE` from the five call sites. No auth changes, no new users.

**Recommended: a URL segment** — `/l/[leagueId]/send` rather than a "current league" held
in the session. It is shareable and bookmarkable, the back button behaves, two leagues can
be open in two tabs, and the home-screen icon can point at a specific league. A session-held
current league turns every link into a stateful bet about what the user last clicked.

Whatever the shape, the rule is unchanged and load-bearing: **membership is never granted by
visiting a page.** `findMembership` stays read-only, and a non-member gets a refusal. The
predecessor auto-enrolled on first visit, which made loading `/setup` the act that conferred
ownership.

**This phase alone unblocks reason 1.** With league resolution in place, a second league can
be created in production for testing, owned by the same person, with no self-signup and no
strangers involved.

Also needs: something at `/` for a signed-in user with several leagues — a chooser — and a
sensible answer for a user with exactly one, who should probably not see a chooser at all.

### B. Make the cron handle every league

**Must land before phase C, not after.** The moment a stranger creates a league, its history
starts accruing — and `entry/{id}/history` cannot be backfilled for managers who leave. A
new league whose capture never runs loses that permanently and silently, which is the exact
loss the job exists to prevent.

The scaling problem is real: capture is roughly `18 + 3` sequential FPL calls per league,
against an API fronted by Cloudflare that already blocks datacenter IPs on reputation. One
league is a burst of ~20. Ten leagues is ~200 in one run from one egress IP.

Open questions for this phase:

- iterate leagues within one run, or one cron firing per league?
- a per-run budget, so a slow FPL does not produce an unbounded run?
- does `FplBlockedError` abort everything, or just that league? (Today it aborts and reports
  `savedBeforeBlock`. With many leagues, aborting all of them because league 7 tripped a
  block is probably right — the block is per-IP, not per-league — but it should be a
  decision, not an accident.)
- the Sentry cron monitor currently reports one check-in for one league. Decide what
  "healthy" means when one league of ten fails.

The wider consequence, from ROADMAP Phase 5: at this volume **the egress-proxy mitigation
stops being "on the books" and becomes real work**, and the poll gate stops being an
optimisation — it becomes the thing keeping the app unblocked.

### C. Invited owners create their own leagues

**Decided 2026-08-31: keep the allowlist. Do not build self-signup.**

The instinct is that inviting other league managers requires opening sign-up. It does not,
and the cheaper shape is better in more ways than it first looks. Onboarding splits in two,
and only one half is manual:

- **The operator vouches for a person** — their email is added to `users`, exactly as
  co-owners are added today. One field. This is the only manual step.
- **They create their own league** — sign in, land on "you have no leagues yet", paste
  their FPL league ID, and the app validates it against `leagues-classic/{id}/standings/`
  and echoes the league name back before committing. They know their own league ID; the
  operator should not have to ask for it, retype it, or tell an invite code apart from an
  ID on someone else's behalf.

So phase C is **a create-league flow plus a way to add an email**, not an auth rewrite. The
owners list in `/setup` already does nearly the second thing for co-owners.

**What keeping the allowlist buys, and why it is the main argument.** The allowlist is
quietly doing a second job nobody designed it for: it rejects unknown addresses *before* any
email is sent, which is what stops this app being used as an open mail relay — anyone could
otherwise POST arbitrary addresses at the sign-in form and have Resend deliver to them, on
our domain and our sending reputation. Keeping it means three pieces of dangerous work
simply do not happen yet:

- **no rate limiting** to build, because strangers cannot trigger an email at all;
- **no relay exposure** to reason about;
- **`sessions` / `verification_tokens` pruning stays a "someday"** rather than a
  prerequisite, because the row count stays proportional to people you invited by hand.

Those were the riskiest items in this plan, and all three fail silently when done wrong.

It also makes the ownership question below **tolerable without solving it**: an invited
person could still claim a league they do not run, but they are someone the operator
vouched for personally, which makes first-claim-wins a defensible position rather than an
open door.

**When to revisit.** The moment invitations stop being personal — a public sign-up link, or
enough demand that vouching by hand is the bottleneck. At that point rate limiting, pruning
and real ownership verification all come due together, and none of them is optional.

Still needed regardless: a decision about what a signed-in user with no leagues sees, and
what happens when someone pastes a league ID that is already claimed.

#### Deferred with this decision

Recorded so they are not lost, since they were prerequisites under the self-signup plan and
are merely sensible under this one:

- **Rate limiting on the sign-in form.** Required the day the allowlist goes.
- **`cron-prune-sessions`.** Auth.js deletes an expired session only when its token is next
  presented, so the rows that survive are exactly the abandoned ones. A weekly
  `delete … where expires < now()` on both tables covers it — its own service, so a
  housekeeping failure does not turn the capture job red and send you to debug the wrong
  thing.

## The open question: how do you prove someone runs FPL league X?

**Answered for now by phase C's decision: you do not.** Invitations are personal, so
first-claim-wins is acceptable and this question is deferred rather than solved. The rest of
this section is kept because the answer changes the day sign-up opens, and the groundwork is
worth knowing before then.

There is no authentication against FPL. Nothing inherently stops someone claiming a league
they do not manage — and the cost is not hypothetical: a squatter would block the real
manager (`fpl_league_id` is unique), and would see that league's pot and prize configuration.

What we have to work with:

- `leagues-classic/{id}/standings/` returns **`admin_entry`**, the FPL entry that
  administers the league. So "is this entry the admin?" is answerable.
- `league_users.manager_entry` already exists — the owner's own FPL entry, currently
  optional and used only to sign messages.

Which reduces the problem to: **prove this user owns that FPL entry.** Options, none free:

1. **First claim wins, no verification.** Cheapest. Acceptable while invitations are
   personal and manual; indefensible once anyone can sign up.
2. **Prove entry ownership by a temporary rename.** Ask the claimant to set their team name
   to a one-time token, then read it back from the API. Genuine proof, and awkward.
3. **Invite-only, no self-signup.** An existing owner adds a manager by email, as
   `/setup` already does for co-owners. Sidesteps the problem entirely and matches how the
   first users will actually arrive — by you inviting them.

Option 3 is worth serious consideration as the *first* shipped version: it satisfies reason 2
for the near term without ever solving the hard problem, and it defers option 2's cost until
there is evidence anyone wants self-signup.

## Things that will bite

- **`AUTH_EMAIL_FROM` has no fallback for digests.** One sender address across many leagues
  means every league's digest arrives from the same domain. Fine, but it should be a
  decision — and per-league sender addresses would need per-league domain verification in
  Resend.
- **`hide_recipients` (cc/bcc) is per-league already** — good — but the "cannot be batched
  above 50" rule now applies per league rather than once.
- **The e2e suite truncates every table and refuses any database not named `fphelp_e2e`.**
  Multi-league fixtures will need more than one league, and `FPL_FIXTURES` currently answers
  for a single league ID.
- **`src/lib/fpl/fixtures.ts` hardcodes `FIXTURE_LEAGUE_ID = 9999999`**, and
  `recorded/*.json` is one real league's payloads. Recorded fixtures stay single-league;
  that is fine, but the fixture *fetch* needs to answer for more than one ID.
- **`role` grants nothing today.** Multi-league with strangers is the point at which
  "every owner can do everything, including send" stops being obviously safe.
- **Operational scripts assume the reference league.** They can take an argument, but
  `clear-test-digest` in particular becomes more dangerous when it could name someone
  else's league.

## What not to do

- **Do not reshape the schema.** It is already right. Resist the urge to add a `tenant`
  concept on top of `leagues`.
- **Do not remove the allowlist.** Decided in phase C. It is the only thing preventing
  arbitrary account creation, and it is also what keeps the app from being an open mail
  relay. Removing it is a separate, larger project that starts with rate limiting.
- **Do not build self-signup** because it feels like the "real" version. Inviting people
  by hand is the feature, not a placeholder for one.
- **Do not invite anyone before phase B.** Their history would start being lost immediately,
  and unlike most bugs this one is not repairable after the fact.
