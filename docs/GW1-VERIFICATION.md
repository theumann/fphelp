# GW1 verification checklist — run after 21 Aug 2026

Everything here is blocked on **GW1 being scored** (deadline 2026-08-21). Pre-season the collections are empty, so these cannot be checked earlier.

Reference league: **9999999** ("The Sunday League"). Last checked 2026-08-05: 0 standings rows, 14 new entries.

---

## 1. ⚠️ Is manager history actually backfillable?

**No longer plan-changing — the capture job was built without waiting for the answer.**

The check could never have run in time: pre-season `current[]` is empty for everyone, so it is indistinguishable from "backfill doesn't work", and the earliest real answer arrives *after* the moment capture would have had to be running. The decision was therefore made under uncertainty, on the asymmetry — if backfill works the job was cheap insurance, if it doesn't the data would have been gone for good.

`POST /api/jobs/capture-history` stores **every** gameweek `current[]` returns, so this question now only decides how much a single run recovers.

Still worth observing on the first post-GW1 run:

- **If `current[]` returns the whole season to date** — a missed run costs nothing; the next one backfills it. Running the job becomes routine rather than time-critical.
- **If it only returns recent gameweeks** — the job must run every gameweek without fail, which makes wiring the Railway cron urgent rather than optional.

Either way, one thing stays unrecoverable and should remain documented as such:

- a manager who **leaves** the league — their entry ID vanishes from standings, so nothing after that point can reconstruct them.

The second historical gap is now partly covered: the capture job upserts `managers`, so **who was a member at the time** is recorded from the first run onward. It is only as complete as the runs behind it.

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

- [~] **Tap a real `whatsapp://send?text=` link on the owner's phone.** **Partially done 2026-08-06** via the deployed `/send` page: the chat picker appeared, WhatsApp opened, and the text arrived intact — but the message was sent to an **individual chat**, not a group.
  - [x] ~~**Selecting a _group_ from the picker.**~~ **Confirmed 2026-08-06** — message delivered to a real WhatsApp group. The delivery model is settled: no phone number in the URL, picker appears, group selectable, text intact.
  - [ ] **Still to confirm: a full ~1,500 character digest** on a real device. Pre-season messages are short because nobody has scored. Use `/send?demo=1` (or `?demo=30` for a league large enough to truncate).
- [x] ~~**Confirm Railway's egress reaches the FPL API.**~~ **Done 2026-08-05** — all four endpoints returned 200/JSON from the deployed container (egress IP `13.56.136.98`). Single sample; see ARCHITECTURE.md for why the proxy mitigation stays on the books.
