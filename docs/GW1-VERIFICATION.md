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
- **If it only returns recent gameweeks** — the job must run every gameweek without fail, and the cron's reliability stops being a convenience. See §7.

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

## 6b. Clear pre-season test artifacts — before 21 Aug

The league (9999999) is the real one, so its `managers`, `dues` and settings are real data and must be kept. What is *not* real is what pre-season testing wrote against **gameweek 1**:

**There is a script for this** — `npm run db:clear-digest`. It deletes the digest, its messages and its delivery rows for one gameweek of the reference league, and nothing else. Dry run by default; `--confirm` deletes; re-running is a no-op.

```
npm run db:clear-digest -- --gw 1              # show what would go
npm run db:clear-digest -- --gw 1 --confirm    # delete it
```

In PowerShell the `--` separator is swallowed by npm, so call node directly:

```
node --env-file-if-exists=.env --import tsx scripts/clear-test-digest.mts --gw 1 --confirm
```

It refuses a gameweek whose digest contains scored managers, since that is real data rather than a test artifact — `--force` overrides, and should not be needed. Note this catches the **demo** GW5 digest too: demo scores are indistinguishable from real ones, so clearing that one needs `--force`.

**The digest row comes back, and that is fine.** Loading `/send` calls `upsertDigest`, so a cleared GW1 digest reappears on the next page view — observed immediately after the local cleanup. It is empty of everything that matters: `upsertDigest` overwrites the stats when GW1 actually scores, and no `messages` or `deliveries` row returns with it. Those only appear when someone saves a draft or sends. So the check that counts is **"no message, no delivery"**, not "no digest" — re-run the dry run and read those two lines rather than the first one.

- [x] **Local database cleared** on 13 Aug 2026 — one GW1 digest, one message ("Test email from Dev. #2", marked sent) and one email delivery row (sent, 2 recipients, 9 attempts).
- [ ] **Production database cleared.** Not reachable from a developer machine, so run it from Railway against the prod service. Expect the same shape.
- [ ] The demo GW5 row is left in place deliberately — harmless until October, and it exercises the guard.

The underlying reasons, worth keeping even once the script exists:

- [ ] **Delete any GW1 draft in `messages`.** `/send` pre-season labels its digest gameweek 1 (there is no finished gameweek, so it falls back to 1). A draft saved while testing will be loaded by `findDraft` into the real GW1 composer — pre-season text, silently, at the one moment it matters.
- [ ] **The GW1 `digests` row is self-healing** — `upsertDigest` overwrites the stats when GW1 actually scores — but confirm rather than assume, since a score-less digest looks plausible.
- [ ] **Check for a `sent` message on GW1.** If one exists from testing, the composer's sent/draft state for the real GW1 starts wrong.

## 7. Capture job — the first run that actually captures

The scheduler shipped 2026-08-10 (Railway cron, every 40 min). Everything below GW1 is only the **skip** path: pre-season `captureDecision` returns `pre-season` before any per-manager call, so the branch that does the real work has never run against real data.

- [ ] **The capture branch itself.** Confirm the first post-GW1 run returns `skipped: false` with `rowsSaved > 0`, and that `gameweeksSeen` contains GW1.
- [ ] **`dropped` and `failed` are empty.** Non-empty `dropped` means `history.current[]` fields didn't match §2 and rows were discarded rather than stored wrong — that is the check firing, not failing, but it needs investigating the same day.
- [ ] **The gate held.** The capture should happen *after* bonus points settle, not when `finished` first flips. If history lands with pre-bonus scores, `isGameweekReady` is wrong and the composer inherits the same bug.
- [ ] **`already-captured` engages.** Every poll for the rest of that week should skip with that reason. If it re-captures hourly, the entry-count comparison in `captureDecision` isn't matching the roster.
- [ ] **18 sequential FPL calls survive Cloudflare.** The egress check (§6) was four calls; this is the first burst. A `blocked: true` response with `savedBeforeBlock` is the signal.

### Revisit the cadence — and check what a scheduled run costs

`*/40 * * * *` was inherited from ARCHITECTURE.md's "every 30-60 min", not measured against anything.

- [ ] **Time a *scheduled* run** (not a manual trigger — that's a full redeploy: `npm ci` plus the pre-deploy migration, ~5 min, and not representative). A scheduled firing should start the existing image and exit in seconds. If it's minutes, 36 runs/day is ~90 compute-hours a month instead of ~5-8, and the cadence needs cutting immediately.
- [ ] **Narrow the window.** Gameweeks settle Sunday evening through Tuesday. Once the real settling time is known, `*/40 * * * 0-2` cuts polls ~60% at no cost to capture latency — the self-healing backfill covers anything unusual.
- [ ] **Reconsider the roster fetch.** Standings are fetched *before* the gate, so a skipped poll costs three FPL calls rather than two. That's deliberate — it keeps `new_entries` fresh pre-season, exactly when the gate always skips. After GW1 that rationale expires, and moving the fetch after the decision drops a third of the traffic.
