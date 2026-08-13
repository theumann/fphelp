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
- One league per deployment, set by `FPL_LEAGUE_ID` (defaults to the reference league, 9999999). Not yet a setting: `/setup` configures the pot, prize rules and the owner's own team *for* that league, but there is no flow for creating one, so which league a deployment serves stays deployment-level. A bad value throws at startup rather than falling back — serving the wrong league silently is worse than not starting

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
- **Send page (mobile)** — composed message, "Send to WhatsApp" deep link, "Copy text" fallback, optional "Mark as sent"
- **Email digest** — same composed message, HTML. **Opt-in**, and requires the owner to enter a recipient list first (see Delivery model). Deferrable within Phase 1 if WhatsApp lands first
- **History capture starts here** — snapshot `entry/{id}/history` → `current[]` once per GW per manager, even though the stats that use it ship in Phase 4.
  - ✅ **Built** as `POST /api/jobs/capture-history`, guarded by a `JOBS_TOKEN` bearer token. It also upserts `managers`, which is the only record of who was in the league at a given time.
  - It stores **every gameweek `current[]` returns**, not just the latest. That makes a missed run self-healing, and means the backfill question below decides only how much one run recovers — not whether the data is lost.
  - ✅ **Scheduled** via a Railway cron service running `npm run job:capture`. Polls are gated on `captureDecision`, so they cost two FPL calls and skip until a gameweek has finished *and* settled; a partial capture is retried by the next poll. Still needs the cron service created in the Railway dashboard (`APP_URL` + `JOBS_TOKEN`).
  - ⚠️ **Unexercised against real data** — pre-season `current[]` is empty for every manager, so the mapping is unit-tested but has never parsed a real scored gameweek. Re-check on the first run after GW1.

### Phase 2 — money pot, dues and winnings
- Owner enters the **pot total directly**, plus prize rules, configured once at setup
- **Prize rules** — three kinds cover the reference league:
  - fixed amount to each **gameweek winner**
  - fixed amount to the **season's single highest gameweek score**
  - **percentage to each of the top N** at season end, with **N and each percentage configurable by the owner** at setup. Defaults to 6 places at **40 / 25 / 15 / 10 / 6 / 4**. Validated as contiguous ranks from 1, percentages summing to 100%. Editable mid-season; locked once the ledger is finalised
- **Fixed amounts come off the top, percentages apply to the remainder.** Setup must validate that fixed commitments don't exceed the pot, and that the percentages sum to 100% — see ARCHITECTURE.md. Getting this wrong over-commits the pot and only shows up in May. Re-validate on every pot edit, since managers keep joining
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

Not yet scheduled, but planned before the season settles into routine. One item is
already assigned to it rather than left to Phase 5:

- **Add and remove owners from Setup.** Sign-in is allowlist-based, so an owner exists
  only if a `users` row does, and today the only ways to create one are the
  `BOOTSTRAP_OWNER_EMAIL` deploy script and editing the database by hand. Neither is
  reachable by the person who actually needs it. A small Setup section — add an address,
  see who has access, remove one — replaces both and is what makes the closed membership
  rule workable rather than merely safe.
- It belongs here and not in Phase 5 because it is a Setup page feature that wants
  designing alongside the rest of that page. It is **not** the invite flow: no tokens, no
  self-signup, and an added address still receives nothing until they request a sign-in
  link themselves.

### Phase 5 — other people's leagues (multi-tenancy)

Deliberately after GW1. The first real scored gameweek is a one-time, unrepeatable verification event (see [docs/GW1-VERIFICATION.md](./docs/GW1-VERIFICATION.md)); destabilising auth and bootstrap in that window trades a verifiable season for a feature nobody is waiting on yet.

**What already supports it.** Every table that matters is league-scoped — `digests`, `dues`, `prize_rules`, `managers`, `manager_gw_history`, `recipients`, `league_users` all carry `league_id` — and `assertOwner(leagueId, userId)` guards every Server Action. Isolation is enforced at the write path today. This is not a schema rewrite.

