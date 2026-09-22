# FPheLp — MVP & Roadmap

(Working name, folder/repo name TBD)

## Purpose
Facilitate a private fantasy league owner's communications with their group (WhatsApp/email), by automating standings, results, and money-pot updates instead of manual posting.

Primary actor: **the league's owner(s)** — a league may be administered by more than one person, and both need access. Ordinary league members are recipients of content (digests pushed to channels they already use), not users of a separate app.

Note on terminology: FPL calls a league *participant* a "manager". In this project **manager** always means an FPL entry competing in the league, and **owner/co-owner** means a person with a login here. They overlap but are not the same population.

First target: English Premier League Fantasy (FPL) classic private leagues, via the unofficial-but-first-party FPL API (fantasy.premierleague.com).

---

## Delivery model

The pipeline ends at the owner's thumb, not at a send call. WhatsApp's Cloud API is a dead end for this tool — group sending requires Official Business Account status, and business-initiated 1:1 messages need pre-approved templates plus per-conversation cost.

Instead, v1 uses the **deep-link/share flow**: the owner composes their message in the app, then taps a one-tap link, `whatsapp://send?text=<urlencoded>` (https fallback `https://wa.me/?text=<urlencoded>`). WhatsApp opens a chat picker with the message pre-filled; the owner selects the league group and taps send.

The message itself is **written by the owner from a pre-filled draft**, not generated and sent on their behalf — see "Composing a message" below.

Three constraints follow:

- **The phone number must be omitted.** Supplying one (`wa.me/<number>?text=`) opens that individual chat directly and makes groups unreachable. This is a silent failure — the link still looks like it works.
- **The link must be tapped on the owner's phone**, so delivery cannot complete server-side.
- **Delivery state is `prepared` → optionally `marked sent`**, never "confirmed delivered".

Email remains a supported channel — the same composed message, rendered as HTML — with one important asymmetry:

**Email needs a recipient list; WhatsApp does not.** The FPL API exposes no contact details, only names and team names, and league members never log in. So email requires the owner to hand-enter every member's address and keep that list current as people join or leave. The WhatsApp group already exists and the deep link needs no addresses at all.

Consequences: email is **opt-in per league**, not a default; the recipient list is owner-maintained (`recipients` table, independent of `managers`, since the two will drift); and a league using only WhatsApp never has to touch it. Email is, however, the one channel that can be sent **fully server-side** — no phone tap required — which is why it stays in scope.

## Composing a message

The owner writes their own creative update each week. The app supplies a **pre-filled draft**, not a finished message.

Alongside their own text, the owner ticks which generated blocks to include:

- **Overall standings** — the full league table with rank movement
- **Last gameweek's results** — winner, scores, league average, riser/faller
- **Prize structure** — the rules, optionally with winnings to date

Each checkbox has a **default set at league level** and can be **overridden per message**. What was actually included is stored with the sent message, so history reflects what the league received rather than today's settings.

There is **no fixed send cadence**. The scheduler's job is to have a digest ready, not to send it. An optional per-league notification can prompt the owner when a gameweek finishes; the default is simply that the draft is waiting when they open the app.

## Digest length budget

Because the WhatsApp payload lives in a URL, length is a design constraint rather than a detail. Newlines become `%0A` and table padding is pure cost. Target **~1,500 characters encoded**, with a compact layout and a defined truncation strategy for large leagues.

Since the owner composes the message, this budget is **interactive**: the composer shows a live remaining-character count that updates as text is typed and blocks are toggled. Including the full standings for a 20-manager league can consume most of the budget by itself, so the owner needs to see the cost of each checkbox as they tick it — not discover it at send time.

## MVP Feature Set

**Core loop: fetch → digest → prepare → owner sends**

Each feature is annotated with its data source. "Free" means it needs no call beyond the standings fetch.

### Phase 0 — verify the API
- ✅ **Done 2026-08-03** for `bootstrap-static/` (fully confirmed) and the response envelopes of `event-status/`, `leagues-classic/{id}/standings/`, `entry/{id}/history`
- ⏳ **Blocked until GW1 completes (deadline 2026-08-21)** — `standings.results[]` and `history.current[]` element fields, and the live value of `event-status.leagues`, are all empty pre-season. **See [docs/GW1-VERIFICATION.md](./docs/GW1-VERIFICATION.md)** for the full checklist to run then
- One throwaway `whatsapp://send?text=` link with a realistic full-length digest, tapped on the owner's real phone, to confirm group selection works and nothing is truncated
- One league per deployment, set by `FPL_LEAGUE_ID` (no default; unset is an error). Not yet a setting: `/setup` configures the pot, prize rules and the owner's own team *for* that league, but there is no flow for creating one, so which league a deployment serves stays deployment-level. A bad value throws at startup rather than falling back — serving the wrong league silently is worse than not starting

