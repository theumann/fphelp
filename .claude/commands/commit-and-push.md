---
description: Review, verify and commit the current changes, then push and deploy.
---

Review the staged and unstaged changes, verify them, then commit and push. Follow these steps in order.

This repo uses **npm** on **Windows / PowerShell**. There is no Prettier — ESLint owns code quality and formatting is by convention.

## Step 1 — Branch guard

Run `git branch --show-current`.

**If it is `main`, stop and ask before going further.** Say what the change is and offer to move it to a branch. Most often being on `main` means nobody remembered to branch, which is exactly what this check is for.

Moving uncommitted work to a branch is safe and loses nothing:

```
git checkout -b <descriptive-name>
```

Proceed on `main` only if the user says so. Do not decide that for them, and do not branch silently either — they may be mid-test on a working tree they expect to stay put.

This project ran on `main` through the early scaffolding, deliberately. That period is over: from the first fully tested version onward, work belongs on a branch.

## Step 2 — Code review

Run `git diff HEAD` and review for:

- Bugs or logic errors, especially **silently wrong output** rather than crashes — this project's characteristic failure mode
- Missing edge cases: a league where nobody has scored yet, ties, managers with no previous rank, pagination beyond one page
- Anything contradicting the **Gotchas** in `CLAUDE.md`

Check those gotchas explicitly when the diff touches the relevant area:

- League average computed from `event_total`, never `events[].average_entry_score`
- `standings.results` and `new_entries.results` both paginated and both read
- `event-status` gate requires `status.length > 0` before `every(bonus_added)`
- No phone number in any `wa.me` / `whatsapp://` link
- Money arithmetic in integer cents; fixed prizes off the top, percentages on the remainder
- `digests` unique per `(league_id, gameweek)`; `messages` deliberately not unique
- Nothing treats a link tap, or anything else, as proof a message was delivered

## Step 3 — Test coverage

Run `glob src/**/*.test.ts`. For new or changed logic in `src/lib/**`, check it is covered — that layer is pure functions over fetched JSON and is where the tests belong.

Do **not** flag missing unit tests for: `src/db/**`, `src/app/**` (pages, route handlers, server actions), or `src/components/**`. Those are deliberately not unit-tested — Playwright is planned but not yet installed.

If you find real issues or meaningful gaps, report them and ask whether to proceed. Minor style notes shouldn't block.

## Step 4 — Docs

Check whether `CLAUDE.md`, `ROADMAP.md` or `ARCHITECTURE.md` need updating — new commands, schema changes, a decision made or reversed, a new gotcha discovered. Include any edits in this commit.

If the change verified something previously unconfirmed, update `docs/GW1-VERIFICATION.md` — and be precise about what was actually verified versus assumed.

## Step 5 — Lint

Run `npm run lint`. Fix errors before continuing. Warnings can be noted.

## Step 6 — Typecheck

Run `npx tsc --noEmit`. Do not proceed while it fails.

## Step 7 — Tests

Run `npm test` (Vitest). Do not proceed while it fails.

## Step 8 — Build

Run `npm run build`. This catches server/client boundary errors that lint and typecheck miss, and it is what Railway will run.

If it fails oddly right after editing `package.json` or config, delete `.next` and retry — a stale Turbopack cache produces misleading errors.

## Step 9 — Commit

Draft a concise message in the style of `git log --oneline -10`: a short summary line, then a body explaining **why**, not what the diff already shows. End with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

**PowerShell:** here-strings mangle multi-line messages — braces and quotes break argument parsing and git ends up treating the body as pathspecs. Write the message to a file and use `git commit -F <file>`.

**Always show the message and wait for confirmation before committing** — never commit unprompted. The user often has manual testing running in parallel, so they decide when the tree is ready to be captured.

## Step 10 — Push and deploy

**Ask before pushing**, separately from the commit confirmation. Then:

```
git push origin <branch>
```

Railway does **not** auto-deploy from GitHub — this project deploys via the CLI.

**Ask again before deploying.** `railway up` restarts the container, which will interrupt anything the user is testing against the live URL — and a deploy mid-test produces confusing results that look like bugs. Only once they confirm:

```
railway up --service fphelp-app --detach
```

The pre-deploy command runs migrations and the owner bootstrap, so a schema change reaches production on deploy. Verify afterwards rather than assuming:

```
railway logs --service fphelp-app
```

Note that **new Railway environment variables need a redeploy** to reach a running container — a missing value looks like a bad value.
