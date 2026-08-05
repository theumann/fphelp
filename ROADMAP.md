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

Instead, v1 uses the **deep-link/share flow**: the server prepares a digest and gives the owner a one-tap link, `whatsapp://send?text=<urlencoded>` (https fallback `https://wa.me/?text=<urlencoded>`). WhatsApp opens a chat picker with the message pre-filled; the owner selects the league group and taps send.

Three constraints follow:

- **The phone number must be omitted.** Supplying one (`wa.me/<number>?text=`) opens that individual chat directly and makes groups unreachable. This is a silent failure — the link still looks like it works.
- **The link must be tapped on the owner's phone**, so delivery cannot complete server-side.
- **Delivery state is `prepared` → optionally `marked sent`**, never "confirmed delivered".

Email remains a first-class channel in its own right — the same digest, rendered as HTML.

## Digest length budget

Because the WhatsApp payload lives in a URL, length is a design constraint rather than a detail. Newlines become `%0A` and table padding is pure cost. Target **~1,500 characters encoded**, with a compact layout and a defined truncation strategy for large leagues.

## MVP Feature Set

**Core loop: fetch → digest → prepare → owner sends**

Each feature is annotated with its data source. "Free" means it needs no call beyond the standings fetch.

### Phase 0 — verify the API
- ✅ **Done 2026-08-03** for `bootstrap-static/` (fully confirmed) and the response envelopes of `event-status/`, `leagues-classic/{id}/standings/`, `entry/{id}/history`
- ⏳ **Blocked until GW1 completes (deadline 2026-08-21)** — `standings.results[]` and `history.current[]` element fields, and the live value of `event-status.leagues`, are all empty pre-season. Re-run the diff after GW1 is scored and record fixtures then
- One throwaway `whatsapp://send?text=` link with a realistic full-length digest, tapped on the owner's real phone, to confirm group selection works and nothing is truncated
- One league hardcoded; no setup UI yet

### Phase 1 — standings digest + deep-link send
- **League setup (one-time)** — owner enters the **numeric** league ID; validate via `leagues-classic/{id}/standings/`. Note the invite code (e.g. `1xrliv`) is *not* the API ID and cannot be resolved to one without authentication — the UI must ask for the number from the league URL and say so
- **Co-owners** — a league can have more than one owner; invite a second owner by email. One shared prepared digest and one shared "sent" state between them, not one each. A `role` (`communicator` / `treasurer`) is recorded but grants nothing yet
- **Automated gameweek digest**
  - Triggered when the GW is genuinely final — see "Trigger condition" below, not `finished` alone
  - Content, all free from one standings call (`ClassicLeagueEntry`: `entry`, `entry_name`, `player_name`, `rank`, `last_rank`, `total`, `event_total`):
    - standings table — must follow `has_next` pagination to render every manager
    - rank movement (`last_rank - rank`); biggest riser/faller
    - GW winner (max `event_total`)
    - league average — **computed** as the mean of `event_total` across results
  - Roster completeness: managers in `new_entries[]` do not appear in standings until the next GW is processed, and must still show up
- **Send page (mobile)** — rendered digest, "Send to WhatsApp" deep link, "Copy text" fallback, optional "Mark as sent"
- **Email digest** — same content, HTML
- **History capture starts here** — snapshot `entry/{id}/history` → `current[]` once per GW per manager, even though the stats that use it ship in Phase 4. It cannot be backfilled for managers who join mid-season.

### Phase 2 — money pot, dues and winnings
- Owner enters the **pot total directly**, plus prize rules, configured once at setup
- **Prize rules** — three kinds cover the reference league:
  - fixed amount to each **gameweek winner**
  - fixed amount to the **season's single highest gameweek score**
  - **percentage to each of the top N** at season end, with **N and each percentage configurable by the owner** at setup (6 in the reference league). Validated as contiguous ranks from 1, percentages summing to 100%. Editable mid-season; locked once the ledger is finalised
- **Fixed amounts come off the top, percentages apply to the remainder.** Setup must validate that fixed commitments don't exceed the pot, and that the percentages sum to 100% — see ARCHITECTURE.md. Getting this wrong over-commits the pot and only shows up in May. Re-validate on every pot edit, since managers keep joining
- **Winnings ledger** — who won what, accruing per gameweek. GW-winner amounts are final once a GW is scored; rank and best-GW prizes stay *provisional* until the final gameweek
- **Tie handling** — pool the prizes for the tied positions and split evenly (see ARCHITECTURE.md). Detect ties on `rank`, never `rank_sort`
- **Manual override of final positions** at season end — the escape hatch for leagues with their own tie-breaking rules, without modelling any of them

Reference league config (this league): $100 entry × 18+ managers, $15 per gameweek winner, $100 for the season's best gameweek, remainder split across the top 6 by percentages **still to be decided**.
- **Dues tracking** — per-manager paid / not paid, for the treasurer
- Entry fee is optional, display-only ("£20 × 18 players") — no longer load-bearing
- Digest includes pot total and this week's winner's prize alongside standings

### Phase 3 — deadline reminders + manual send
- Scheduled reminder before each GW deadline (`events[].deadline_time`)
- On-demand "send now" outside the automated schedule

### Phase 4 — season narrative stats
- Manager of the month, worst GW ever, longest streak — pure queries over the history captured since Phase 1

## Trigger condition

`events[].finished` flips **before** bonus points are applied, and league tables are recalculated on a schedule separate from player points. Triggering on `finished` + `data_checked` alone can send a digest with stale standings.

Gate instead on the `event-status` endpoint — `status.length > 0` **and** every `status[].bonus_added === true` **and** `leagues === "Updated"` — cross-checked against `events[gw].data_checked`.

The length guard is not defensive padding: `event-status` returns `{"status":[],"leagues":""}` outside a live gameweek (confirmed live, pre-season), and `[].every(...)` is vacuously `true`.

Preparation must also be idempotent: a `deliveries` row unique on `(league_id, gameweek, kind)` is required before any cron runs, or polling plus a scheduled send can double-prepare.

## Open questions

- **Top-6 percentage split** — the six percentages applied to the remainder are not yet decided. The app takes them as configuration, so this blocks using the reference league, not building it
- **Digest cadence** — every GW, or weekly/monthly summaries too?
- **Does v1 need the owner's own manager ID**, or is the league ID sufficient?

## Known risks

- **Unofficial API** — first-party but undocumented; no stability guarantee, no terms coverage, shapes shift between seasons
- **Cloudflare IP blocking** — the FPL API rejects many datacenter IPs; this drives the hosting choice (see ARCHITECTURE.md)
- **Deep-link behaviour varies** across iOS / Android / desktop
- **Season rollover** resets league and gameweek IDs

### Explicitly out of MVP
- Multi-league support (co-*owners* are in; one owner across many *leagues* is not)
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
- **Multi-league support** — one owner running several leagues/seasons from one dashboard. The MVP's `league_users` join table already allows this; the deferred work is the league switcher and scoping every query, not a schema change
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
