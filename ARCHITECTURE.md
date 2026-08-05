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
| Email delivery | Resend + React Email | One template renders the HTML email **and** the plaintext WhatsApp payload |
| WhatsApp delivery | Deep link (`whatsapp://send?text=`) | Owner taps; no phone number in the URL |
| Unit tests | Vitest + recorded API fixtures | The API is unofficial and shifts between seasons |
| UI tests | Playwright | Owner flows, especially deep-link construction |

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
[Railway cron]  --every 30-60min-->  poll event-status:
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

## Data model

**Naming, because "manager" is overloaded.** FPL calls a league participant a *manager* (the API calls one an `entry`). We also have people who *administer* a league in this app. Those are different populations — an admin may not even play in the league. Throughout the schema and code:

- **`users`** — people with a login to this app (admins/co-owners)
- **`managers`** — FPL entries competing in the league; they never log in

| Table | Purpose |
|---|---|
| `users` | app accounts: email, magic-link identity |
| `leagues` | league id, name, `start_event`, `pot_total`, `currency`, optional display-only entry fee |
| `league_users` | **join table**: `(league_id, user_id, role)`, unique on `(league_id, user_id)` |
| `managers` | FPL entries: `entry`, `entry_name`, `player_name`, league membership |
| `manager_gw_history` | one row per manager per GW, snapshotted from `entry/{id}/history` → `current[]` |
| `prize_rules` | one row per rule: `kind`, optional `rank`, optional `gameweek`, `value`. Set once at league setup |
| `dues` | per manager: `amount`, `paid`, `paid_at`, `note` |
| `winnings` | ledger: `manager_entry`, `rule_kind`, `gameweek`, `amount`, `status` (`provisional` \| `final`) |
| `digests` | computed digest per league per GW: stored payload, both rendered forms |
| `deliveries` | `kind`, `prepared_by`, `prepared_at`, `sent_at`, `marked_sent_by`; **unique on `(league_id, gameweek, kind)`** |

The `deliveries` unique constraint is load-bearing: polling plus a scheduled send would otherwise double-prepare. `sent_at` null means *unknown*, not failure — the send happens inside WhatsApp and is unobservable.

**Co-ownership.** `league_users` is many-to-many in both directions from day one. That covers the immediate need — this league has two people administering it — and the same table covers one user running several leagues later, with no migration. Only the UI and scoping change.

Two consequences the digest pipeline has to respect:

- **A digest is prepared once per league, not once per admin.** The `(league_id, gameweek, kind)` constraint already enforces this, and it must not gain a `user_id` — otherwise two co-owners each get a digest prepared and the league gets the message twice. Notification fan-out is separate: *every* co-owner may be emailed, but they share one prepared digest and one delivery row.
- **"Marked as sent" is shared state.** When one co-owner sends, the other must see that. Record `marked_sent_by` so the UI can say *who* sent it, and surface it to both — otherwise the second co-owner sends a duplicate to the group. This is the main new failure mode co-ownership introduces.

`role` is recorded (`communicator`, `treasurer`) but **carries no permission logic in v1** — every owner can do everything. It exists so that role-based access later is an enum-and-policy change rather than a schema migration.

## Prize rules and the winnings ledger

Prizes are configured once at league setup and then computed, never hand-entered. Three rule kinds cover the reference league:

| `kind` | When | Value |
|---|---|---|
| `gw_winner_fixed` | every gameweek | fixed amount to that GW's top `event_total` |
| `season_best_gw_fixed` | season end | fixed amount to the single highest `event_total` of the season |
| `season_rank_pct` | season end | percentage to each of the top N final ranks (N = 6 here) |

**Fixed amounts come off the top; percentages apply to the remainder.** This is the one piece of arithmetic that must not be got wrong:

```
committed_fixed = (gw_winner_amount × number_of_gameweeks)
                + season_best_gw_amount
remainder       = pot_total − committed_fixed
rank prizes     = season_rank_pct[i] × remainder
```

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

Applying the percentages to `pot_total` instead over-commits the pot, and the shortfall only surfaces at season end when the treasurer pays out. Two validations belong in setup, not in a test:

- `committed_fixed ≤ pot_total`, with the remainder shown live as the owner types
- `season_rank_pct` values sum to exactly 100% (of the remainder)

Because managers keep joining early in the season, `pot_total` is editable and both validations must re-run on every edit — not only at first setup.

**Provisional vs final.** GW-winner amounts are known and `final` the moment a gameweek is scored, and accrue into `winnings` as the season runs. Rank and best-GW prizes are `provisional` until the last gameweek is scored — displayed as standings-based projections, recomputed each GW, and only frozen at season end. The ledger must never present a provisional figure as settled.

## Ties

Ties will happen, most often on `gw_winner_fixed`. The default policy is **pool and split**:

> N managers tied at rank R occupy positions R … R+N−1. Sum the prizes attached to those positions and divide equally between them.

This single rule covers both cases naturally:
- Two tied for 1st → pool 1st + 2nd, split evenly; the next manager takes 3rd.
- Two tied for 6th → positions 6 and 7; 7th is worth nothing, so they split 6th between them.
- Two tied GW winners → one prize position, so $15 becomes $7.50 each.

It also conserves the pot by construction, which paying each tied manager in full does not.

**Detect ties on `rank`, never on `rank_sort`.** The FPL API gives genuinely tied managers the *same* `rank`, and uses `rank_sort` to impose an arbitrary but stable total order. Ordering by `rank_sort` makes a tie look resolved and silently awards one manager the larger prize. `rank_sort` is only appropriate for deciding where a sub-cent rounding remainder lands.

**Other leagues' tie-breakers are out of scope, with an escape hatch.** Real leagues break end-of-season ties on things the API doesn't expose consistently (fewest transfers, head-to-head, bench points), so encoding them is open-ended. v1 instead lets an owner **manually override final positions** at season end, which covers any league rule without modelling any of them. Configurable tie-break policies are on the ROADMAP.

Note this design tracks **who won what**, not whether money changed hands. Marking a prize as actually paid out is deliberately deferred (see ROADMAP) — dues coming *in* are tracked, prizes going *out* are computed.

## Endpoint reference

Verified against live calls on 2026-08-03, **pre-season** for 2026/27 (GW1 deadline 2026-08-21). ✅ = confirmed live. ⚠️ = container confirmed but the collection was empty pre-season, so element fields still trace only to a typed community client (`jeppe-smith/fpl-api`) and need re-checking once GW1 completes.

| Endpoint | Fields used |
|---|---|
| `bootstrap-static/` ✅ | `events[]` (38): `id`, `name`, `finished`, `data_checked`, `deadline_time`, `average_entry_score` (**global**, not league). Also present: `release_time`, `ranked_count`, `is_current`, `is_next`, `is_previous`, `highest_scoring_entry` |
| `event-status/` ⚠️ | `{ status: [], leagues: "" }` pre-season. Envelope confirmed; `status[].bonus_added` and the `leagues === "Updated"` string are **not yet observed** |
| `leagues-classic/{id}/standings/` ⚠️ | Top level: `league`, `standings`, `new_entries`, `last_updated_data`. `league` ✅: `id`, `name`, `created`, `closed`, `start_event`, `league_type` (`x` = private), `scoring` (`c` = classic), `admin_entry`. `standings`: `has_next`, `page`, `results[]` ✅ envelope. `new_entries.results[]` ✅: `entry`, `entry_name`, `joined_time`, `player_first_name`, `player_last_name`. `standings.results[]` elements still unobserved: `entry`, `entry_name`, `player_name`, `rank`, `last_rank`, `rank_sort`, `total`, `event_total` |
| `entry/{id}/history` ⚠️ | Top level `current`, `past`, `chips` ✅. `past[]` ✅: `season_name`, `total_points`, `rank`, `rank_percentage`. `current[]` unobserved: `event`, `points`, `rank`, `total_points`, `points_on_bench`, `event_transfers_cost`, `overall_rank` |

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
                  compute ──> digests row ──> deliveries: prepared
                                                  │
                                                  └─> owner taps ──> (optional) sent_at
```

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

The FPL API sits behind Cloudflare and rejects many datacenter IPs. Residential IPs are fine — all four endpoints were fetched successfully from one on 2026-08-03 — so this is specifically a *hosting* risk, and it remains unverified from Railway itself. Confirm it from a deployed container before relying on the scheduler. It drives hosting: serverless platforms with rotating shared egress IPs are a poor fit, so the app runs as a **persistent Railway container** with a stable egress IP. If Railway's IPs are blocked, the mitigation is an **egress proxy**, not a different host — Fly.io and Railway are both datacenter IPs, so a block hits either.

## Testing strategy

- **Vitest — digest computation.** Highest value, because the logic is pure functions over fetched JSON and the bugs are silent-wrong-number bugs, not crashes. Cover: league average from `event_total` (never `average_entry_score`), rank movement from `last_rank`, GW winner, riser/faller, pagination assembly across `has_next`, `standings ∪ new_entries` roster completeness, prize splits summing to the entered pot. Driven by **recorded fixtures** of real payloads, which double as a change detector against an unofficial API.
- **Playwright — owner flows.** Setup wizard, dashboard, manual send, and above all the send page. Critical assertion: the WhatsApp href starts with `whatsapp://send?text=` (or `https://wa.me/?text=`), contains **no phone number**, and its decoded payload round-trips to the expected digest within the length budget. Also assert the clipboard fallback. Stub the FPL API via route interception; test the mobile viewport, since that's the only place the deep link is real.

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
