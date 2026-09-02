# commit-and-push profile — FPheLp

Repo profile for the `commit-and-push` skill. Specifics only; the shared procedure lives in the skill.

## Platform

**npm** on **Windows / PowerShell**. There is **no Prettier** — ESLint owns code quality and formatting is by convention. Do not look for a `format` script.

## Branch guard — extra teeth

`main` **auto-deploys** (see "After the push"), so a push from `main` goes straight to production with no further confirmation. Say that when asking.

This project ran on `main` through the early scaffolding, deliberately. That period is over: from the first fully tested version onward, work belongs on a branch.

## Review traps

This project's characteristic failure mode is **silently wrong output**, not crashes. Review with that bias.

Edge cases worth checking by default: a league where nobody has scored yet, ties, managers with no previous rank, pagination beyond one page.

Check these explicitly when the diff touches the area — full explanations under **Gotchas** in `CLAUDE.md`:

- League average computed from `event_total`, never `events[].average_entry_score` (that one is FPL's *global* average)
- `standings.results` and `new_entries.results` are both paginated and both must be read
- The `event-status` gate requires `status.length > 0` before `every(bonus_added)` — `[].every(...)` is `true`
- No phone number in any `wa.me` / `whatsapp://` link
- Money arithmetic in integer cents; fixed prizes and expenses off the top, percentages on the remainder
- `digests` unique per `(league_id, gameweek)`; `messages` deliberately not unique
- Nothing treats a link tap, or anything else, as proof a message was delivered
- **No implicit league creation.** Resolving a league is read-only — `findLeagueByFplId`, never a find-or-create. `ensureLeague` was deleted for this reason and the obvious instinct is to bring it back. Two things now depend on its absence: the league comes from a URL segment, so find-or-create lets anyone mint a league by typing a number; and the capture cron iterates the `leagues` table, so any row that appears is silently enrolled for capture
- **The capture gate is evaluated once per run, before the league loop.** `bootstrap-static` and `event-status` are global. A change that moves the gate inside the per-league loop, or adds a per-league FPL call ahead of it, turns a skipped poll from 2 calls into 2 + N — against an API that blocked this deployment on 2026-09-01. It will not fail any test; the tests do not count calls

If the diff touches the FPL client, also confirm nothing has quietly widened what a `null` from `lastFinishedGameweek()` is taken to mean.

## Test coverage

Glob: `src/**/*.test.ts` (Vitest).

**Expected to be covered:** new or changed logic in `src/lib/**`. That layer is pure functions over fetched JSON and is where the tests belong.

**Deliberately not unit-tested — do not flag:** `src/db/**`, `src/app/**` (pages, route handlers, server actions), `src/components/**`. Playwright covers those.

## Docs

Check `CLAUDE.md`, `ROADMAP.md`, `ARCHITECTURE.md` — new commands, schema changes, a decision made or reversed, a new gotcha discovered.

If the change verified something previously unconfirmed, update `docs/GW1-VERIFICATION.md` — and be precise about what was actually **verified** versus **assumed**.

## Gates

In order:

1. `npm run lint` — ESLint. Fix errors before continuing; warnings can be noted.
2. `npx tsc --noEmit` — typecheck.
3. `npm test` — Vitest.
4. `npm run build` — catches server/client boundary errors that lint and typecheck both miss, and it is what Railway will run. If it fails oddly right after editing `package.json` or config, delete `.next` and retry — a stale Turbopack cache produces misleading errors.

## After the push

### Merge to main, which deploys

Railway is connected to the GitHub repo and **auto-deploys on every push to `main`**. There is no separate deploy step — merging *is* deploying, and the two cannot be decided independently.

**Ask before merging, and ask it as a deploy question rather than a git question.** The container restarts, which interrupts anything the user is testing against the live URL, and a deploy mid-test produces confusing results that look like bugs.

Only once they confirm:

```
git checkout main
git merge --ff-only <branch>
git push origin main
```

Prefer `--ff-only`. If it refuses, `main` has moved and the branch needs rebasing — say so rather than reaching for a merge commit unasked.

Then return to the working branch, or delete it if the user is done with it.

The pre-deploy command runs migrations and the owner bootstrap, so a schema change reaches production on deploy. Verify afterwards rather than assuming. The build starts within seconds of the push but takes a minute or two to go live:

```
railway deployment list
railway logs --service fphelp-app
```

### Two things that still need the CLI

No commit is involved in either, so no push will trigger them:

- **New environment variables need a redeploy** to reach a running container — a missing value looks like a bad value. `railway redeploy --service fphelp-app`.
- **Redeploying an unchanged tree** — same command.