### Phase 1 — standings digest + deep-link send
- **League setup (one-time)** — owner enters the **numeric** league ID; validate via `leagues-classic/{id}/standings/`. Note the invite code (e.g. `1xrliv`) is *not* the API ID and cannot be resolved to one without authentication — the UI must ask for the number from the league URL and say so
- **Co-owners** — a league can have more than one owner; invite a second owner by email. One shared prepared digest and one shared "sent" state between them, not one each. A `role` (`communicator` / `treasurer`) is recorded but grants nothing yet
- ✅ **Sign out** — in the nav, alongside the signed-in address so it is clear *which* owner is composing. A Server Action rather than a link to `/api/auth/signout`, which renders Auth.js's own unstyled confirmation screen. This is what makes the per-sender signature testable: sign out, sign in as a co-owner, confirm the digest signs differently
- **Owner's own manager ID** — each owner optionally supplies their FPL entry ID, used to sign the digest: `[Manager Name] — [Team Name] Manager and [League Name] Admin`. It belongs to the *owner*, not the league, since co-owners sign differently; the signature is applied at send time by whoever sends, not stored in the shared digest. Optional, since an owner may not play in the league they administer
- **Automated gameweek digest**
  - Triggered when the GW is genuinely final — see "Trigger condition" below, not `finished` alone
  - Content, all free from one standings call (`ClassicLeagueEntry`: `entry`, `entry_name`, `player_name`, `rank`, `last_rank`, `total`, `event_total`):
    - standings table — must follow `has_next` pagination to render every manager
    - rank movement (`last_rank - rank`); biggest riser/faller
    - GW winner (max `event_total`)
    - league average — **computed** as the mean of `event_total` across results
  - Roster completeness: managers in `new_entries[]` do not appear in standings until the next GW is processed, and must still show up
- **Composer** — pre-filled draft the owner edits freely, with per-message checkboxes for the generated blocks (defaults from league settings) and a live character budget
- **Send page (mobile)** — composed message, "Send to WhatsApp" deep link, "Copy text" fallback, optional "Mark as sent". The two channels are **tabs** over one shared piece of prose, with email leading when the league has it on: it is the channel that sends from here, while WhatsApp needs the owner's thumb regardless. Each tab owns the bottom bar's primary action, so email's names its recipient count rather than saying "Send" — it is the one button in the app that cannot be taken back
- **Email digest** — same composed message, HTML. **Opt-in**, and requires the owner to enter a recipient list first (see Delivery model). Deferrable within Phase 1 if WhatsApp lands first
- **History capture starts here** — snapshot `entry/{id}/history` → `current[]` once per GW per manager, even though the stats that use it ship in Phase 4.
  - ✅ **Built** as `POST /api/jobs/capture-history`, guarded by a `JOBS_TOKEN` bearer token. It also upserts `managers`, which is the only record of who was in the league at a given time.
  - It stores **every gameweek `current[]` returns**, not just the latest. That makes a missed run self-healing, and means the backfill question below decides only how much one run recovers — not whether the data is lost.
  - ✅ **Scheduled** via the `cron-capture-history` Railway service running `npm run job:capture` **hourly, Sunday through Wednesday** (`0 * * * 0-3` UTC). Polls are gated on `captureDecision`, so they cost two FPL calls and skip until a gameweek has finished *and* settled; a partial capture is retried by the next poll. This line said "every 40 minutes" until 2026-09-01, describing a `*/40` schedule that was replaced on 2026-08-25 — and that never meant what it said in the first place. See ARCHITECTURE.md "Cron service configuration", which has the arithmetic.
  - ✅ **Exercised against real data** — first real capture 2026-08-25 12:40Z: GW1, 17 rows, `dropped` and `failed` both empty, and the gate correctly withheld it until after bonus settled rather than when `finished` flipped. The mapping has now parsed a real scored gameweek. See [docs/GW1-VERIFICATION.md](./docs/GW1-VERIFICATION.md) §7.
  - ✅ **Answered 2026-09-01, by the GW2 run: `current[]` is cumulative, so a missed poll costs nothing.** The capture returned `{"gameweek":2,"rowsSaved":34,"gameweeksSeen":[1,2],"dropped":[],"failed":[]}` — 17 managers × 2 gameweeks, meaning it re-supplied GW1 alongside GW2 rather than only the latest. The self-healing property the job was designed around is now observed rather than assumed.
    - **It happened to be tested under load.** This run was the recovery from the Cloudflare block of the same day (ARCHITECTURE.md "Egress and Cloudflare"), so the missed window was real, not simulated, and it healed completely on the first successful poll.
    - **The limit, stated honestly:** `[1,2]` at GW2 rules out "latest only", which was the failure mode that mattered. It cannot yet distinguish "the whole season" from "a rolling window of N" for any N ≥ 2. A gap of several gameweeks is what would separate those, and nothing needs to force that test — the next multi-week outage will answer it for free.
  - ⚠️ **Open: a manager whose history never succeeds puts the job in a permanent retry loop.** Completeness is measured as distinct stored entries against roster size — the property that makes a partial capture self-healing. If one manager's `entry/{id}/history` fails *permanently* rather than transiently (a deleted FPL account, an entry that leaves the API while staying in standings), that league never reaches `captured >= roster` and every poll re-captures it: ~20 FPL calls hourly, indefinitely, against an API that blocks on reputation.
    - **Pre-existing, but phase B gave it teeth.** It has always burned the calls; since the multi-league run reports any league error as a failed run, it now also fails the Sentry check-in **every hour** — an alarm that cannot be cleared by fixing anything on our side, which is the kind that teaches people to ignore the monitor.
    - Not yet triggered: `failed` has been empty in every real capture so far. It needs one deleted account to become real, and that is a normal thing for a league to contain eventually.
    - **The fix needs a concept the schema does not have**: a per-manager, per-gameweek "known unobtainable" mark, so the entry stops counting toward the roster target and stops being retried, while staying visibly absent rather than silently dropped. A retry ceiling (give up after N attempts at one gameweek) is the smaller version. Deliberately not bolted on during phase B — guessing at the shape while it is still hypothetical is how the wrong abstraction gets committed.

