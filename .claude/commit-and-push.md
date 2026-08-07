Review the staged and unstaged changes on the current branch, format, lint, typecheck, and test, then commit and push. Follow these steps in order.

This repo uses **npm** (not pnpm), on **Windows / PowerShell**.

## Step 1 — Branch guard

Run `git branch --show-current`. If it is `main`, stop immediately and tell the user to check out a new branch before committing anything.

## Step 2 — Code review

Run `git diff HEAD` to see all uncommitted changes. Review them for:

- Bugs or logic errors
- Missing edge-case handling
- Anything inconsistent with the conventions and design decisions in `CLAUDE.md` (e.g. the clean-API-boundary rule, neutral domain naming, the WhatsApp-coexistence model)

Also review test coverage for the changes:

- Run `glob src/**/*.test.ts` to see existing unit tests.
- For every new or modified file in `src/lib/` or `src/server/services/`, check whether its behaviour is covered by a test, and flag changed logic that isn't — new service methods, new message/format branches, validation changes, schema changes that affect query results, etc.
- Do **not** flag gaps for layers the README testing strategy lists as intentionally not-yet-unit-tested or excluded: `src/lib/db.ts`, layouts, route handlers, server components, and (for now) the `server/services` integration layer and client components — those are covered by E2E or planned later.

If you find significant issues or meaningful test gaps, report them and ask the user whether to proceed or stop to fix first. Minor style notes shouldn't block progress.

## Step 3 — Verify docs are up to date

Check `CLAUDE.md` and `README.md` (and `BRAINSTORM.md` only if scope/direction changed). Confirm they reflect the current changes — e.g. new scripts, schema/model changes, stack or convention changes, testing-strategy status. Update them if needed and include the edits in this commit.

## Step 4 — Format

Run `npm run format` (Prettier) to auto-format all files. If it changes any files, that's fine — they'll be staged with the commit. (Prettier owns formatting; ESLint in the next step owns code quality.)

## Step 5 — Lint

Run `npm run lint` (ESLint). If there are errors, try `npm run lint:fix` for auto-fixable ones, then re-run. Report any remaining errors clearly and stop until they're resolved or the user confirms continuing anyway. Warnings can be noted but need not block.

## Step 6 — Typecheck

Run `npx tsc --noEmit`. If it fails, report the errors clearly and stop. Do not proceed until the errors are resolved or the user confirms they want to continue anyway.

## Step 7 — Unit tests

Run `npm test` (Vitest, unit suite). If tests fail, report clearly and stop until resolved or the user confirms continuing anyway.

## Step 8 — E2E tests (optional)

If the changes touch app flows (events, roster, auth, the WhatsApp composer, pages, or server actions), ask the user whether to also run `npm run test:e2e`. Note that E2E requires a local Postgres with a synced schema and auto-starts the dev server (slower, ~30–60s). Skip for pure `lib/` or docs-only changes.

## Step 9 — Commit

Run `git diff HEAD` once more to confirm the full set of changes (including any formatting/doc updates from earlier steps).

Draft a concise commit message following the style of recent commits (`git log --oneline -10`): a short summary line, optionally a brief body. End the message with the required trailer:

```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

PowerShell note: when passing the message via a single-quoted here-string (`@' ... '@`), avoid double quotes and `/` in the text — they can break argument parsing. Prefer plain wording.

Show the message to the user and ask for confirmation before committing. Once confirmed, stage all modified tracked files and create the commit.

## Step 10 — Push

Ask the user to confirm before pushing. Once confirmed, run `git push` (use `git push -u origin <branch>` if the branch has no upstream yet) and report the result.
