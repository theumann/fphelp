# FPheLp

Automates a private Fantasy Premier League owner's group communications — standings,
results, money pot — instead of them posting by hand.

The app never sends on the owner's behalf. It prepares a draft; the owner writes, composes
and taps. League members never log in.

- [ROADMAP.md](./ROADMAP.md) — scope and phases
- [ARCHITECTURE.md](./ARCHITECTURE.md) — design and the reasoning behind it
- [CLAUDE.md](./CLAUDE.md) — conventions, and the gotchas that produce silently wrong output
- [docs/GW1-VERIFICATION.md](./docs/GW1-VERIFICATION.md) — what to check when the first
  gameweek is scored

## Local development

Needs Node 24 and a local Postgres.

```bash
cp .env.example .env          # then fill in your local Postgres password
psql -U postgres -c "CREATE DATABASE fphelp_dev;"
npm install
npm run db:migrate
npm run dev
```

Without `AUTH_RESEND_KEY`, sign-in links are printed to the server console instead of
emailed, so local development works before a domain is verified.

You will also need a `users` row to sign in at all — access is allowlist-based and there is
no self-signup. Set `BOOTSTRAP_OWNER_EMAIL` and run `npm run db:bootstrap`.

## Tests

```bash
npm test          # Vitest — the pure computation layer, where the silent-wrong-number bugs live
npm run e2e:db    # once, and again whenever migrations change
npm run e2e       # Playwright — pages, Server Actions, guards
npm run e2e:screens   # screenshots of every page in both themes, for looking at
```

The end-to-end suite truncates every table, so it refuses any database that is not named
`fphelp_e2e` **and** local. It never calls the real FPL API.

## Deployment

Railway, project `fphelp`. **Pushing to `main` deploys** — there is no separate step, so
work on a branch and merge deliberately.

| Service | What it is |
| --- | --- |
| `fphelp-app` | The web app; the only one with a public domain |
| `cron-capture-history` | Cron only. Runs `npm run job:capture` every 40 minutes |

`railway.json` sets a `preDeployCommand` that runs migrations and the owner bootstrap, so a
schema change reaches production on deploy.

## Operations

### Reaching the production database

Only from inside the container. `railway run` **does not work** and fails confusingly: it
injects the production environment into a process on your machine, so `DATABASE_URL`
resolves to `postgres.railway.internal`, which exists only on Railway's private network —
you get `ENOTFOUND` after everything looked correct.

```bash
railway ssh --service fphelp-app
```

There is no `psql` in the image; use Node and `pg`, which are already there.

### Deleting sessions

A session can end up belonging to something that is not a person. Sign-in links are
**single-use**, and any app that renders a link preview will fetch the URL to build it —
which verifies the token, consumes it, and receives the session cookie. The owner's own tap
then arrives second and fails with `error=Verification`.

This is not hypothetical: on 2026-08-17 three sessions were created by
`WhatsApp/2.23.20.0`, 3–8 seconds ahead of the owner's iPhone each time, because the link
was being forwarded through WhatsApp to get it from a desktop inbox onto the phone. Every
chat app does this — iMessage, Signal, Telegram and Slack included. **Open sign-in links on
the device that received the email.**

The stranded sessions stay valid for 30 days, so they are worth clearing. Inside
`railway ssh --service fphelp-app`, first look:

```bash
node -e 'const{Client}=require("pg");const c=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});c.connect().then(()=>c.query("select s.expires from sessions s join users u on u.id=s.user_id where u.email=$1",["you@example.com"])).then(r=>console.log(r.rowCount,"sessions")).then(()=>c.end()).catch(e=>{console.error(e.message);process.exit(1)})'
```

then delete:

```bash
node -e 'const{Client}=require("pg");const c=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});c.connect().then(()=>c.query("delete from sessions where user_id=(select id from users where email=$1)",["you@example.com"])).then(r=>console.log("deleted",r.rowCount)).then(()=>c.end()).catch(e=>{console.error(e.message);process.exit(1)})'
```

Single quotes outside and double inside, so nothing needs escaping; one line each, because
they are promise chains rather than statements.

This removes **every** session for that address, including your own — so either run it
before signing in, or expect to sign in again afterwards. That is the right trade: you
cannot tell your session from a fetcher's by looking, and signing in again is cheap.

Expired rows in `verification_tokens` need no attention. Auth.js checks expiry, so they
cannot be used; they are only clutter.

### Reading logs

```bash
railway logs --service fphelp-app                      # application output
railway logs --service fphelp-app --http --since 1h    # requests, with client user-agent
railway logs --service cron-capture-history            # the capture job, not the web app
```

The HTTP logs carry `clientUa`, which is what identified WhatsApp above. Reach for them
whenever a request seems to have happened without anyone making it.

### Other commands

- `npm run db:clear-digest -- --gw N` — deletes one gameweek's digest, messages and
  deliveries. Dry run without `--confirm`. Manual only, never a deploy hook — it removes
  the owner's own writing, which cannot be recovered from the API.
- `railway redeploy --service fphelp-app` — new environment variables need a redeploy to
  reach a running container, and a missing value looks exactly like a bad one.
