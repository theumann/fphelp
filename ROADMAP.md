# FPheLp — MVP & Roadmap

(Working name, folder/repo name TBD)

## Purpose
Facilitate a private fantasy league owner's communications with their group (WhatsApp/email), by automating standings, results, and money-pot updates instead of manual posting.

Primary actor: **the league owner/manager**. League members are recipients of content (digests pushed to channels they already use), not users of a separate app.

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
- **League setup (one-time)** — owner enters private league ID; validate via `leagues-classic/{id}/standings/`
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

### Phase 2 — money pot
- Owner enters the **pot total directly**, plus prize distribution rules (e.g. 1st/2nd/3rd %, monthly prizes)
- App applies distribution to the entered total; splits must sum to the pot
- Entry fee is optional, display-only ("£20 × 18 players") — no longer load-bearing
- Monthly prizes need `league.start_event` and `events[].deadline_time` to map gameweeks → months
- Digest includes pot total / payout breakdown alongside standings

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

- **Digest cadence** — every GW, or weekly/monthly summaries too?
- **Does v1 need the owner's own manager ID**, or is the league ID sufficient?

## Known risks

- **Unofficial API** — first-party but undocumented; no stability guarantee, no terms coverage, shapes shift between seasons
- **Cloudflare IP blocking** — the FPL API rejects many datacenter IPs; this drives the hosting choice (see ARCHITECTURE.md)
- **Deep-link behaviour varies** across iOS / Android / desktop
- **Season rollover** resets league and gameweek IDs

### Explicitly out of MVP
- Multi-league support
- Member-facing polls/predictions
- H2H leagues (classic only for v1)
- Public shareable web page
- Season rollover automation
- Other fantasy platforms (see roadmap below)

---

## Future Roadmap

- **Per-manager paid tracking** — a checkbox per manager for who has paid in. Start-of-season, non-recurring, so it doesn't earn MVP scope
- **WhatsApp Business Cloud API delivery** — fully server-side sending, gated on Official Business Account status
- **Variable/uneven entry fees or side-pots** — beyond the flat-fee assumption (e.g. optional side bets, buy-ins mid-season)
- **Multi-league support** — one owner running several leagues/seasons from one dashboard
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
