---
description: Review, verify and commit the current changes, then push and deploy.
---

Review the staged and unstaged changes, verify them, then commit and push. Follow these steps in order.

This repo uses **npm** on **Windows / PowerShell**. There is no Prettier — ESLint owns code quality and formatting is by convention.

## Step 1 — Branch

Run `git branch --show-current`.

This project deliberately commits directly to `main`: it is a solo project with no reviewers, and the deploy pipeline follows `main`. Do **not** stop just because the branch is `main`.

Do branch first if the change is large or speculative enough that the user might want to abandon it — and say so rather than branching silently.

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

Show the message to the user and confirm before committing.

## Step 10 — Push and deploy

Confirm with the user, then `git push origin main`.

Railway does **not** auto-deploy from GitHub — this project deploys via the CLI. If the change should go live, run:

```
railway up --service fphelp-app --detach
```

The pre-deploy command runs migrations and the owner bootstrap, so a schema change reaches production on deploy. Verify afterwards rather than assuming:

```
railway logs --service fphelp-app
```

Note that **new Railway environment variables need a redeploy** to reach a running container — a missing value looks like a bad value.