### Phase 2 — money pot, dues and winnings
- Owner enters the **pot total directly**, plus prize rules, configured once at setup
- **Prize rules** — three kinds cover the reference league:
  - fixed amount to each **gameweek winner**
  - fixed amount to the **season's single highest gameweek score**
  - **percentage to each of the top N** at season end, with **N and each percentage configurable by the owner** at setup. Defaults to 6 places at **40 / 25 / 15 / 10 / 6 / 4**. Validated as contiguous ranks from 1, percentages summing to 100%. Editable mid-season; locked once the ledger is finalised
- **Fixed amounts come off the top, percentages apply to the remainder.** Setup must validate that fixed commitments don't exceed the pot, and that the percentages sum to 100% — see ARCHITECTURE.md. Getting this wrong over-commits the pot and only shows up in May. Re-validate on every pot edit, since managers keep joining
- ✅ **League expenses** — costs paid out of the pot before any prize: trophy engraving is the reference league's case. Arithmetically one more deduction off the top, so `remainder = pot − fixed prizes − expenses`. The four open questions, as decided:
  - **Itemised, in a `league_expenses` table** (label, amount, position), mirroring `prize_rules`. A treasurer wants to name what the money went on, and a single column would subtract it without accounting for it. The label is member-facing, not an internal note — the digest prints it.
  - **Validation counts them.** `validatePrizeConfig` compares `fixed + expenses` against the pot, and `fixed-exceeds-pot` carries `expensesCents` so the message can say which of the two tipped the league over. Expenses are therefore part of `LeagueSettings` and save behind Setup's one Save button, not per-click like the owners and recipients lists: they are a term in the arithmetic that has to be validated as one set.
  - **The digest keeps the pot and shows the deduction** — `Pot  $1,800.00` then `Trophy engraving  -$100.00`, labels left and amounts right. The pot line states what the league collected; without the deduction beside it the prizes below no longer add up to the figure above, and eighteen people can do that subtraction. The amount is negative rather than prefixed with "Less", because the sign survives right-alignment where a prefix pushes the label along. Rejected: printing a bare prize pool, which reconciles but never says what was collected.
  - **An unset pot suppresses the expense lines too**, exactly as it suppresses the pot and the per-place shares. A cost listed under nothing to deduct it from is a subtraction with no subject. Setup still accepts and stores the costs — they can be entered before anyone has counted the money.
- **Winnings ledger** — who won what, accruing per gameweek. GW-winner amounts are final once a GW is scored; rank and best-GW prizes stay *provisional* until the final gameweek
- **Tie handling** — pool the prizes for the tied positions and split evenly (see ARCHITECTURE.md). Detect ties on `rank`, never `rank_sort`
- **Manual override of final positions** at season end — the escape hatch for leagues with their own tie-breaking rules, without modelling any of them

