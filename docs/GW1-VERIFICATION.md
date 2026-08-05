# GW1 verification checklist — run after 21 Aug 2026

Everything here is blocked on **GW1 being scored** (deadline 2026-08-21). Pre-season the collections are empty, so these cannot be checked earlier.

Reference league: **9999999** ("The Sunday League"). Last checked 2026-08-05: 0 standings rows, 14 new entries.

---

## 1. ⚠️ Is manager history actually backfillable?

**This is the one that can change the plan, so do it first.**

ROADMAP Phase 1 says history capture must start at GW1 because it "cannot be backfilled". That claim looks too strong and was never verified.

Check: fetch `entry/{id}/history` for a manager and inspect `current[]`.

- **If `current[]` returns the whole season to date** — backfill works for any manager currently in the league. Capturing from GW1 stops being an ordering constraint on Phase 1 and becomes a nice-to-have. **Relax the roadmap accordingly.**
- **If it only returns recent gameweeks** — the original claim stands, and history capture is genuinely urgent.

Either way, these remain unrecoverable and should stay documented as such:
- a manager who **leaves** the league (their entry ID vanishes from standings)
- league-relative facts about **who was a member at the time**

## 2. Confirm the unverified endpoint shapes

Diff real payloads against the ⚠️ rows in [ARCHITECTURE.md](../ARCHITECTURE.md#endpoint-reference).

- [ ] **`standings.results[]` element fields** — `entry`, `entry_name`, `player_name`, `rank`, `last_rank`, `rank_sort`, `total`, `event_total`. Never observed live; the only fields still taken purely on trust.
- [ ] **`event-status.leagues`** — confirm it really is the string `"Updated"`. Pre-season it is `""`. The whole send trigger depends on this exact value.
- [ ] **`status[].bonus_added`** — confirm the field exists and flips as expected.
- [ ] **`history.current[]` element fields** — `event`, `points`, `total_points`, `rank`, `overall_rank`, `points_on_bench`, `event_transfers_cost`.

## 3. Watch the standings / new_entries transition

The most interesting moment in the whole season for this app, and it only happens once.

- [ ] Do the 14 managers move from `new_entries` into `standings`?
- [ ] Does any manager appear in **both** at once? (The dedupe-on-`entry` rule assumes this is possible.)
- [ ] Does `new_entries` empty out entirely?

## 4. Record fixtures

- [ ] Save real payloads for `bootstrap-static/`, `event-status/`, `leagues-classic/9999999/standings/`, and one `entry/{id}/history` into the test fixtures directory.
- [ ] These are the basis of the Vitest suite and double as a change detector for next season.

## 5. Sanity-check the computed stats

- [ ] League average computed from `event_total` — confirm it differs from `events[].average_entry_score` (the global average). If they match, the wrong one is being used.
- [ ] GW winner matches the real top scorer.
- [ ] Rank movement from `last_rank` looks right for GW2 onward (GW1 has no previous rank — check what `last_rank` holds when there is no prior gameweek).

## 6. Not blocked on GW1 — do these sooner

- [ ] **Tap a real `whatsapp://send?text=` link on the owner's phone** with a synthetic full-length (~1,500 char) digest. Confirm the group picker appears, no phone number is in the URL, and nothing is truncated. This validates the delivery model and needs no league data at all.
- [ ] **Confirm Railway's egress reaches the FPL API.** Residential IPs work; datacenter IPs are the documented risk and this is still unverified from a deployed container.
