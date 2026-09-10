# FPheLp — Architecture (MVP)

Working name. See [ROADMAP.md](./ROADMAP.md) for feature scope and future items.

## Overview

FPheLp is a webapp that automates a private fantasy league owner's communications — standings, results, and money-pot updates — currently done by hand in WhatsApp/email. The MVP targets **EPL Fantasy classic private leagues** and is **admin-only**: a league may have one or several co-owners who log in, but ordinary league members never do — they just receive the output in channels they already use.

Data comes from the FPL API at `fantasy.premierleague.com/api/*`. It is first-party (run by the Premier League itself) but undocumented and unsupported — no versioning guarantees, so the fetch layer must be defensive.

## Stack

| Concern | Choice | Notes |
|---|---|---|
| App type | Webapp (responsive) | Not native — owner-only, low-frequency admin usage |
| Language | TypeScript, Node 22 | Best-typed FPL community clients; shared types across render and deep-link paths |
| Framework | Next.js (App Router) | Owner dashboard, mobile send page, and job routes in one deploy |
| Database | Postgres on Railway + Drizzle | Co-located with the app over private networking; one dashboard and bill |
| Auth | Magic link (Auth.js) | Single owner; the emailed link must open the mobile send page directly |
| Hosting | Railway (persistent container) | Stable egress IP — see "Egress and Cloudflare". Not Vercel serverless |
| Scheduling | Railway cron → token-protected route | Survives restarts; no in-process timer state |
| Email delivery | Resend, called with `fetch` | No SDK and no React Email: `renderEmail` builds the HTML and its plaintext alternative from `DigestStats` |
| WhatsApp delivery | Deep link (`whatsapp://send?text=`) | Owner taps; no phone number in the URL |
| Unit tests | Vitest + hand-built factories | Recorded fixtures are the goal; nothing real to record until GW1 |
| UI tests | Playwright, FPL stubbed server-side | Owner flows, especially deep-link construction |

## Components

```
[Owner's browser / phone]
        |
        v
[Next.js app on Railway]
  - Magic-link login
  - League setup / pot config UI
  - Mobile send page (deep link + copy)
  - API + job routes
        |
        +--> [Railway Postgres] leagues, managers, manager_gw_history,
        |                        digests, deliveries
        |
        +--> [FPL client] bootstrap-static, event-status, leagues-classic
        |                 standings (paginated), entry/*/history  (cached,
        |                 retry + backoff)
        |
        v
[Railway cron]  --hourly, Sun-Wed-->  poll event-status:
        |                             bonus_added && leagues == "Updated"
        |                             x-check events[gw].data_checked
        v
[Digest computation]  pure functions: standings, rank deltas,
        |             GW winner, risers/fallers, league average,
        |             pot payouts
        v
[Renderer]  one source -> HTML email + length-budgeted plaintext
        |
        +--> [Email: Resend]        (automated)
        +--> [Send page]            (owner taps deep link -> WhatsApp)
```

Components are layered so the risky parts are isolated: the **FPL client** owns caching, retry and backoff; **digest computation** is pure functions over fetched JSON (hence heavily unit-tested); the **renderer** emits both output formats from one template; **delivery adapters** sit behind one interface so email and WhatsApp differ only at the edge.

### Routes, and where the league comes from

One deployment serves **many leagues**. The owner-facing pages live under a league segment and take the league from the URL:

| Route | Notes |
| --- | --- |
| `/l/<fplLeagueId>/send` | the composer. Elsewhere in this document, "`/send`" means this |
| `/l/<fplLeagueId>/setup` | settings, three tabs |
| `/l/<fplLeagueId>/dues` | dues |
| `/` | league chooser; redirects through to the composer for an owner with exactly one |
| `/send`, `/setup`, `/dues` | kept as redirects, for bookmarks and the home-screen icon |

The segment is the **FPL numeric league ID**, not the internal UUID — it is the number the owner already knows, and `leagues.fpl_league_id` is unique. `requireLeagueAccess` in `src/lib/league-access.ts` is the only place a league URL is interpreted, and it is **read-only**: an unknown ID is a 404, never a new league row. Membership is checked there, so a league you do not own is a refusal rather than a page.

`FPL_LEAGUE_ID` is no longer read by the web app, and since phase B not by the capture cron either — that iterates the `leagues` table. It survives only as the default for the operational scripts when none is named on the command line, so setting or changing it cannot affect a running deployment.

## Data model

**Naming, because "manager" is overloaded.** FPL calls a league participant a *manager* (the API calls one an `entry`). We also have people who *administer* a league in this app. Those are different populations — an admin may not even play in the league. Throughout the schema and code:

- **`users`** — people with a login to this app (admins/co-owners)
- **`managers`** — FPL entries competing in the league; they never log in

| Table | Purpose |
|---|---|
| `users` | app accounts: email, magic-link identity |
| `leagues` | league id, name, `start_event`, `pot_total`, `currency`, optional display-only entry fee |
| `league_users` | **join table**: `(league_id, user_id, role, manager_entry?)`, unique on `(league_id, user_id)` |
| `managers` | FPL entries: `entry`, `entry_name`, `player_name`, league membership |
| `recipients` | owner-maintained email list for a league. Separate from `managers` — the API gives no addresses, so the two drift |
| `manager_gw_history` | one row per manager per GW, snapshotted from `entry/{id}/history` → `current[]` |
| `prize_rules` | one row per rule: `kind`, optional `rank`, optional `gameweek`, `value`. Set once at league setup |
| `league_expenses` | costs paid out of the pot before any prize: `label`, `amount`, `position`. The label is member-facing — the digest prints it |
| `dues` | per manager: `amount`, `paid`, `paid_at`, `note` |
| `winnings` | ledger: `manager_entry`, `rule_kind`, `gameweek`, `amount`, `status` (`provisional` \| `final`) |
| `digests` | computed **structured stats** per league per GW (JSON), not rendered text. **Unique on `(league_id, gameweek)`** |
| `messages` | the owner's draft and `sent_text`, blocks included, `created_by`, `sent_at`, `marked_sent_by`. **Many per gameweek** |

