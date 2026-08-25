# GW1 verification checklist — run after 21 Aug 2026

Everything here is blocked on **GW1 being scored** (deadline 2026-08-21). Pre-season the collections are empty, so these cannot be checked earlier.

Reference league: **9999999** ("The Sunday League"). Pre-season 2026-08-05: 0 standings rows, 14 new entries. **As of 2026-08-25 GW1 is final** — 17 standings rows, 0 new entries, `sendGate()` open.

Snapshots behind the findings below, all via `npm run fpl:snapshot`: 21 Aug 18:09Z and 23:29Z (kickoff, then first day scored), 24 Aug 21:20Z and 23:54Z (still provisional), 25 Aug 14:14Z (final).

---

## 1. ⚠️ Is manager history actually backfillable?

**No longer plan-changing — the capture job was built without waiting for the answer.**

The check could never have run in time: pre-season `current[]` is empty for everyone, so it is indistinguishable from "backfill doesn't work", and the earliest real answer arrives *after* the moment capture would have had to be running. The decision was therefore made under uncertainty, on the asymmetry — if backfill works the job was cheap insurance, if it doesn't the data would have been gone for good.

`POST /api/jobs/capture-history` stores **every** gameweek `current[]` returns, so this question now only decides how much a single run recovers.

**The first post-GW1 run (2026-08-25, §7) did not settle this**, and could not have: it returned `gameweeksSeen: [1]`, which is equally consistent with "the whole season to date" and "recent gameweeks only" when the season is one gameweek long. **GW2's run is the first that can tell them apart** — read `gameweeksSeen` there and pick one of the two branches below.

Still worth observing on that run:

- **If `current[]` returns the whole season to date** — a missed run costs nothing; the next one backfills it. Running the job becomes routine rather than time-critical.
- **If it only returns recent gameweeks** — the job must run every gameweek without fail, and the cron's reliability stops being a convenience. See §7.

Either way, one thing stays unrecoverable and should remain documented as such:

- a manager who **leaves** the league — their entry ID vanishes from standings, so nothing after that point can reconstruct them.

The second historical gap is now partly covered: the capture job upserts `managers`, so **who was a member at the time** is recorded from the first run onward. It is only as complete as the runs behind it.

## 2. Confirm the unverified endpoint shapes

