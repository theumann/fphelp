# FPheLp — Architecture (MVP)

Working name. See [ROADMAP.md](./ROADMAP.md) for feature scope and future items.

## Overview

FPheLp is a webapp that automates a private fantasy league owner's communications — standings, results, and money-pot updates — currently done by hand in WhatsApp/email. The MVP targets **EPL Fantasy classic private leagues** and is **owner-only**: league members never log in, they just receive the output in channels they already use.

Data comes from the FPL API at `fantasy.premierleague.com/api/*`. It is first-party (run by the Premier League itself) but undocumented and unsupported — no versioning guarantees, so the fetch layer must be defensive.

## Stack

| Concern | Choice | Notes |
|---|---|---|
| App type | Webapp (responsive) | Not native — owner-only, low-frequency admin usage |
| Framework | Next.js (React) | One codebase for config UI + API routes |
| Database | Postgres on Railway | Reuses existing Railway setup |
| Auth | Auth.js (NextAuth), magic link | Users/sessions in the same Railway Postgres |
| Hosting | Railway (all services) | App, DB, and worker in one vendor |
| Scheduling | Railway cron/worker service | Polls FPL for gameweek completion |
| Email delivery | Resend or Postmark | HTML digest |
| WhatsApp delivery | Copy-paste text block (v1) | Real API automation deferred |

## Components

```
[Owner's browser]
        |
        v
[Next.js app on Railway]
  - Auth.js magic-link login
  - League setup / pot config UI
  - Digest preview + "send now"
  - API routes
        |
        +--> [Railway Postgres] leagues, owners, pot_config,
        |                        digest_history, gw_state
        |
        +--> [FPL API client] bootstrap-static, leagues-classic
        |                     standings, entry/*  (cached)
        |
        v
[Railway cron/worker]  --every 30-60min-->  poll bootstrap-static
        |                                    for event.finished
        |                                    + data_checked
        v
[Digest builder] standings, rank deltas, GW winner,
        |         risers/fallers, pot total + payouts
        |
        +--> [Email: Resend/Postmark]  (automated)
        +--> [WhatsApp text block]     (owner copy-pastes)
```

## Decisions & rationale

**Webapp, not native.** Setup happens once; after that the system runs server-side and the content lands in email/WhatsApp. Nothing about the owner's workflow needs device-native capabilities, and native would add app-store review cycles for a project still validating with a handful of testers.

**Next.js.** Already in use on other projects. API routes plus UI in one deployable keeps the surface small.

**Postgres on Railway, not Supabase/Neon.** Railway is already in use. At this scale a plain Postgres instance is a plain Postgres instance — Supabase's and Neon's differentiators (built-in auth/storage, branching) aren't needed, and adding a vendor costs more than it saves.

**Auth.js with magic link, not Supabase Auth.** Keeps users and sessions in the Postgres we already own, with no external auth vendor. Magic link sidesteps password-reset flows entirely, which matters when the user count is a handful of league owners. Matches a pattern already used successfully elsewhere.

**Everything on Railway.** A Vercel/Railway split is the more common Next.js default, but one dashboard and one billing relationship is worth more here than Vercel's DX edge, especially since the worker needs a long-running home anyway.

**Polling for gameweek completion.** FPL has no webhooks. `bootstrap-static` exposes `event.finished` and `event.data_checked`; polling every 30-60 minutes is ample given gameweeks resolve weekly. Last-seen GW state is persisted per league so a restart or a double-poll can't double-send.

**Caching `bootstrap-static`.** It's large and changes rarely within a week (fixtures, deadlines, prices). A short TTL keeps request volume low and means a transient FPL outage doesn't immediately break a digest.

**Both delivery channels in v1.** Email is fully automated. WhatsApp is a formatted plain-text block the owner pastes into their group — this avoids Meta Business API business verification and template approval, which can take weeks and would block validating the core value prop. Automating WhatsApp is a fast-follow once owners confirm they want it.

## Deferred

Not in the MVP; see [ROADMAP.md](./ROADMAP.md) for the full list.

- **WhatsApp Business Cloud API / Twilio automation** — replaces the copy-paste step
- **Member-facing auth** — only needed once members get personal recaps, polls, or a login
- **Multi-league / multi-season support** — schema should not actively prevent it, but v1 assumes one league per owner
- **H2H leagues** — different standings model; classic only for now
- **Other fantasy platforms** — would require abstracting the FPL client into a per-platform data-fetch interface