**Idempotency applies to the digest, not to messages.** These are two different concerns and conflating them breaks one of them:

- **`digests` is unique on `(league_id, gameweek)`** — the computed stats for a gameweek exist once. This is what stops a cron poll and a manual refresh from double-preparing, and it is load-bearing.
- **`messages` is deliberately many-per-gameweek.** The owner may well send a results post and then a midweek follow-up off the same digest. A uniqueness constraint here would block legitimate sends.

`sent_at` null means *unknown*, not failure — the send happens inside WhatsApp and is unobservable.

**Co-ownership.** `league_users` is many-to-many in both directions from day one. That covers the immediate need — this league has two people administering it — and the same table covers one user running several leagues later, with no migration. Only the UI and scoping change.

Two consequences the digest pipeline has to respect:

- **A digest is prepared once per league, not once per admin.** The `(league_id, gameweek)` constraint enforces this and must not gain a `user_id`. Notification fan-out is separate: *every* co-owner may be emailed, but they share one set of computed stats.
- **Sent messages are shared state.** When one co-owner sends, the other must see it — including any draft in progress, so two people don't independently write the same week's update. Record `created_by` and `marked_sent_by` and surface both. This is the main failure mode co-ownership introduces, and the composer widens it: a draft is now something a co-owner can duplicate effort on, not just a send they can repeat.

**The owner's own manager ID lives on `league_users`, not `leagues`.** It is used to sign the digest — `[Manager Name] — [Team Name] Manager and [League Name] Admin` — and co-owners have different FPL entries, so the signature depends on *who sends*. Consequences:

- The signature is applied at **send/render time from the sending owner's row**, never baked into the stored `digests` payload, which is shared between co-owners.
- It is **optional**: an owner may administer a league without playing in it (the treasurer, plausibly). Fall back to a plain name, or omit the signature entirely.
- Name and team name come from `entry/{id}` (`player_first_name`, `player_last_name`, `name`); league name from `league.name`. No new endpoint.
- It costs characters against the digest length budget, and it is **per-sender**, so the budget check must run against the longest owner's signature, not a generic one.

`role` is recorded (`communicator`, `treasurer`) but **carries no permission logic in v1** — every owner can do everything. It exists so that role-based access later is an enum-and-policy change rather than a schema migration.

## Digest composition

The generated digest is a **pre-filled draft, not a finished message**. The owner writes their own commentary each week and chooses which generated blocks to include around it. This is the primary flow — the app does not compose on the owner's behalf and send.

Available blocks:

| Block | Content |
|---|---|
| `overall_standings` | full league table, rank movement |
| `gw_results` | the last finished gameweek: winner, scores, league average, riser/faller |
| `prize_structure` | the prize rules, and optionally winnings to date |

Each block is **defaulted at league level and overridable per message**. The defaults are the owner's usual shape; the per-message toggles are for the week they want something different. Store defaults on the league and the actual selection on the `messages` row, so a sent message records what it contained rather than inferring it from settings that may since have changed.

Three consequences:

- **`digests` stores structured stats, not text.** Toggling a block re-renders from the same stored JSON — no re-fetch, no storing every combination. This is why the computation and rendering layers are already separate.
- **The sent text must be stored.** Once the owner edits freely, the message is no longer reproducible from the API. `messages.sent_text` is the record of what the league actually received.
- **The length budget becomes interactive.** Blocks have very different costs — `overall_standings` for a 20-manager league can consume most of the ~1,500-character budget on its own. The composer must show a **live remaining-characters count that updates as blocks are toggled and text is typed**, rather than failing at render time. This is the main UX constraint the block model introduces.

**Cadence follows from this**: there is no fixed send schedule. The cron's job is to have a digest *ready*, not to send. Notifying the owner when a gameweek finishes is an **optional per-league setting**; the default flow is the owner opening the app when they feel like writing.

## Prize rules and the winnings ledger

Prizes are configured once at league setup and then computed, never hand-entered. Three rule kinds cover the reference league:

| `kind` | When | Value |
|---|---|---|
| `gw_winner_fixed` | every gameweek | fixed amount to that GW's top `event_total` |
| `season_best_gw_fixed` | season end | fixed amount to the single highest `event_total` of the season |
| `season_rank_pct` | season end | percentage to each of the top N final ranks — **N is configurable**, 6 in the reference league |

**Fixed amounts come off the top; percentages apply to the remainder.** This is the one piece of arithmetic that must not be got wrong:

```
committed_fixed = (gw_winner_amount × number_of_gameweeks)
                + season_best_gw_amount
expenses        = sum(league_expenses.amount)
remainder       = pot_total − committed_fixed − expenses
rank prizes     = season_rank_pct[i] × remainder
```

**League expenses are the third term and behave exactly like the fixed prizes**: off the
top, before any percentage applies. Trophy engraving is the reference league's case. They
are itemised rather than a single total because the digest names each one — the prize block
prints `Pot  $1,800.00` and then `Trophy engraving  -$100.00`, so what the league
collected and what is left to share are both stated instead of leaving a subtraction for
the members to notice. Leaving them out of `remainder` promises the top six money that has
already been spent, and, like every other error in this section, it surfaces in May.

They are validated with the pot, not separately: `committed_fixed + expenses ≤ pot_total`,
which means a league whose fixed prizes fit can still be tipped over by an expense. That is
why they live in `LeagueSettings` and save behind Setup's Save button rather than writing on
each click like the owners and recipients lists — the set has to be validated whole.

`number_of_gameweeks` comes from `events.length` in `bootstrap-static` (38, confirmed live) — never hardcode it, so a shortened season doesn't silently over-commit.

Worked example, the reference league at 18 managers × $100:

| | |
|---|---|
| `pot_total` | $1,800 |
| GW winners | 38 × $15 = $570 |
| Season best GW | $100 |
| `committed_fixed` | **$670** |
| `remainder` (top 6) | **$1,130** |

