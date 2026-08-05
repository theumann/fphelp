# FPheLp

Automates a private FPL league owner's group communications — standings, results, money pot — instead of them posting by hand. Owner-only; league members never log in.

See [ROADMAP.md](./ROADMAP.md) for scope and [ARCHITECTURE.md](./ARCHITECTURE.md) for design.

> **Before 21 Aug 2026:** several API shapes are unconfirmed because the season hasn't started — anything marked ⚠️ in ARCHITECTURE.md is taken on trust. When GW1 is scored, work through [docs/GW1-VERIFICATION.md](./docs/GW1-VERIFICATION.md) before writing code that depends on those fields.

## Stack

TypeScript / Node 22, Next.js App Router, Postgres + Drizzle on Railway, Resend for email, Vitest + Playwright.

## Commands

Not yet scaffolded — fill in once `package.json` exists.

## Conventions

- Digest computation is **pure functions over fetched JSON**. Keep fetching, computing, and rendering separate; the computation layer is where the tests live.
- FPL API responses are captured as **recorded fixtures** for tests. The API is unofficial and shifts between seasons — fixtures double as a change detector.
- One template renders both the HTML email and the plaintext WhatsApp payload.

- **"Manager" means an FPL entry** competing in the league (`managers` table). A person who logs in here is an **owner** (`users` + `league_users`). Don't conflate them.

## Gotchas

These are the traps that produce silently wrong output rather than errors:

- **League average must be computed** as the mean of `event_total` across standings results. `events[].average_entry_score` is the *global* FPL average — using it looks fine and is wrong.
- **`standings.results` is paginated.** Follow `has_next` / `?page_standings=N` or managers past 50 vanish from the digest.
- **`new_entries` is an object, not an array** — `{has_next, page, results}`, same envelope as standings, paginated separately. Its managers are invisible in standings until the next GW processes: pre-season the real league had **0 standings rows and 14 new entries**.
- **`new_entries` elements have a different shape** — `player_first_name`/`player_last_name` instead of `player_name`, and no score fields at all. Normalise both into one internal type, dedupe on `entry`, and handle "manager with no scores yet".
- **`finished` ≠ safe to send.** It flips before bonus points apply. Gate on `event-status` (all `bonus_added`, `leagues === "Updated"`) cross-checked with `data_checked`.
- **`event-status` returns `status: []` outside a live gameweek**, and `[].every(...)` is `true`. Require `status.length > 0` first or the gate opens on nothing.
- **Never put a phone number in the WhatsApp link.** `wa.me/<number>?text=` opens an individual chat and makes groups unreachable — it still looks like a working link. Always `whatsapp://send?text=` / `https://wa.me/?text=` with no number.
- **Digest length budget: ~1,500 chars URL-encoded.** Newlines cost `%0A`; table padding is pure cost. The composer must show this live as blocks are toggled — standings alone can eat most of it.
- **`digests` stores structured stats, not rendered text.** Blocks are toggled per message, so rendering happens at send time from the stored JSON. Store the owner's final `sent_text` separately — once edited, it isn't reproducible from the API.
- **The app never sends on the owner's behalf.** It prepares a draft; the owner writes, composes and taps. There is no automatic cadence.
- **Delivery must be idempotent** — `deliveries` is unique on `(league_id, gameweek, kind)`. Cron and manual send can both reach prepare.
- **Delivery is never "confirmed".** `prepared` → optionally `marked sent`; a null `sent_at` means unknown, not failed.
- **Idempotency is on `digests`, not `messages`.** `digests` is unique per `(league_id, gameweek)` so polling can't double-prepare; `messages` is deliberately many-per-gameweek, since the owner may send a follow-up. Never add `user_id` to the digest key — co-owners share one digest and one visible sent/draft state.
- **Fixed prizes come off the top; percentages apply to the remainder.** `remainder = pot − (gw_winner × gameweeks) − season_best_gw`, then top-6 percentages apply to `remainder`. Applying them to the whole pot over-commits it and only surfaces at season end. Re-validate on every pot edit.
- **Take the gameweek count from `events.length`**, never hardcode 38.
- **Rank and best-GW winnings are `provisional`** until the final GW is scored. Only GW-winner amounts are final as they accrue. Never render a provisional figure as settled.
- **Ties pool and split**: N managers tied at rank R take positions R…R+N−1, pool those prizes, divide equally. Paying each tied manager in full overdraws the pot.
- **Paid places are configurable** — N is just the number of `season_rank_pct` rows. Validate contiguous ranks from 1 and percentages summing to 100%. Use decimals, and derive the last place as `remainder − sum(others)` so rounding can't miss the pot.
- **Prize rules lock once the ledger is finalised.** Editing them mid-season only moves provisional projections; editing after season end rewrites settled `winnings` rows.
- **Detect ties on `rank`, not `rank_sort`.** `rank_sort` imposes an arbitrary total order that makes a real tie look resolved; it's only for deciding where a rounding remainder lands.
- **`role` grants nothing in v1.** It's stored for future permission work; every owner can do everything, including send.
- **The FPL invite code is not the league ID.** `1xrliv` is a join code; the API needs the number from the league URL, and there's no unauthenticated way to convert one to the other.
- **FPL sits behind Cloudflare** and blocks many datacenter IPs. Don't move to serverless with rotating egress.
