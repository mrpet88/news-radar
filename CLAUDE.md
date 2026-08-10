# News Radar

Daily news radar for two lanes: **QA/testing leadership** and **AI & agent tooling**.
Collects via `agent-reach`, mails a digest, publishes a dashboard.

Sibling of `job-radar` (`~/Documents/projects/job-radar`) and deliberately mirrors its
shape: zero runtime deps, `config.ts` as the only file you edit to retune, seen-history
so only genuinely new items get mailed.

## Stack
TypeScript → `dist/`, Node 22+, **no runtime dependencies** (native `fetch` only).
The collector is plain ESM (`scripts/reach-collect.mjs`) so launchd can run it with no build step.

## Architecture

    launchd (4×/day, local)          GitHub Actions (07:30)
    ─────────────────────────        ──────────────────────
    reach-collect.mjs                npm start
      → agent-reach channels           → reads data/reach-raw.json
      → data/reach-raw.json            → score, dedupe, diff vs seen-history
      → git commit + push              → digest.html + data/index.html
                                       → email (gated) + Pages

**Collection only happens locally.** agent-reach needs this Mac's Chrome session and
`mcporter` config, neither of which exists on a CI runner. Actions never collects — it
renders and delivers what the Mac last pushed. That's what makes the email
agent-reach-backed by construction.

## Run commands

```bash
npm install && npm run build
node scripts/reach-collect.mjs      # collect (agent-reach) → data/reach-raw.json
npm start                           # render → digest.html + data/index.html
open data/index.html
```

Useful env:
- `NEWS_RADAR_DIGEST_FORCE=true` — render a digest even when nothing is new (tests the mail path)
- `NEWS_RADAR_MAX_AGE_HOURS` — override the 24h reach-freshness gate
- `REACH_CHANNELS=exa,github` — restrict the collector to named channels

## Setup

**1. Schedule the local collector** (this is the half that does the work):

```bash
cp scripts/com.mrpet88.news-radar.plist ~/Library/LaunchAgents/ && launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.mrpet88.news-radar.plist
```

Fires 06:45 / 12:45 / 18:45 / 22:45, works at most once per 20h, skips silently when
Chrome is closed. Logs to `data/launchd.log`. Force a run with
`launchctl kickstart -k gui/$(id -u)/com.mrpet88.news-radar`.

**2. Email delivery** — `.github/workflows/news-radar.yml` must be copied to the
**repo root** (`personal-projects/.github/workflows/`) to run at all, and needs
`MAIL_USERNAME` / `MAIL_PASSWORD` / `MAIL_TO` secrets. Its `schedule:` block is
commented out until those exist. Without secrets the mail step skips cleanly.

**3. Twitter/X** is the one dark channel — it needs `TWITTER_AUTH_TOKEN` and
`TWITTER_CT0` exported (`agent-reach configure twitter-cookies`). Everything else
works today.

## Channel status (verified 2026-08-11)
| channel | state | notes |
|---|---|---|
| exa | working | ~36/run. Semantic search, no date filter — recency enforced in `scoreItem` |
| rss | working | 4 QA + 3 AI feeds. `martinfowler.com/feed.atom` refuses connections, so it is out |
| reddit | working | needs Chrome open; `--window background` keeps it from stealing focus |
| github | working | star floor of 120, else `--sort updated` returns only fresh personal repos |
| twitter | needs cookies | skips cleanly, reported as a precondition rather than a failure |

## Email gating
The digest is written **only** when the reach payload is <24h old *and* there are new
items. Stale reach ⇒ no email, but `data/index.html` still updates and shows how old the
collection is. If nothing has been mailed for 3 days a one-line heartbeat goes out so a
broken pipeline is distinguishable from a quiet one.

## Conventions
- Edit `src/config.ts` to change what's tracked — topics, tiers, feeds, queries. No code changes.
- Every collector is best-effort: it records a per-channel status and never fails the run.
- Never `git init` here — this lives inside the `personal-projects` repo.
