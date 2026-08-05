# FPheLp

Automates a private FPL league owner's group communications — standings, results, money pot — instead of them posting by hand. Owner-only; league members never log in.

See [ROADMAP.md](./ROADMAP.md) for scope and [ARCHITECTURE.md](./ARCHITECTURE.md) for design.

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
- **`new_entries` is an object, not an array** — `{has_next, page, results}`, same envelope as standings. Its managers are invisible in standings until the next GW processes, so the roster is `standings.results ∪ new_entries.results`, each paginated.
- **`finished` ≠ safe to send.** It flips before bonus points apply. Gate on `event-status` (all `bonus_added`, `leagues === "Updated"`) cross-checked with `data_checked`.
- **`event-status` returns `status: []` outside a live gameweek**, and `[].every(...)` is `true`. Require `status.length > 0` first or the gate opens on nothing.
- **Never put a phone number in the WhatsApp link.** `wa.me/<number>?text=` opens an individual chat and makes groups unreachable — it still looks like a working link. Always `whatsapp://send?text=` / `https://wa.me/?text=` with no number.
- **Digest length budget: ~1,500 chars URL-encoded.** Newlines cost `%0A`; table padding is pure cost.
- **Delivery must be idempotent** — `deliveries` is unique on `(league_id, gameweek, kind)`. Cron and manual send can both reach prepare.
- **Delivery is never "confirmed".** `prepared` → optionally `marked sent`; a null `sent_at` means unknown, not failed.
- **A league can have several owners, but one digest.** Never add `user_id` to the `deliveries` unique key — co-owners share one prepared digest and one "sent" state, or the group gets the message twice.
- **The FPL invite code is not the league ID.** `1xrliv` is a join code; the API needs the number from the league URL, and there's no unauthenticated way to convert one to the other.
- **FPL sits behind Cloudflare** and blocks many datacenter IPs. Don't move to serverless with rotating egress.