Note the fixed commitments are constant at $670 whatever the headcount, so **the remainder is what absorbs new managers** — at 20 it's $1,330. That also sets the floor: below 7 managers the fixed prizes exceed the pot.

Applying the default split (below) to that $1,130 remainder:

| Place | % | Amount |
|---|---|---|
| 1st | 40 | $452.00 |
| 2nd | 25 | $282.50 |
| 3rd | 15 | $169.50 |
| 4th | 10 | $113.00 |
| 5th | 6 | $67.80 |
| 6th | 4 | $45.20 |
| | **100** | **$1,130.00** |

This case reconciles exactly — and so will every other headcount. With a whole-dollar pot and integer percentages the remainder is always a whole number of dollars, so `dollars × pct` is always whole cents. **Changing the number of managers will not produce a rounding case.**

Rounding only arises from:
- **tie splits** — $10 pooled between three tied managers is $3.333…, the main real-world case
- **fractional percentages** — e.g. a league using 33.33%
- **a non-whole-dollar pot**

Unit tests must use one of those to exercise the derive-the-last-place rule; varying the headcount tests nothing.

Applying the percentages to `pot_total` instead over-commits the pot, and the shortfall only surfaces at season end when the treasurer pays out. Two validations belong in setup, not in a test:

- `committed_fixed ≤ pot_total`, with the remainder shown live as the owner types
- `season_rank_pct` values sum to exactly 100% (of the remainder)

Because managers keep joining early in the season, `pot_total` is editable and both validations must re-run on every edit — not only at first setup.

### Configurable paid places

The number of paid places is **owner-configurable**, and needs no extra schema: it is simply how many `season_rank_pct` rows a league has, each carrying its own `rank` and percentage. Six rows gives the reference league's top 6; three rows gives a league that pays 1st–3rd.

**Default for a new league: 6 places at 40 / 25 / 15 / 10 / 6 / 4 percent.** Seeded at setup and editable from there — a default, not a constraint.

Validation on the set:

- `rank` values are **contiguous from 1** with no gaps or duplicates — a league paying 1st, 2nd and 4th is a data-entry mistake, not a rule
- percentages sum to exactly 100%, using decimal arithmetic (see below)
- at least one row; the count should not exceed the number of managers in the league
- each percentage is > 0 — a paid place worth nothing should be removed, not stored as zero

**Editing mid-season is allowed** and simply changes the provisional projections, which is the point of marking them provisional. But once the final gameweek is scored and the ledger is finalised, prize rules **lock** — otherwise editing a percentage silently rewrites history in the `winnings` rows.

Store percentages as **decimals, not floats**, and derive the last place's amount as `remainder − sum(others)` so rounding can never make the payouts miss the pot by a cent.

**Provisional vs final.** GW-winner amounts are known and `final` the moment a gameweek is scored, and accrue into `winnings` as the season runs. Rank and best-GW prizes are `provisional` until the last gameweek is scored — displayed as standings-based projections, recomputed each GW, and only frozen at season end. The ledger must never present a provisional figure as settled.

## Ties

Ties will happen, most often on `gw_winner_fixed`. The default policy is **pool and split**:

> N managers tied at rank R occupy positions R … R+N−1. Sum the prizes attached to those positions and divide equally between them.

This single rule covers both cases naturally:
- Two tied for 1st → pool 1st + 2nd, split evenly; the next manager takes 3rd.
- Two tied for the last paid place (6th here) → positions 6 and 7; 7th is unpaid, so they split 6th between them. This works for any N because unpaid positions simply contribute zero to the pool.
- Two tied GW winners → one prize position, so $15 becomes $7.50 each.

It also conserves the pot by construction, which paying each tied manager in full does not.

**Detect ties on `rank`, never on `rank_sort`.** The FPL API gives genuinely tied managers the *same* `rank`, and uses `rank_sort` to impose an arbitrary but stable total order. Ordering by `rank_sort` makes a tie look resolved and silently awards one manager the larger prize. `rank_sort` is only appropriate for deciding where a sub-cent rounding remainder lands.

**Other leagues' tie-breakers are out of scope, with an escape hatch.** Real leagues break end-of-season ties on things the API doesn't expose consistently (fewest transfers, head-to-head, bench points), so encoding them is open-ended. v1 instead lets an owner **manually override final positions** at season end, which covers any league rule without modelling any of them. Configurable tie-break policies are on the ROADMAP.

Note this design tracks **who won what**, not whether money changed hands. Marking a prize as actually paid out is deliberately deferred (see ROADMAP) — dues coming *in* are tracked, prizes going *out* are computed.

## Endpoint reference

Verified against live calls on 2026-08-03 (pre-season), then re-checked through GW1 and **confirmed against a finished gameweek on 2026-08-25**. ✅ = confirmed live. Every ⚠️ here has now been cleared: the element fields no longer trace to a typed community client (`jeppe-smith/fpl-api`), which was wrong in two places where it mattered — see `standings.results[]` below.