Diff real payloads against the endpoint table in [ARCHITECTURE.md](../ARCHITECTURE.md#endpoint-reference). **All four rows are now confirmed and the ⚠️ marks are gone** — the findings below are what cleared them.

- [x] **`standings.results[]` element fields** — confirmed live 2026-08-21 23:29Z, and the community-typed shape was **wrong in two ways**: there is no `id` (declared required, never sent — nothing read it, so nothing broke), and there is an undocumented `club_badge_src`, null for every manager here. Everything else matched. `last_rank` is `0` for every manager after GW1, so rank movement must read `0` as "no previous rank" rather than as a climb from position zero — it does.
- [x] **`event-status.leagues`** — **confirmed `"Updated"` on 2026-08-25 14:14Z**, when GW1 went final. The last unverified thing the send trigger depended on; `sendGate()` returned `{gameweek: 1, statsReady: true, reason: "ready"}` on the same snapshot. Three values are now observed — `""`, `"Updating"` (2026-08-21 23:29Z) and `"Updated"` — so the field is not a two-state flag and a truthiness test would have opened the gate mid-gameweek. **One correction to the earlier note:** `""` is *not* "before a gameweek". It was the value through both 24 Aug snapshots with GW1 live and all 17 managers scored, so it means "not currently recalculating" and covers pre-season and a live-but-idle gameweek alike. An emptiness test would read a live gameweek as pre-season.
- [x] **`status[].bonus_added`** — **seen flipping to `true` on 2026-08-25 14:14Z**, all four rows together with `finished`, `data_checked` and `leagues`. Everything moves at once; there is no partial state to handle. The field first existed 2026-08-21 18:09Z, and stayed `false` at 23:29Z on a match day whose games had finished and whose scores were in, and again through 24 Aug 21:20Z and 23:54Z — three days of `false` on visible scores. That gap between "scores landed" and "bonus applied" is the entire reason the gate exists, and it is now measured, not assumed: see §5 for the points it moved. `status[].points` has a third value to match — `""` → `"p"` while provisional → `"r"` once final.
- [x] **`history.current[]` element fields** — confirmed 2026-08-21 23:29Z. Every field we map is present, plus several we do not use (`rank_sort`, `percentile_rank`, `overall_rank_percentage`, `bank`, `value`, `event_transfers`). `past[]` is populated for a returning manager — 7 seasons on the one sampled.

## 3. Watch the standings / new_entries transition

The most interesting moment in the whole season for this app, and it only happens once.

**Answered 2026-08-21, 23:29Z**, after the first day's matches were scored — earlier than expected. At kickoff (18:09Z) `standings.results` was still `0` with all 17 in `new_entries`; five hours later the move had completed.

- [x] Do the 17 managers move from `new_entries` into `standings`? **Yes**, all 17.
- [ ] Does any manager appear in **both** at once? **Not observed** — 0 in both, across all five snapshots now (21 Aug 18:09Z and 23:29Z, 24 Aug 21:20Z and 23:54Z, 25 Aug 14:14Z), spanning the transition and both sides of it. The dedupe-on-`entry` rule is therefore still unexercised. Keep it: costing nothing and being unproven is a better position than removing it on a season-opening weekend's evidence, since a manager joining mid-gameweek is exactly the case that would produce it — and no one joined during this one.
- [x] Does `new_entries` empty out entirely? **Yes**, straight to 0.

Also confirmed here, and the most valuable line in this document: the **league average is computed, not read**. `leagueAverage()` returned **9** while `events[0].average_entry_score` was **12** — two different numbers, and the app uses the right one.

## 4. Record fixtures

**Unblocked as of 2026-08-25, and this is the moment to do it.** Every collection is now non-empty and GW1 is final, which is the state the fixtures should freeze — a settled gameweek, `leagues: "Updated"`, all four `bonus_added: true`, 17 populated standings rows. Capturing a provisional payload instead would bake `"p"`/`false` into the suite and quietly make the gate's ready path untested. Nothing here has been captured yet; the items below are still all open.

One caveat to settle while recording: the reference league is 17 managers, so its `standings` fits on a single page and `has_next` is `false`. A recorded payload alone will therefore **not** exercise the pagination assembly. Either record a larger public league alongside it or keep a hand-built multi-page fixture for that one case — see the note on fixture size below.

- [ ] Save real payloads for `bootstrap-static/`, `event-status/`, `leagues-classic/9999999/standings/`, and one `entry/{id}/history` into the test fixtures directory.
- [ ] These are the basis of the Vitest suite and double as a change detector for next season.
- [ ] Replace the hand-authored bodies in `src/lib/fpl/fixtures.ts` with the recorded ones. Until then the Playwright suite proves the app renders what it is given, but nothing about whether the shape is right — the two are easy to confuse, and only this step closes the gap. Keep the fixture league larger than one page so the `has_next` assembly stays exercised.

## 5. Sanity-check the computed stats

**Checked against the final GW1 numbers, 2026-08-25 14:14Z.**

- [x] League average computed from `event_total` — **differs, every time.** Final: `leagueAverage()` **53.65** against a global `average_entry_score` of **50**. The two have never once matched across five snapshots (9 vs 12 on 21 Aug; 52.82 vs 36, then 52.82 vs 48 on 24 Aug), and the global figure moved by 12 points in a single evening while our league's held still — they are not the same quantity and cannot be substituted.
- [x] GW winner matches the real top scorer — `Bald Fraud United`, 79, stable across all three post-scoring snapshots.
- [x] **The bonus gap, quantified.** League average **52.82 → 53.65** between the last provisional snapshot and the final one, with no fixtures left to play. That is roughly 0.8 points per manager arriving after the scores already looked complete, and it is enough to reorder a tight table. This is the concrete answer to "why not just gate on `finished`".
- [ ] Rank movement from `last_rank` looks right — **still open, and cannot be checked until GW2.** GW1 answers the parenthetical only: `last_rank` is `0` for every manager when there is no prior gameweek, and `biggestRiser`/`biggestFaller` correctly render `—` rather than treating it as a climb from position zero.

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

In PowerShell the `--` separator is swallowed by npm — it fails with "Workspaces not supported for global packages" without running anything — so call node directly:

```
node --env-file-if-exists=.env --import tsx scripts/clear-test-digest.mts --gw 1 --confirm
```

**Against production, run it inside the container.** `railway run` does *not* work here and the failure is confusing: it injects the production environment into a process on your machine, so `DATABASE_URL` resolves to `postgres.railway.internal`, which exists only on Railway's private network. The result is `ENOTFOUND` after everything looked correct. Use `railway ssh` instead — `tsx` is a runtime dependency, so the deployed container can run the script as-is:

```
railway ssh --service fphelp-app
node --import tsx scripts/clear-test-digest.mts --gw 1            # then --confirm
exit
```

Confirmed working 14 Aug 2026.

If `railway ssh` is ever unavailable, the fallback is the Postgres service's `DATABASE_PUBLIC_URL` (a `…proxy.rlwy.net` host) set as `DATABASE_URL` for one local command — and unset afterwards, since a shell variable outranks `.env` and would silently point later commands at production.

Every run prints the database it opened as its first line — check it before `--confirm`:

```
Database:   localhost:5432/fphelp_dev          <- local
Database:   <something>.railway.internal:5432/railway   <- production
```

It refuses a gameweek whose digest contains scored managers, since that is real data rather than a test artifact — `--force` overrides, and should not be needed. Note this catches the **demo** GW5 digest too: demo scores are indistinguishable from real ones, so clearing that one needs `--force`.

**The digest row comes back, and that is fine.** Loading `/send` calls `upsertDigest`, so a cleared GW1 digest reappears on the next page view — observed immediately after the local cleanup. It is empty of everything that matters: `upsertDigest` overwrites the stats when GW1 actually scores, and no `messages` or `deliveries` row returns with it. Those only appear when someone saves a draft or sends. So the check that counts is **"no message, no delivery"**, not "no digest" — re-run the dry run and read those two lines rather than the first one.

**Testing in production is fine, and the script is re-runnable — but the last run has a deadline.** Every prod test stamps fresh GW1 rows, so clear again after the final test. That run must happen **before GW1 is scored**, for two reasons: after scoring, the GW1 digest holds real results, and the guard will refuse it as real data. Overriding with `--force` at that point would delete the genuine record of the season's first send. So the order is: test freely → clear → hand over → GW1 scores. Once managers have points, this script is finished with gameweek 1 for good.

- [x] **Local database cleared** on 13 Aug 2026 — one GW1 digest, one message ("Test email from Dev. #2", marked sent) and one email delivery row (sent, 2 recipients, 9 attempts).
- [x] **Production database cleared** on 14 Aug 2026, via `railway ssh`.
- [ ] **Production cleared again after the last round of testing**, and before GW1 scores. This is the one that matters — see the deadline above.
- [ ] The demo GW5 row is left in place deliberately — harmless until October, and it exercises the guard.

The underlying reasons, worth keeping even once the script exists:

- [ ] **Delete any GW1 draft in `messages`.** `/send` pre-season labels its digest gameweek 1 (there is no finished gameweek, so it falls back to 1). A draft saved while testing will be loaded by `findDraft` into the real GW1 composer — pre-season text, silently, at the one moment it matters.
- [ ] **The GW1 `digests` row is self-healing** — `upsertDigest` overwrites the stats when GW1 actually scores — but confirm rather than assume, since a score-less digest looks plausible.
- [ ] **Check for a `sent` message on GW1.** If one exists from testing, the composer's sent/draft state for the real GW1 starts wrong.

## 7. Capture job — the first run that actually captures

The scheduler shipped 2026-08-10 (Railway cron, every 40 min). Everything below GW1 is only the **skip** path: pre-season `captureDecision` returns `pre-season` before any per-manager call, so the branch that does the real work has never run against real data.

The service is `cron-capture-history`, not `fphelp-app` — these checks read *its* logs, and the web service's logs will show nothing:

```
railway logs --service cron-capture-history
```

**The first real capture ran 2026-08-25 12:40:39Z, and every check passed.**

```
12:40:39Z  {gameweek:1, rowsSaved:17, gameweeksSeen:[1], dropped:[], failed:[]}
13:00:30Z  {skipped:true, reason:"already-captured", gameweek:1}
13:41:14Z  {skipped:true, reason:"already-captured", gameweek:1}
14:00:44Z  {skipped:true, reason:"already-captured", gameweek:1}
```

- [x] **The capture branch itself** — `skipped: false`, `rowsSaved: 17` (the whole roster), `gameweeksSeen: [1]`.
- [x] **`dropped` and `failed` are empty.** Nothing discarded and nobody lost, which independently corroborates §2: every `history.current[]` row parsed against the mapping. This also clears ROADMAP.md's ⚠️ on the capture mapping never having parsed a real scored gameweek.
- [x] **The gate held**, and this is the one that mattered. Every poll from the GW1 deadline through 24 Aug skipped; the capture is at 12:40Z on the 25th, *after* bonus settled. History therefore stores final scores. Had it fired when `finished` first flipped it would have stored numbers ~0.8/manager light — see §5.
- [x] **`already-captured` engages** — three consecutive skips at :00, :40, :00, so the entry-count comparison matches the roster and there is no hourly re-capture.
- [x] **18 sequential FPL calls survive Cloudflare** — 17 here, no `blocked: true`, no `savedBeforeBlock`. First real burst; single sample, so the proxy mitigation stays on the books.

**One defect found, and fixed on the same branch as this write-up.** Every skip during the live-but-unsettled gameweek logged `reason: "pre-season"` — on 24 August, with a gameweek in progress and all 17 managers scored. That is the `lastFinishedGameweek() === null` conflation the composer already fixes via `liveGameweek()`; `captureDecision` was not making the same split. The decision was right in both states (skip either way) and no data was affected, but the logged reason is the first thing anyone reads when capture fails to fire, and it was wrong. It now reports `not-finished` with the live gameweek named.

### Revisit the cadence — and check what a scheduled run costs

`*/40 * * * *` was inherited from ARCHITECTURE.md's "every 30-60 min", not measured against anything.

- [ ] **Time a *scheduled* run** (not a manual trigger — that's a full redeploy: `npm ci` plus the pre-deploy migration, ~5 min, and not representative). A scheduled firing should start the existing image and exit in seconds. If it's minutes, 36 runs/day is ~90 compute-hours a month instead of ~5-8, and the cadence needs cutting immediately.
- [ ] **Narrow the window.** Gameweeks settle Sunday evening through Tuesday. Once the real settling time is known, `*/40 * * * 0-2` cuts polls ~60% at no cost to capture latency — the self-healing backfill covers anything unusual.
- [ ] **Reconsider the roster fetch.** Standings are fetched *before* the gate, so a skipped poll costs three FPL calls rather than two. That's deliberate — it keeps `new_entries` fresh pre-season, exactly when the gate always skips. After GW1 that rationale expires, and moving the fetch after the decision drops a third of the traffic.