Reference league config (this league): $100 entry × 18+ managers, $15 per gameweek winner, $100 for the season's best gameweek, remainder split across the top 6 at 40 / 25 / 15 / 10 / 6 / 4. At 18 managers that is a $1,800 pot, $670 committed to fixed prizes, $1,130 to the top 6.
- **Dues tracking** — per-manager paid / not paid, for the treasurer
- Entry fee is optional, display-only ("£20 × 18 players") — no longer load-bearing
- Digest includes pot total and this week's winner's prize alongside standings

### Phase 3 — deadline reminders
- Scheduled reminder before each GW deadline (`events[].deadline_time`)

*(The original "manual send now" item is gone — since the owner composes and sends every message themselves, on-demand sending is Phase 1's composer, not a separate feature.)*

### Phase 4 — season narrative stats
- Manager of the month, worst GW ever, longest streak — pure queries over the history captured since Phase 1

### UI/UX pass — carry an owners list into it

Not yet scheduled, but planned before the season settles into routine. Started on Setup,
which is where the one committed feature below lives.

**Landed so far.** Design tokens in `globals.css` (every colour named once, dark mode
defined in one place) and a small set of shared primitives in `src/components/ui.tsx` —
`Card`, `Field`, `Button`, `Alert`. Setup, the nav, sign-in, the composer and the
not-an-owner screen use them; `/dues` does not yet.

The landing page was create-next-app boilerplate until 2026-08-17 — live, at the site root,
telling visitors to edit `page.tsx`. It is now the logo, a sentence and a sign-in link, and
a signed-in owner is redirected to the composer instead. The logo is wired in with a
dark-mode variant (its "he" and tagline are dark indigo and vanished on the dark theme) and
a favicon cropped to the "FP" monogram, since a 3:1 wordmark is unreadable at 32px. Setup also resolved a split that ran through the page: the
settings form batches behind a Save button while the lists write on every click, so the
form now carries a sticky bar that says whether anything is unsaved rather than leaving
the two models to be inferred.

**Setup is now three tabs** — Pot & prizes, Communication, People — because five stacked
sections had become a phone's worth of scrolling between the pot and the recipient list.
The split follows **how the settings save**, not what they are about: the money panel is the
only one with a Save button, and everything in the other two writes on click. One save model
per panel is what stops the sticky bar from appearing to govern sections that ignore it.

Two consequences worth knowing:

- **"Your team" moved to People and now saves on change.** It was under the prize
  arithmetic only because `setManagerEntry` happened to be called inside
  `saveSettingsAction`. It is the one setting on the page belonging to the signed-in owner
  rather than to the league — co-owners each pick their own team and sign differently — so
  it sits with owners, and `setManagerEntryAction` is its own action.
- **Panels stay mounted, hidden rather than unmounted**, and `?tab=` is synced with
  `replaceState`. A server-rendered tab link would unmount the money form and silently
  discard a half-typed pot on a tab switch. Deep links (`/setup?tab=messages`) still work,
  which is how the e2e suite reaches the panels it tests.

One item is already assigned to this pass rather than left to Phase 5:

- ✅ **Add and remove owners from Setup.** Sign-in is allowlist-based, so an owner exists
  only if a `users` row does, and the only ways to create one were the
  `BOOTSTRAP_OWNER_EMAIL` deploy script and editing the database by hand. Neither is
  reachable by the person who actually needs it. A Setup section — add an address, see
  who has access, remove one — replaces both and is what makes the closed membership rule
  workable rather than merely safe. Two removals are refused: the last owner, which would
  leave the league unadministrable with no way back in short of a redeploy, and yourself,
  since a co-owner can do it and then the person losing access is not also the person who
  has to be sure.
- It belongs here and not in Phase 5 because it is a Setup page feature that wants
  designing alongside the rest of that page. It is **not** the invite flow: no tokens, no
  self-signup, and an added address still receives nothing until they request a sign-in
  link themselves.

### Phase 5 — other people's leagues (multi-tenancy)

**Implementation plan: [docs/MULTI-LEAGUE.md](./docs/MULTI-LEAGUE.md)** — the order to fix the blockers below in, the five call sites that actually hardcode the league, and the decisions taken. Where the two documents disagree, that one is later.

Deliberately after GW1. The first real scored gameweek is a one-time, unrepeatable verification event (see [docs/GW1-VERIFICATION.md](./docs/GW1-VERIFICATION.md)); destabilising auth and bootstrap in that window trades a verifiable season for a feature nobody is waiting on yet.

**That window closed on 25 Aug 2026** — GW1 is scored, verified and recorded, so this phase is no longer blocked. It also turns out to be more urgent than "a feature nobody is waiting on": one league per deployment means there is nowhere to put a test league, so **the app cannot be exercised in production at all** without signing in to the real league, where a mis-tap reaches eighteen people. Phase A of the plan fixes that on its own, before any stranger is involved.

**What already supports it.** Every table that matters is league-scoped — `digests`, `dues`, `prize_rules`, `managers`, `manager_gw_history`, `recipients`, `league_users` all carry `league_id` — and `assertOwner(leagueId, userId)` guards every Server Action. Isolation is enforced at the write path today. This is not a schema rewrite.

**What blocks it**, in the order it should be fixed:

- ~~**`ensureMembership` auto-adds.**~~ **Done.** It was replaced by a read-only `findMembership`, and `/setup`, `/dues` and `/send` now refuse a non-member instead of enrolling them. Membership is granted only by `scripts/bootstrap-owner.mts`. This was fixed ahead of the rest because it was latent rather than merely missing: it needed no code change to become a hole, only a second league's owner appearing in `users`. What remains for this phase is the *invite* — adding an owner by email, and letting them create their own league — not the guard.
- ~~**No self-signup, by design.**~~ **Resolved 2026-08-31: it stays that way.** The allowlist is kept and self-signup is not built — see [docs/MULTI-LEAGUE.md](./docs/MULTI-LEAGUE.md) phase C. Owners are invited by hand (one email field) and then create their own leagues by pasting an FPL league ID, which is validated against the API. That keeps the property this bullet worried about losing: the allowlist rejects strangers *before* any email is sent, so the app cannot be used as a mail relay, and no rate limiting is needed yet. It also defers real ownership verification, since an invited person is someone you vouched for.
  - **Built 2026-09-02 (plan phase C).** `/leagues` carries the list and the create form; `add-owner.mts --invite` vouches for someone with no league. One thing the decision above did not foresee: `addOwner` creates a `users` row as a side effect of adding a co-owner, so a create-league *UI* would have made the allowlist transitive — an invited co-owner could start their own league and invite others. Creation is therefore gated on `users.can_create_leagues`, false by default and granted only by the script, which needs production shell access. Vouching stays the operator's act, which is the property this bullet is about.
- ~~**One league per deployment.**~~ **Done 2026-08-31 (plan phase A).** Pages live at `/l/<fplLeagueId>/…` and resolve the league from the URL against the leagues the signed-in owner is a member of; `/` is a chooser, and an owner with exactly one league is redirected through it as before. `FPL_LEAGUE_ID` is no longer read by the web app — only by the capture cron and the scripts, which have no URL to take a league from. Resolution is **read-only**: `ensureLeague` used to run on every page load, which from a URL segment would have let anyone create a league row by typing a number. What remains is the **create-league flow** (plan phase C); until then a second league is created with `add-owner.mts --league <id>`, which is what makes production testable.
- ~~**The capture job is single-league.**~~ **Done 2026-09-01 (plan phase B).** It iterates the `leagues` table, so `FPL_LEAGUE_ID` no longer affects a running deployment at all — only what a script does when you don't name a league. The feared arithmetic did not materialise, because the gate moved in front of the loop rather than inside it: `bootstrap-static` and `event-status` are global, so a run with no settled gameweek makes **two** FPL calls whatever the league count, and only a capturing run pays ~20 per league. Ten leagues is ~192 calls a week idling, not ~1,150. The poll gate is now exactly what this bullet predicted — the thing keeping the app unblocked, rather than an optimisation. A run has a 2-minute budget and defers the rest to the next poll; a block aborts the whole run, since it is per-IP; any league erroring fails the run's Sentry check-in.
  - **The egress proxy is not discharged by this, and not owed either.** Phase B cut idle volume from ~1,150 calls a week at ten leagues to ~192, because the gate moved in front of the league loop — so the exposure is one capturing run a week, which at two leagues is a polite volume. Build it when a block **recurs after a redeploy** (meaning it is our traffic rather than a bad draw) or when a capturing run reaches hundreds of calls. See ARCHITECTURE.md "Egress and Cloudflare", which carries the reasoning and the six observed addresses.
  - **Cost of the split:** a skipped poll no longer refreshes rosters, so `managers` is written when a gameweek settles rather than hourly. Nothing user-facing reads that table.
- **No league switcher.** Phase A shipped the minimum that makes several leagues *usable*: the mark in the nav goes to `/`, which lists them. That is a deliberate floor, not the intended design — switching costs a round trip through a separate page, and nothing in the bar tells you which league you are currently in beyond the URL.
  - **The shape wanted is a dropdown under the signed-in address in the nav**, listing the owner's leagues with the current one marked, so switching is one click from any page and the current league is always named. The address is already there and already answers "which owner am I"; "which league am I in" is the same question one level out, and the two belong together.
  - It needs the same care the rest of the nav got: the links are league-scoped, so the menu must rebuild the whole prefix rather than swap a segment, and it should preserve the *page* across the switch where that makes sense — Setup on league A going to Setup on league B, not to A's composer.
  - Cheap and worth doing once there is a real second league to switch to. Until then the chooser is honest, and the dropdown would be decoration on a list of one.
- **Nothing prunes expired `sessions` and `verification_tokens`.** *(Deferred with the no-self-signup decision — invited-by-hand volume keeps this small. Comes due the day sign-up opens.)* Auth.js deletes an expired session when the token is next presented, so the rows that survive are exactly the abandoned ones — a session on a device someone stopped using, a sign-in link nobody opened. At two owners that is a handful a year and not worth a service; across hundreds it accumulates without bound, and both tables are read on the auth path. A weekly `cron-prune-sessions` doing `delete … where expires < now()` on both covers it. **Both** — the tokens are easy to forget and rot the same way; the production database was carrying unopened sign-in links from a week earlier when this was noticed. Its own service rather than a passenger on `cron-capture-history`: a housekeeping failure that turned the capture job red would send whoever is on call to debug the wrong thing, which is the whole reason jobs get their own service here.

**Non-technical, and easy to defer past the point where it is cheap:** hosting other people's leagues makes this a data controller for members' names and teams, and it sends them email. Negligible at five leagues; not at five hundred.

### Phase 6 — open the source

Making the repository public. Not a feature, and nothing waits on it: the app, the public URL and the link preview all work today with the repo private. **There is no clock on this phase**, which is the property that makes it safe to stop between any two steps below.

**What blocks it is real people's data**, and it is more widespread than [SECURITY.md](./SECURITY.md)'s warning about `src/lib/fpl/recorded/*.json` describes. Inventoried 2026-09-22:

- **The recorded payloads** hold 17 real names, 17 real team names, 17 FPL entry IDs, the `admin_entry`, and the league's ID, name and creation timestamp. One blob, touched by a single commit.
- **The names leaked outward.** Three real people appear outside that directory — one of them in *shipped UI code* (`src/components/recipients-list.tsx`), not only in tests. Four real team names sit in `src/lib/render/blocks.test.ts` and `docs/GW1-VERIFICATION.md`; the real `admin_entry` is in `src/lib/fpl/roster.test.ts`; the league ID is in 13 files.
- **History is worse than HEAD.** 151 of 156 commits contain the league ID, 144 the league name, 106 a real member's name. Three commit *messages* carry identifiers too, which matters because `git filter-repo --replace-text` rewrites file contents only — messages need `--replace-message`.
- Clean, and worth recording as checked: no secrets, no `.env` ever committed, no real email addresses, no names in file paths.

**The decisive constraint is GitHub's, not ours.** Rewriting this repository's history and force-pushing does *not* make it publishable: commits stay reachable under `refs/pull/N/head`, and there are 54 merged PRs. Making the repo public re-exposes every original commit by SHA, still linked from each PR page. Only a Support purge or deleting the repository removes them — and deleting it destroys the PR discussion, which is the part of the history that cannot be rewritten at all.

**So the shape is: a new public repository, with this one kept private as the archive.** The public side gets all 156 commits rewritten, preserving messages, dates, authorship and merge topology; the private side keeps the PR conversations. The only cost is new SHAs and merge-commit messages referencing PR numbers that live in the archive — which is honest about how the project was built.

**Anonymise the recordings, do not fabricate them.** Their entire job is proving the app can read what FPL actually sends; hand-authoring replacements would turn the change detector into a second `fixtures.ts` and quietly delete the reason `recorded.test.ts` exists. Substitute names, team names, entry IDs and the league ID while keeping the real payload's byte-shape. The constraints that must survive are in `recorded.test.ts` and are tighter than "it compiles" — 38 events, a settled `event-status` that opens the gate, every `last_rank` zero, no `id` key, `club_badge_src` present, a league average that differs from FPL's global one, and the percentage fields as **strings**.

Steps, in order. Only the last is irreversible:

- [x] **6a — anonymise the payloads and the code.** **Done 2026-09-22.** The four recordings, the 13 league-ID sites, the three names, the four team names, the real `admin_entry`. Two things the plan did not anticipate. `club_badge_src` was documented as "null for every manager" and was not — six of seventeen carried a real image URL embedding the entry ID and a per-upload GUID, which makes it the least obvious identifier in the payload and the one a reader would never look for. And removing `DEFAULT_LEAGUE_ID` had to come forward from 6b, because the literal *was* the identifier; that in turn made `FPL_LEAGUE_ID` load-bearing in `bootstrap-owner`, which runs from `preDeployCommand` and would have failed the next deploy. Anonymisation now runs inside `npm run fpl:record` so a recording never reaches disk with real names in it.
- [x] **6b — docs and policy.** **Done 2026-09-22.** SECURITY.md's blockquote inverted — it is now a rule about fixtures rather than about repository visibility — and its Reporting section no longer leans on the repo being private. A new section answers whether publishing changes the calculus: line by line it does not, because every accepted item was already observable from outside; what publishing changes is the shape of a *mistake*. The in-memory rate limits moved from accepted to planned work. LICENSE is MIT; README says the project is not a product, so nobody arrives expecting support. `DEFAULT_LEAGUE_ID` was already gone, having been pulled forward into 6a.

  **The egress IPs stay, reversing this plan's own instruction.** "Strip the Railway egress IP" was written believing it was one line in `docs/GW1-VERIFICATION.md`; `ARCHITECTURE.md` in fact carries seven, and they are the Cloudflare finding rather than decoration. "Six observed, one blocked", spanning three unrelated ranges with `13.x` on both sides of the block months apart, is what supports *a redeploy is a reroll, not a fix* — redacted, the conclusion becomes an assertion with its evidence deleted, which is the same reasoning that kept GW1-VERIFICATION from being dropped. They are also ephemeral addresses from a shared provider pool, belong to nobody, identify no one, and none is the current egress. The live `/api/egress-check` stays token-guarded, and that distinction is the point: a historical address in a write-up is not the same disclosure as an endpoint that reports the current one on demand and fires four FPL requests doing it.
- [ ] **6c — rewrite history on a scratch clone.** `git filter-repo` with `--replace-text` **and** `--replace-message`. Verify the scrub across all 156 rewritten commits, not against HEAD. Nothing is pushed; the clone is disposable.
- [ ] **6d — publish.** Create the public repository and push. **One-way.**

**6a and 6b do not reduce exposure**, and should not be mistaken for partial mitigation: the history still holds everything until 6c and 6d. They are worth doing on their own merits regardless — CLAUDE.md carries "the recordings contain real managers' names" as a standing hazard, and anonymising retires it whether or not the repo is ever opened.

**Decisions still open**, none of them needed before 6a except the first:

- The substitute league ID.
- Whether the public repository carries `main` only or all 19 branches.
- Whether the commit author address stays as-is. All 156 commits are authored from a personal address, and publishing makes it permanently scrapable.

Also worth re-reading at 6b: SECURITY.md's "Accepted, with reasons" list, through the lens of the code being public while the app is live. The conclusion on 2026-09-22 was that **nothing moves from acceptable to unacceptable** — the sign-in enumeration oracle is already observable by anyone who can load the form, and the in-memory rate limits' thresholds are discoverable by probing in minutes. The one change worth making is moving "rate limits to Postgres" out of the accepted list and into planned work, because an accepted risk that is now publicly documented reads better as a known to-do.

## Trigger condition

`events[].finished` flips **before** bonus points are applied, and league tables are recalculated on a schedule separate from player points. Triggering on `finished` + `data_checked` alone can send a digest with stale standings.

Gate instead on the `event-status` endpoint — `status.length > 0` **and** every `status[].bonus_added === true` **and** `leagues === "Updated"` — cross-checked against `events[gw].data_checked`.

The length guard is not defensive padding: `event-status` returns `{"status":[],"leagues":""}` outside a live gameweek (confirmed live, pre-season), and `[].every(...)` is vacuously `true`.

Preparation must also be idempotent: a `deliveries` row unique on `(league_id, gameweek, kind)` is required before any cron runs, or polling plus a scheduled send can double-prepare.

## Open questions

*(None currently blocking — cadence and the owner's manager ID are both resolved above.)*

## Known risks

Security posture — what is enforced, what is knowingly accepted, and what would change those answers — lives in [SECURITY.md](./SECURITY.md).


- **Unofficial API** — first-party but undocumented; no stability guarantee, no terms coverage, shapes shift between seasons
- **Cloudflare IP blocking** — the FPL API rejects many datacenter IPs; this drives the hosting choice (see ARCHITECTURE.md). **No longer a risk but an observed event**: production was blocked on 2026-09-01 and recovered only by redeploying, which draws a new egress address. A redeploy is a reroll, not a fix — but six observed addresses, one blocked and five fine, point at one unlucky address rather than at Railway. The proxy is therefore **conditional work with stated triggers**, not owed work; ARCHITECTURE.md has them
- **Deep-link behaviour varies** across iOS / Android / desktop
- **Season rollover** resets league and gameweek IDs

### Explicitly out of MVP
- Multi-league support (co-*owners* are in; one owner across many *leagues* is not). Now planned as **Phase 5** rather than indefinitely deferred — unrelated owners running their own leagues is a committed direction, just not before GW1
- Member-facing polls/predictions
- H2H leagues (classic only for v1)
- Public shareable web page
- Season rollover automation
- Other fantasy platforms (see roadmap below)

---

## Future Roadmap

- **Rate limits in Postgres, not memory.** `src/lib/rate-limit.ts` counts in process, which is correct for one container and fails *open* across several — each instance counts separately, multiplying the effective limit. Not urgent while the app runs as a single instance, and deliberately moved out of [SECURITY.md](./SECURITY.md)'s accepted list when the source went public: an accepted risk that is now also publicly documented reads better as planned work than as a shrug. Comes due the day a second instance exists, which is also the day nothing warns you — the failure is silent and looks like normal operation
- **Payout tracking** — recording that a prize was actually handed over, as opposed to computing who won it. v1 tracks dues *in* and computes winnings *out*, but doesn't reconcile the second half
- **Configurable tie-breaking rules** — leagues that break ties on fewest transfers, head-to-head, bench points etc. v1 covers these with a manual override of final positions instead of encoding them
- **Monthly prizes** — not used by the reference league; would need `league.start_event` and `events[].deadline_time` to map gameweeks → months
- **Role-based permissions** — `role` is stored from v1 (`communicator`, `treasurer`) but grants nothing; every owner can do everything. The obvious first restriction is preventing the treasurer from sending to the group
- **WhatsApp Business Cloud API delivery** — fully server-side sending, gated on Official Business Account status
- **Variable/uneven entry fees or side-pots** — beyond the flat-fee assumption (e.g. optional side bets, buy-ins mid-season)
- **Request access — a signup process that is still a decision, not a door.** Today an address gets in only if the operator runs a script, which does not scale past people he already knows and gives a stranger who lands on `/signin` nothing to do but give up. Shape not yet decided; the sketch is an unauthenticated form (email, maybe the league they administer and a sentence about themselves) that **emails the operator**, who approves by running the same script. Two properties make that cheap where full self-signup is not:
  - **It must email the operator, never the requester.** That is the whole trick. The current allowlist's quiet second job is refusing unknown addresses *before* any mail is sent, which is what stops the app being an open relay ([docs/MULTI-LEAGUE.md](./docs/MULTI-LEAGUE.md) phase C). A form whose only recipient is a fixed address keeps that property: the payload is attacker-controlled text, but the destination never is. Sending anything to the requester — even "we got your request" — hands the relay back.
  - **Rate limiting stops being optional**, but only to protect one inbox rather than a reputation. Cheaper than the real thing, and the first piece of work the moment this ships.
  - Open: whether requests are a table with a state (`pending`/`approved`/`declined`) or just an email the operator acts on. A table is the honest version and makes approving a UI action rather than an SSH session; email alone is a Tuesday afternoon. Start with the second, expect to want the first.
- **One owner, several leagues/seasons from one dashboard** — distinct from Phase 5's multi-tenancy. Phase 5 makes unrelated owners possible; this makes one person's several leagues pleasant. Same join table, and mostly UI once Phase 5 lands. The nav dropdown described under Phase 5 is the first piece of it, and the smallest
- **H2H (head-to-head) league support** — different standings model than classic
- **Member-facing features** — personal weekly recap, H2H trash-talk stats, predictions/polls embedded in digest, public read-only standings page
- **Public shareable web page** per league (no login, just a link)
- **Season rollover automation** — recreate league, re-invite members, carry over trophies/history
- **End-of-season summary/awards** — auto-generated recap doc/image
- **League health monitoring** — flag inactive managers
- **Export/archive** — CSV/PDF of standings and history
- **Support for other fantasy league platforms** beyond EPL FPL:
  - Other football leagues with fantasy platforms (e.g. Champions League Fantasy)
  - Other sports' fantasy platforms (NFL, NBA, etc.) — would require abstracting the data-fetch layer per platform's API/scraping needs, since none will share FPL's endpoint shapes

### Monetisation *(exploratory — not decided)*

- **Ads, with a paid tier to remove them.** Recorded as a possibility, not a commitment. Nothing in the MVP should be built to assume it, but two things are worth knowing before it is ever picked up:
  - It requires **multi-tenancy and billing** — accounts, plans, payment handling — none of which the single-league MVP has. The `league_users` join table is the seed of it, but it is a substantial addition, not a toggle.
  - **Ads sit awkwardly with the delivery model.** The digest's main surface is a WhatsApp message the owner sends to their own friends; putting advertising in it would be sending ads on the owner's behalf. Any ad placement realistically lives in the owner-facing web app, not in the digest — which is a much smaller surface than it first appears.