| Endpoint | Fields used |
|---|---|
| `bootstrap-static/` ✅ | `events[]` (38): `id`, `name`, `finished`, `data_checked`, `deadline_time`, `average_entry_score` (**global**, not league). Also present: `release_time`, `ranked_count`, `is_current`, `is_next`, `is_previous`, `highest_scoring_entry` |
| `event-status/` ✅ | `{ status: [], leagues: "" }` pre-season; during and after a gameweek, one `status` row per match day — `{bonus_added, date, event, points}`. `leagues` is three-valued: `"Updating"` while a gameweek is recalculating, `"Updated"` once final (**confirmed 2026-08-25**, the send gate's required value), and `""` otherwise — which is *not* only pre-season, it was `""` throughout a live GW1 with every manager scored. `bonus_added` stayed `false` for three days while scores were visible, then all four rows flipped `true` together with `finished`, `data_checked` and `leagues`. That lag is exactly the gap the gate exists to cover; it was worth ~0.8 points per manager here. `points` tracks it per day: `""` → `"p"` → `"r"` |
| `leagues-classic/{id}/standings/` ✅ | Top level: `league`, `standings`, `new_entries`, `last_updated_data`. `league` ✅: `id`, `name`, `created`, `closed`, `start_event`, `league_type` (`x` = private), `scoring` (`c` = classic), `admin_entry`. `standings`: `has_next`, `page`, `results[]` ✅ envelope. `new_entries.results[]` ✅: `entry`, `entry_name`, `joined_time`, `player_first_name`, `player_last_name`. `standings.results[]` ✅ (2026-08-21, stable through 08-25): `entry`, `entry_name`, `player_name`, `rank`, `last_rank`, `rank_sort`, `total`, `event_total`, plus an undocumented **`club_badge_src`** (null for every manager here). The community client was wrong twice: it declares an `id` that is never sent, and omits `club_badge_src`. Nothing read `id`, so nothing broke — but it is why this table no longer cites it. `last_rank` is `0` for everyone after GW1, meaning "no previous rank", not a climb from zero |
| `entry/{id}/history` ✅ | Top level `current`, `past`, `chips` ✅. `past[]` ✅: `season_name`, `total_points`, `rank`, `rank_percentage` (7 seasons on the manager sampled). `current[]` ✅ (2026-08-21): every field the capture job maps — `event`, `points`, `rank`, `total_points`, `points_on_bench`, `event_transfers_cost`, `overall_rank` — plus `rank_sort`, `percentile_rank`, `overall_rank_percentage`, `bank`, `value`, `event_transfers`, which we do not use |

**`new_entries` is an object, not an array.** It carries the same pagination envelope as standings — `{ has_next, page, results }` — so it must be read as `new_entries.results` and paginated in its own right. (Corrected from the initial research, which had it as a bare `new_entries[]`.)

**`new_entries` and `standings` have different element shapes.** Observed live on league 9999999 pre-season: 0 standings rows, 14 new entries. Combining them is a *normalisation*, not a union:

| | `standings.results[]` | `new_entries.results[]` |
|---|---|---|
| Name | `player_name` | `player_first_name` + `player_last_name` |
| Score fields | `total`, `event_total`, `rank`, `last_rank` | none |
| Also | `entry`, `entry_name` | `entry`, `entry_name`, `joined_time` |

So the digest needs an internal manager type that both map into, and a defined way to render a manager with **no scores yet** — before GW1 the entire league is in this state. Deduplicate on `entry`: a manager can plausibly appear in both during the GW that processes them.

Two further traps in that table:
- **`average_entry_score` is the global FPL average.** The league average must be computed as the mean of `event_total` across results. Substituting it is an invisible bug.
- **`standings.results` is paginated** (`has_next`, `?page_standings=N`) and **`new_entries.results` holds managers absent from standings** until the next GW processes. Both must be handled for the digest to list everyone.
- **`event-status` returns `status: []` outside a live gameweek.** `[].every(...)` is vacuously `true`, so the readiness check must require `status.length > 0` before evaluating `bonus_added` at all.

## Gameweek-ready state machine

```
 polling ──> events[gw].finished ─────────> not yet safe (bonus pending)
              │
              └─> event-status: status.length > 0        <- guard: [] is
                  AND every status[].bonus_added === true    vacuously true
                  AND leagues === "Updated"
                  AND events[gw].data_checked
                      │
                      v
                  compute ──> digests row ──> composer
                                                  │
                    WhatsApp ──> owner taps ──────┤──> (optional) sent_at
                                                  │      (null = unknown, not failed)
                    Email ──> owner clicks Send ──┘──> deliveries: sent | failed
```

The two channels are asymmetric on purpose. WhatsApp leaves the app entirely, so a
send is only ever the owner's assertion. Email goes out from the server, so the
provider tells us whether it was accepted — `deliveries` records `sent` or `failed`
per `(league_id, gameweek, kind)`, and a `failed` row means nothing arrived and a
retry is safe.

## History capture

`POST /api/jobs/capture-history` snapshots `entry/{id}/history` → `current[]` for every manager **of every league**, and upserts `managers` from the same standings fetch.

**The run is gated once, then loops leagues.** `bootstrap-static` and `event-status` are global — they say nothing about a particular league — so `gameweekGate` is asked once per run, and a run that finds no settled gameweek returns having made exactly two FPL calls, whatever the league count. Only when it opens does the run pay per-league: one standings call plus one history call per manager, roughly 20 for an 18-manager league.

That split is what makes many leagues affordable against an API that blocks on reputation. Ten leagues cost ~192 calls a week idling and ~200 on the one run that captures, rather than ~1,150 idling if every poll refreshed every roster.

Three consequences of the loop, each a decision rather than a fallout:

- **A skipped poll refreshes no rosters.** `upsertManagers` now runs only on a capturing run, off the standings call that run needed anyway. So a manager who joins mid-week reaches the `managers` table when the gameweek settles, not within the hour. Nothing user-facing reads that table — every page builds its roster live from standings — and its job is to record who was in the league at capture time, which is when it is now written.
- **A wall-clock budget (`RUN_BUDGET_MS`, 2 minutes) stops the run starting new leagues**, so a slow FPL cannot produce an unbounded run that overlaps the next hourly firing. Work already started always finishes; a league never reached is reported `deferred` and picked up by the next poll. This is safe only because a partial capture is already self-healing, and leagues are ordered oldest-first so a throwaway test league never costs the established one its place.
- **A block aborts the whole run.** `FplBlockedError` is per-IP, not per-league — confirmed on 2026-09-01 when all four endpoints refused this host at once — so the remaining leagues would fail identically and continuing would hammer an API that is already refusing us. Rows collected before the block are saved.

**What "healthy" means with many leagues:** any league erroring makes the run an error, which is a non-2xx and therefore a failed Sentry check-in. Nine successes must not hide the tenth league quietly losing history that cannot be backfilled once a manager leaves. A `deferred` league is not a failure — the next poll takes it.

- **Bearer-token guarded** on `JOBS_TOKEN`, and **fails closed**: an unset variable rejects every request rather than leaving the endpoint open. Production must have it set or the job cannot run at all.
- **Sequential, one manager at a time.** Not a performance oversight — 18 parallel requests from a shared Railway egress IP is the traffic shape most likely to attract the Cloudflare block described above.
- **A block aborts the run**; anything already collected is saved first, and the response says how much. Other per-manager errors are collected and reported without losing the rest.
- **Stores every gameweek `current[]` returns**, so a skipped run backfills on the next one.
- **Rows are upserted on `(league_id, entry, gameweek)`**, so a gameweek captured before bonus points landed is corrected by a later run rather than duplicated.
- **Malformed gameweeks are dropped, never defaulted.** A missing `points` stored as `0` is indistinguishable from a real zero; the response lists what was dropped so the loss is visible.

Deliberately a job route rather than page-render work: it makes one FPL call per manager, which has no business adding latency to the composer or breaking it when the API is flaky.

**Scheduling.** A Railway cron service runs `npm run job:capture` (`scripts/capture-history.mts`), which POSTs this route with the bearer token — Railway cron runs commands, not URLs, so the script is a shim and holds no logic.

**Schedule `0 * * * 0-3` (UTC)** — hourly, Sunday through Wednesday. 96 runs a week.

It was `*/40 * * * *` until 2026-08-25, described here as "every 40 minutes". **It was not.** A step in the minute field restarts each hour, so `*/40` fires at :00 and :40 only — gaps of 40 minutes, then 20, and **48 runs a day rather than the 36 this document and GW1-VERIFICATION §7 both assumed**. The live logs read `12:40, 13:00, 13:41, 14:00`, which is the tell.

Why hourly is enough: nothing waits on this job inside an hour. The composer and the send gate read the FPL API live and never touch captured history — that data feeds the Phase 4 stats — and a partial capture is picked up by the next poll regardless.

Why Sunday–Wednesday rather than the Monday–Tuesday actually observed: GW1 2026/27 settled Tuesday morning UTC (still provisional at 24 Aug 23:54Z, captured 12:40Z on the 25th), and an ordinary Sat–Sun gameweek should settle Monday. But December carries midweek gameweeks and blank/double gameweeks move the settling day around, so Wednesday is cheap insurance against the weeks that do not look like this one.

**Why not tighter still**, e.g. a single weekly firing: that is only safe if a missed window self-heals, which depends on whether `history.current[]` returns the whole season or only recent gameweeks.

**Answered on 2026-09-01: it is cumulative.** The GW2 run returned `gameweeksSeen: [1,2]`, 34 rows for 17 managers, re-supplying GW1 alongside GW2 — and it did so recovering a *real* missed window, the Cloudflare block of the same day, rather than a simulated one. So a missed poll costs nothing and the cadence could in principle drop to roughly `0 12 * * 2`.

Two reasons it has not: `[1,2]` at GW2 rules out "latest only" but cannot yet separate "the whole season" from a rolling window of N ≥ 2, and hourly polling is cheap now that a skipped run is two calls regardless of league count. Revisit if the call volume ever argues for it.

Still unmeasured either way: what a scheduled firing actually costs in compute time. §7 has it.

**Cron service configuration**, since it lives in the Railway dashboard rather than the repo. The service is **`cron-capture-history`**: separate from the web app (`fphelp-app`), same GitHub repo, no public domain.

Named for the job rather than for the project, which is already the namespace. Phase 3's deadline reminders will be a second scheduled job, and a generic `cron` or `jobs` becomes ambiguous the moment that lands — a per-job name means the dashboard says which one is failing. Nothing resolves this service by name, since the script reaches the app through `APP_URL`, so it can be renamed freely; `fphelp-app` cannot, because its name is baked into the `railway ssh` / `railway logs` commands throughout these docs.

Its configuration:

- **Build command `npm ci`.** Load-bearing. Railpack otherwise detects Next.js and runs `next build`, whose page-data collection imports every route module — including this one, which reaches `src/db/index.ts` where the pool is created at module scope. The build then fails on a missing `DATABASE_URL`, with an error that points at the route rather than at the build command that shouldn't have run.
- **Start command `npm run job:capture`.** Without it Railpack starts `next start`, which never exits, and Railway skips any cron firing whose previous run is still going — so the job would run exactly once, ever.
- **`DATABASE_URL`**, even though the script never touches Postgres. `railway.json` sets `preDeployCommand` repo-wide, so this service runs the migrations too; both steps are idempotent. The tidier alternative — moving the pre-deploy command out of committed config and into per-service dashboard state — was rejected as a worse trade.
- **`APP_URL` and `JOBS_TOKEN`.** `APP_URL` may omit the scheme: Railway's own `RAILWAY_PUBLIC_DOMAIN` is a bare hostname, which `fetch` rejects outright, so the script assumes https when none is given.

**Known coupling:** `DATABASE_URL` is a *build-time* requirement for the app, not just a runtime one — the eager pool above plus `DrizzleAdapter(db, …)` at module scope in `src/auth.ts`. It doesn't affect the web service, which has the variable, but it will break any CI build or fresh environment without a database attached. Making it genuinely lazy needs the NextAuth setup restructured; a `Proxy` over `db` alone is not enough, because the adapter inspects the object on import.

**What a poll costs.** `gameweekGate` (`src/lib/fpl/capture.ts`) decides from two cheap calls — `bootstrap-static` and `event-status` — whether to touch any league at all, and `captureDecision` adds the per-league half: is this gameweek already stored for every manager here? So the weekly cost is one real capture and ~95 polls that make two calls and stop. `?force=1` re-captures a stored gameweek, for backfills; it does **not** bypass readiness, because `finished` flips before bonus points apply and forcing past the gate would be a one-keystroke way to store pre-bonus scores that look entirely plausible.

Completeness is measured as *distinct entries stored for that gameweek* against the roster size, not a "captured" flag. A run that lost two managers to a flaky API is therefore retried by the next poll automatically. A departed manager keeps their rows, so the comparison is `>=` — otherwise a shrinking roster would stall the poll into re-capturing forever.

**Where the gate runs.** In both places, deliberately: the cron calls `isGameweekReady` via `captureDecision` before capturing, and `/send` enforces it again on render, before any stats are computed or any `digests` row is written. An unready gameweek blocks the composer outright rather than warning, because once the owner taps through to WhatsApp a wrong table is unrecoverable.

Two states bypass the render-time gate deliberately: `?demo=` (synthetic data, exists to test the length budget) and **pre-season**, where no gameweek has finished at all — nobody has scored, so there are no stale numbers to render and the score-less roster is the correct output.

## Deep-link construction

```
whatsapp://send?text=<urlencoded digest>      # primary, mobile
https://wa.me/?text=<urlencoded digest>       # https fallback
```

Rules, all of them failure modes rather than style:
- **Never include a phone number.** `wa.me/<number>?text=` opens that individual chat and makes groups unreachable, while still looking like a working link.
- URL-encode the whole payload; newlines become `%0A`, so table padding costs real budget.
- Target **~1,500 characters encoded**, with a defined truncation strategy for large leagues.
- Always offer **copy-to-clipboard** as a fallback for desktop or a failed scheme handler.

## Egress and Cloudflare

The FPL API sits behind Cloudflare and rejects many datacenter IPs.

**⚠️ This stopped being hypothetical on 2026-09-01: production lost all FPL access, for something on the order of half a day.** The section below is the record, because the shape of the failure is the useful part.

**✅ Verified reachable from Railway on 2026-08-05.** All four endpoints returned `200` with `application/json` from a deployed container (egress IP `13.56.136.98`, region `us-west2`), via the temporary `/api/egress-check` route. Content type matters here: a Cloudflare block serves an HTML challenge page, so JSON confirms a genuine pass rather than a soft failure.

**❌ Blocked on 2026-09-01, from egress IP `152.55.176.146`.** All four endpoints returned `403` in ~40ms with **zero bytes and no content-type** — an edge rejection, not the HTML challenge page anticipated above and not a timeout. Stable across repeated samples minutes apart, so not a rate limit either.

**✅ Recovered the same day by redeploying**, which brought the container up on `152.55.177.118`; all four endpoints returned `200` with `application/json` within two minutes.

**✅ Still reachable after the next deploy**, later the same day, from `162.220.232.8` — a **different `/16` again**.

**✅ And after every deploy since**, through 2026-09-09: `152.55.177.10`, then `13.52.96.11` — the latter back in the same AWS range family as the August address. **Six addresses observed, one per container, one of them blocked.** Five consecutive good draws after the bad one is more consistent with one unlucky address than with anything systematic about Railway.

Five things that record is worth keeping for:

- **The egress address changes on every deploy, and reputation follows the address rather than the range.** The blocked and recovered addresses were 228 apart in one `/16`, which briefly looked like a single NAT pool being scored address by address — then the next deploy landed in `162.220.0.0/16` instead, so the pool is wider than that and spans ranges. What every sample agrees on is the part that matters: **a redeploy is a reroll, not a fix.** It cleared the block in two minutes and buys nothing durable, because the next deploy draws again and can land on a bad address with no code change involved. Do not read any range as safe or unsafe — `13.x` has now appeared on both sides of the block, months apart. The data supports "it moves" and nothing finer.
- **It began with a redeploy, not with a code change.** The trigger was merging a docs-only PR (`.gitignore` plus two markdown files), which redeployed both services; the app came back on a different egress IP than the one verified in August. Strictly this is inference — the egress IP from the hour before that merge was never captured, so what is *proven* is that the two recorded IPs differ and that the failures start there. It is still the reading to reach for first, because this is the failure mode that looks most like "the last change broke it" and is least related to it. **Suspect the IP before the diff.**
- **`/api/egress-check` is what made this a ten-minute diagnosis.** It was described in its own header as temporary, to be deleted "once the answer is settled". The answer is not settled and this event is the argument for keeping it: it separates "blocked" from "FPL is down" from "our code broke" in one request, from outside, with no deploy. **It is token-guarded as of 2026-09-07**, on the same `JOBS_TOKEN` as the capture job — it was open until the app was about to be linked publicly, and an open version discloses the egress IP and lets a stranger make this server fire four FPL requests per call, which is a lever on the very reputation that decides whether the app works. Call it with `-H "authorization: Bearer $JOBS_TOKEN"`.
- **The build is green throughout.** Nothing in the build calls FPL, so a total loss of API access is invisible to the deploy and to Railway's health reporting.
- **Only the cron went red, and the web app was equally dead.** `cron-capture-history` exits non-zero on a failed capture, so it was the alarm — but every page that fetches FPL was showing "Couldn't reach the FPL API" for the whole of it, while the service reported healthy. **A blocked app is currently only detectable through the cron.** If the cron is ever made resilient to this, something else has to notice.

Two reasons this is not a closed question:

- **Reputation moves on its own.** Cloudflare decisions are reputation-based and change without notice, and Railway's egress IP is shared, not contractually stable, and now demonstrably re-rolled on deploy. Expect recurrence.
- **The mitigation stays documented, and is conditional rather than owed.** Route FPL calls through an egress proxy with a stable, well-reputed IP. Changing host does not help — Fly.io is datacenter IPs too.

**On the urgency, which this document overstated for a week.** The "owed work" framing was written on 2026-09-01 with the block fresh and the arithmetic from *before* phase B: roughly 20 calls per league per run, ~180 a window at ten leagues. Phase B then moved the gate in front of the league loop, so a poll with no settled gameweek costs **two** FPL calls whatever the league count. Ten leagues idle at ~192 calls a week rather than ~1,150, and the remaining exposure is one capturing run a week. At the current two leagues that is a polite volume, and the block was more plausibly a neighbour's doing than ours.

Two further things the proxy is not: a cheap VPS is **still a datacentre IP**, so the win is *dedicated instead of shared* rather than *trusted* — and it adds a single point of failure to a path that today self-heals on redeploy. Residential proxying is the genuinely-trusted option and is not appropriate here.

**Build it when either of these happens**, and not before:

- **A block that recurs after a redeploy.** That means the reputation is following our traffic rather than the address, which is the only reading the reroll cannot fix.
- **Enough leagues that a capturing run is hundreds of calls.** The gate bounds the idle rate, not the working one, and that scales linearly with leagues.

Until then the mitigations that exist are the right size: the gate keeps idle volume at two calls a poll, `FplBlockedError` fails loudly rather than retrying into a wall, and `/api/egress-check` answers "is it us or the address" in one request.

The FPL client should treat a sudden run of `403`s, or an HTML content type where JSON is expected, as *the block has started* rather than as a transient error — and surface it loudly instead of retrying into a wall.

This still drives hosting: serverless platforms with rotating shared egress IPs are a poor fit, so the app runs as a **persistent Railway container** with a stable egress IP. If Railway's IPs are blocked, the mitigation is an **egress proxy**, not a different host — Fly.io and Railway are both datacenter IPs, so a block hits either.

## Monitoring

**What is worth monitoring here is not what is usually worth monitoring.** One owner opens this app roughly once a week to write a digest; if it is down on a Thursday afternoon, nobody — including the owner — finds out or cares. Uptime is close to a non-question. The failures that matter are silent, server-side, and would otherwise surface weeks later:

| Failure | Caught by |
| --- | --- |
| Cloudflare starts blocking Railway's egress (`FplBlockedError`) | Sentry, via `onRequestError` or the cron's `captureException` |
| A digest half-sends through Resend | Sentry (the Server Action throws) |
| A database error inside `/setup` or `/send` | Sentry, via `onRequestError` |
| **The cron silently stops firing** | Sentry Crons check-in |
| FPL changes an endpoint's shape | `recorded.test.ts`, not monitoring — it fails `npm test` |

**Sentry is optional by construction.** With no `SENTRY_DSN` the SDK never initialises and every call is a no-op, so a fresh clone, `npm test` and the Playwright suite need no configuration and send nothing. `next.config.ts` only applies `withSentryConfig` when `SENTRY_AUTH_TOKEN` is set, so a build without credentials is unaffected. A monitoring tool that can break the build or the boot has made things worse, not better.

Node only: there is no middleware, no route opts into the edge runtime, and **no client SDK is installed**, so the browser bundle is unchanged and there is no public DSN to manage. Add `sentry.edge.config.ts` / `instrumentation-client.ts` if that changes.

`tracesSampleRate` is `0` and `sendDefaultPii` is `false`. Traces are what consume a free-tier quota and there is no latency question worth sampling at this volume; PII is off because a Server Action payload can carry the digest text and the league's recipient addresses, which have no business in a third-party error tracker for members who never signed up to anything.

**Cron check-ins, and why the monitor's schedule lives in the repo.** `scripts/capture-history.mts` opens a check-in before the POST and closes it `ok` or `error` after, upserting the monitor's config as it goes — including the crontab `0 * * * 0-3`. That last part is what makes the narrowed schedule safe: a fixed-interval heartbeat ("expect a ping hourly") would alarm every Thursday through Saturday, when the job deliberately does not run. Giving Sentry the same cron expression means it expects the silence. **If the Railway schedule changes, change `monitorConfig` too** — a monitor that disagrees with reality trains you to ignore it.

A skipped poll checks in as `ok`, deliberately. Roughly 95 of every 96 weekly runs are skips; reporting those as failures would be an alert that cries wolf, which is worse than no alert.

**Configuration.** Only two variables, both set in Railway and required only in production:

| Variable | `fphelp-app` | `cron-capture-history` | Purpose |
| --- | --- | --- | --- |
| `SENTRY_DSN` | ✅ | ✅ | Turns the SDK on. The cron needs its own copy or check-ins never happen |
| `SENTRY_ENVIRONMENT` | ✅ | ✅ | `production`. Falls back to `NODE_ENV`, which is right on Railway but implicit |
| `SENTRY_AUTH_TOKEN` | ✅ | — | Source-map upload only. The cron runs no build |

The org (`theapps`) and project (`fphelp`) are **literals in `next.config.ts`**, not environment variables. Neither is a secret — both appear in every Sentry URL — and hardcoding them means the file says where errors go rather than that answer living in a dashboard. The token is the only real credential, and it is the only thing left in the environment. Note the DSN is deliberately **not** `NEXT_PUBLIC_SENTRY_DSN`: that prefix exists to inline a DSN into the browser bundle, and there is no client SDK here.

A bad or missing auth token degrades to unreadable stack traces; it does not fail the deploy — verified locally against a bogus token. The same is true of a stale project slug, which is the failure to watch for if the project is ever renamed in Sentry: the DSN keeps working, because it is keyed on the numeric project ID, so source maps stop uploading in silence.

**What is deliberately not here.** UptimeRobot answers a question this app does not have, though it costs nothing to keep. Postgres triggers with `LISTEN`/`NOTIFY` to alert on row inserts were considered and rejected: they need a persistent listener, which is another always-on service that can itself die silently. The app already knows when it writes a `messages` or `deliveries` row, and has context the row does not — so notifications belong on the write path, not in the database.

## Testing strategy

- **Vitest — digest computation.** Highest value, because the logic is pure functions over fetched JSON and the bugs are silent-wrong-number bugs, not crashes. Cover: league average from `event_total` (never `average_entry_score`), rank movement from `last_rank`, GW winner, riser/faller, pagination assembly across `has_next`, `standings ∪ new_entries` roster completeness, prize splits summing to the entered pot. Driven by **recorded fixtures** of real payloads, which double as a change detector against an unofficial API.
- **Playwright — owner flows.** Setup wizard, dashboard, manual send, and above all the send page. Critical assertion: the WhatsApp href starts with `whatsapp://send?text=` (or `https://wa.me/?text=`), contains **no phone number**, and its decoded payload round-trips to the expected digest within the length budget. Also assert the clipboard fallback, and test the mobile viewport, since that's the only place the deep link is real.

  **Stubbing is server-side, not route interception.** Every page fetches FPL while rendering, so a browser-level `page.route()` never sees those requests — there is nothing to intercept. `FPL_FIXTURES=1` swaps the client's injected `fetchImpl` instead (`src/lib/fpl/fixtures.ts`), which is also why the fixture league is 18 managers across two pages: a one-page fixture would let a regression in the `has_next` assembly pass.

  Three consequences of the harness worth knowing before extending it, all in `playwright.config.ts` and `e2e/support/`:
  - **A production build, not `next dev`.** Next 16 permits one dev server per directory, so a suite running `next dev` would fail whenever the developer has theirs up. Output goes to `.next-e2e` so the two never collide.
  - **Sessions are inserted directly.** Sign-in is a magic link; the suite writes the `sessions` row the adapter would have and sets the cookie. The cost is that **sign-in itself is never exercised** — that needs its own test driving the link end to end.
  - **The suite truncates every table**, so `e2e/support/db-url.ts` refuses any database that is not named `fphelp_e2e` *and* on a local host. Two conditions, because the name alone would admit a remote database that happened to match, and this is destructive work on data — `digests` and `sent_text` hold the owner's own writing and cannot be recovered from the API. No override: an escape hatch on this guard is the kind that gets set once and then lives in a shell profile.

Not testable: whether the owner actually sent the message inside WhatsApp. That's the boundary the delivery-state design accounts for.

## Decisions & rationale

**Webapp, not native.** Setup happens once; after that the system runs server-side and the content lands in email/WhatsApp. Nothing about the owner's workflow needs device-native capabilities, and native would add app-store review cycles for a project still validating with a handful of testers.

**Next.js.** Already in use on other projects. API routes plus UI in one deployable keeps the surface small.

**Postgres on Railway, not Supabase/Neon.** Railway is already in use. At this scale a plain Postgres instance is a plain Postgres instance — Supabase's and Neon's differentiators (built-in auth/storage, branching) aren't needed, and adding a vendor costs more than it saves. Neon's branching and scale-to-zero are structurally wasted here: the Cloudflare constraint already forces an always-on container, and per-preview DB branches are a team-workflow luxury for a solo one-league project. The one thing Neon would have given free is point-in-time restore, so **verify Railway backups are enabled** as an explicit setup step.

**Magic-link auth.** Keeps users and sessions in the Postgres we already own, with no external auth vendor, and sidesteps password-reset flows. It also does double duty: the emailed link is the same one that opens the mobile send page, so the owner's whole weekly interaction is one tap from their inbox.

**Everything on Railway, not Vercel.** A Vercel/Railway split is the more common Next.js default, but serverless is actively wrong here — rotating shared egress IPs collide with Cloudflare's datacenter blocking. Railway also gives one dashboard and one bill, and the cron needs a long-running home anyway. Not Fly.io either: its advantages (multi-region anycast, dedicated IPv4, scale-to-zero Machines) are irrelevant to a single-region cron app with one user, and it doesn't hedge the Cloudflare risk any better.

**Polling for gameweek completion, gated on `event-status`.** FPL has no webhooks. The obvious trigger — `events[].finished` + `data_checked` — fires **too early**: `finished` flips before bonus points are applied, and league tables recalculate on a separate schedule, so a digest can go out with stale standings. Gate on `event-status` instead (all `bonus_added`, `leagues === "Updated"`), cross-checked against `data_checked`. Polling every 30-60 minutes is ample given gameweeks resolve weekly.

**Idempotent preparation.** Cron polling and any scheduled/manual send can both reach the prepare step. The `deliveries` unique constraint on `(league_id, gameweek, kind)` makes double-preparation impossible at the database level rather than by careful control flow.

**Caching `bootstrap-static`.** It's large and changes rarely within a week (fixtures, deadlines, prices). A short TTL keeps request volume low and means a transient FPL outage doesn't immediately break a digest.

**Two channels, asymmetric by nature.** WhatsApp needs no recipient data — the group exists and the deep link addresses nothing — but requires a tap on the owner's phone. Email can be sent fully server-side but needs an address list the FPL API cannot provide, so the owner must enter and maintain one. Neither dominates: WhatsApp is zero-setup but manual, email is setup-heavy but automatable. WhatsApp is the default; email is opt-in per league.

**Railway is the only vendor choice here.** Cloudflare appears throughout these docs as a *constraint*, not a component — it fronts the FPL API and filters datacenter IPs. Nothing in this system is deployed to or bought from Cloudflare.

**WhatsApp via deep link, not the Cloud API.** Group sending on the Cloud API requires Official Business Account status, unavailable to a private hobby tool, and business-initiated 1:1 messages need pre-approved templates plus per-conversation cost. The deep link avoids all of it at the cost of one owner tap — and the owner was already posting manually, so this strictly improves their workflow. Email stays fully automated and first-class for owners who prefer it.

**Owner-entered pot total, not headcount × fee.** Deriving the pot from `standings.results` count would silently undercount past 50 managers (pagination) and at season start (`new_entries`). Having the owner type the total deletes both failure modes rather than working around them. Pagination and `new_entries` still matter for the standings table itself.

**Capture manager history from GW 1.** The narrative stats ship last (Phase 4), but `entry/{id}/history` cannot be backfilled for managers who join mid-season. Snapshotting ~20 calls per GW from the start turns those stats into pure queries later. This is an ordering constraint, not a feature.

## Deferred

Not in the MVP; see [ROADMAP.md](./ROADMAP.md) for the full list.

- **WhatsApp Business Cloud API automation** — replaces the owner's tap; gated on Official Business Account status
- **Per-manager paid tracking** — start-of-season, non-recurring
- **Member-facing auth** — only needed once members get personal recaps, polls, or a login
- **Multi-league support** — the `league_users` join table already permits one user across several leagues; deferred work is UI (league switcher) and scoping every query, not schema
- **Multi-season support** — season rollover resets league and entry IDs
- **H2H leagues** — different standings model; classic only for now
- **Other fantasy platforms** — would require abstracting the FPL client into a per-platform data-fetch interface