**What blocks it**, in the order it should be fixed:

- ~~**`ensureMembership` auto-adds.**~~ **Done.** It was replaced by a read-only `findMembership`, and `/setup`, `/dues` and `/send` now refuse a non-member instead of enrolling them. Membership is granted only by `scripts/bootstrap-owner.mts`. This was fixed ahead of the rest because it was latent rather than merely missing: it needed no code change to become a hole, only a second league's owner appearing in `users`. What remains for this phase is the *invite* — tokens and self-signup — not the guard.
- **No self-signup, by design.** `src/auth.ts` refuses any address not already in `users`. Unrelated owners cannot be added by hand, so this becomes signup plus per-league invites. Note what that costs: the allowlist currently rejects strangers *before* any email is sent, so the app cannot be used as a mail relay. Removing it means adding rate limiting to replace that property.
- **One league per deployment.** `FPL_LEAGUE_ID` becomes the wrong shape. League selection moves into the database and the UI, with a create-league flow that validates a numeric ID against `leagues-classic/{id}/standings/` — and says plainly that the invite code is not the ID.
- **The capture job is single-league.** It reads one league and makes 18 sequential FPL calls. Multi-league makes that a loop, and ~180 calls per window at ten leagues, from one Railway egress IP, behind Cloudflare. The egress-proxy mitigation currently "on the books" becomes real work, and the poll gate stops being an optimisation and starts being what keeps the app unblocked.
- **No league switcher**, since there has never been more than one.

**Non-technical, and easy to defer past the point where it is cheap:** hosting other people's leagues makes this a data controller for members' names and teams, and it sends them email. Negligible at five leagues; not at five hundred.

## Trigger condition

`events[].finished` flips **before** bonus points are applied, and league tables are recalculated on a schedule separate from player points. Triggering on `finished` + `data_checked` alone can send a digest with stale standings.

Gate instead on the `event-status` endpoint — `status.length > 0` **and** every `status[].bonus_added === true` **and** `leagues === "Updated"` — cross-checked against `events[gw].data_checked`.

The length guard is not defensive padding: `event-status` returns `{"status":[],"leagues":""}` outside a live gameweek (confirmed live, pre-season), and `[].every(...)` is vacuously `true`.

Preparation must also be idempotent: a `deliveries` row unique on `(league_id, gameweek, kind)` is required before any cron runs, or polling plus a scheduled send can double-prepare.

## Open questions

*(None currently blocking — cadence and the owner's manager ID are both resolved above.)*

## Known risks

- **Unofficial API** — first-party but undocumented; no stability guarantee, no terms coverage, shapes shift between seasons
- **Cloudflare IP blocking** — the FPL API rejects many datacenter IPs; this drives the hosting choice (see ARCHITECTURE.md)
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

- **Payout tracking** — recording that a prize was actually handed over, as opposed to computing who won it. v1 tracks dues *in* and computes winnings *out*, but doesn't reconcile the second half
- **Configurable tie-breaking rules** — leagues that break ties on fewest transfers, head-to-head, bench points etc. v1 covers these with a manual override of final positions instead of encoding them
- **Monthly prizes** — not used by the reference league; would need `league.start_event` and `events[].deadline_time` to map gameweeks → months
- **Role-based permissions** — `role` is stored from v1 (`communicator`, `treasurer`) but grants nothing; every owner can do everything. The obvious first restriction is preventing the treasurer from sending to the group
- **WhatsApp Business Cloud API delivery** — fully server-side sending, gated on Official Business Account status
- **Variable/uneven entry fees or side-pots** — beyond the flat-fee assumption (e.g. optional side bets, buy-ins mid-season)
- **One owner, several leagues/seasons from one dashboard** — the league *switcher*, distinct from Phase 5's multi-tenancy. Phase 5 makes unrelated owners possible; this makes one person's several leagues pleasant. Same join table, and mostly UI once Phase 5 lands
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
