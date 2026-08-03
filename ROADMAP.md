# FPheLp — MVP & Roadmap

(Working name, folder/repo name TBD)

## Purpose
Facilitate a private fantasy league owner's communications with their group (WhatsApp/email), by automating standings, results, and money-pot updates instead of manual posting.

Primary actor: **the league owner/manager**. League members are recipients of content (digests pushed to channels they already use), not users of a separate app.

First target: English Premier League Fantasy (FPL) classic private leagues, via the unofficial-but-first-party FPL API (fantasy.premierleague.com).

---

## MVP Feature Set

**Core loop: fetch → digest → deliver**

1. **League setup (one-time)**
   - Owner enters private league ID (+ optionally their own manager/team ID)
   - Validate via `leagues-classic/{id}/standings/`
   - Choose delivery channel: email first (simplest), WhatsApp as fast-follow

2. **Money pot tracking**
   - Assumes flat entry fee — everyone in the league pays the same amount, so no per-manager manual entry needed
   - Owner enters: entry fee amount, prize distribution (e.g. 1st/2nd/3rd %, or monthly prizes, etc.)
   - App computes total pot from `standings.results` count × entry fee, and payout amounts per position
   - Digest includes updated pot total / payout breakdown alongside standings

3. **Automated gameweek digest**
   - Triggered when GW results are final (`bootstrap-static` → `event.finished` + `data_checked`)
   - Content: standings table, rank movement vs last GW, GW winner, biggest riser/faller, top GW scorer, league average
   - Delivered as WhatsApp-friendly text or HTML email

4. **Deadline reminder**
   - Scheduled push before each GW deadline

5. **Lightweight season narrative stats**
   - Manager of the month, worst GW ever, longest streak — computed from cached history

6. **Manual "send now" trigger**
   - On-demand digest outside the automated schedule

### Explicitly out of MVP
- Multi-league support
- Member-facing polls/predictions
- H2H leagues (classic only for v1)
- Public shareable web page
- Season rollover automation
- Other fantasy platforms (see roadmap below)

---

## Future Roadmap

- **Variable/uneven entry fees or side-pots** — beyond the flat-fee assumption (e.g. optional side bets, buy-ins mid-season)
- **Multi-league support** — one owner running several leagues/seasons from one dashboard
- **H2H (head-to-head) league support** — different standings model than classic
- **Member-facing features** — personal weekly recap, H2H trash-talk stats, predictions/polls embedded in digest, public read-only standings page
- **Public shareable web page** per league (no login, just a link)
- **Season rollover automation** — recreate league, re-invite members, carry over trophies/history
- **End-of-season summary/awards** — auto-generated recap doc/image
- **League health monitoring** — flag inactive managers
- **Export/archive** — CSV/PDF of standings and history
- **Support for other fantasy league platforms** beyond EPL FPL:
  - Other football leagues with fantasy platforms (e.g. Champions League Fantasy)
  - Other sports' fantasy platforms (NFL, NBA, etc.) — would require abstracting the data-fetch layer per platform's API/scraping needs, since none will share FPL's endpoint shapes
