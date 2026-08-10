# News Radar

Daily news radar for two lanes: **QA/testing leadership** and **AI & agent tooling**.
Collects via `agent-reach`, mails a digest, publishes a dashboard.

Sibling of `job-radar` (`~/Documents/projects/job-radar`) and deliberately mirrors its
shape: zero runtime deps, `config.ts` as the only file you edit to retune, seen-history
so only genuinely new items get mailed.

Own repo: <https://github.com/mrpet88/news-radar> (private). Extracted from
`personal-projects` via `git subtree split`, so its history is preserved there.

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

**2. Email delivery** — `.github/workflows/news-radar.yml` needs `MAIL_USERNAME` /
`MAIL_PASSWORD` / `MAIL_TO` repo secrets (a Gmail **app password**, not the account
password). Its `schedule:` block is commented out until those exist; without
`MAIL_USERNAME` the mail step skips cleanly, so a dry run via **Actions → Run
workflow** is safe.

**3. Twitter/X** needs nothing — it runs through OpenCLI against the logged-in Chrome
session, same as reddit. Just keep Chrome open and logged in to x.com.

Not twitter-cli: version 0.8.5 cannot build the `x-client-transaction-id` header X now
requires, so every call including `whoami` fails with HTTP 400 no matter how valid the
cookies are. A `.env` with `TWITTER_AUTH_TOKEN`/`TWITTER_CT0` is therefore **not needed**
and can be deleted. The loader in `reach-collect.mjs` stays for any future channel that
does need a credential.

⚠️ **Twitter is the weakest channel.** Open search on X yields roughly 1 usable item per
24 collected for these topics — the rest is marketing, engagement bait and off-topic
matches, and it costs ~50s per run. The filters in `noise` (global spam list, hype
patterns, mention-stuffing) hold the junk back, but the durable fix is curated accounts
rather than open search: add `--from <handle>` per query in `collectTwitter`, or build an
X list and read it with `opencli twitter list-tweets`. Consider dropping the channel if
it does not earn its 50 seconds.

## Why this lives in ~/Projects and not ~/Documents
macOS TCC blocks a LaunchAgent from reading `~/Documents`, `~/Desktop` and
`~/Downloads`. A job scheduled from there fails with `can't open input file` unless
you grant Full Disk Access to `/bin/zsh` — which would hand FDA to every script any
launchd job runs. Living outside those folders needs no privacy permission at all.
Moving this project back under `~/Documents` will break the schedule.

## Channel status (verified 2026-08-11)
| channel | state | notes |
|---|---|---|
| exa | working | ~36/run. Semantic search, no date filter — recency enforced in `scoreItem` |
| rss | working | 4 QA + 3 AI feeds. `martinfowler.com/feed.atom` refuses connections, so it is out |
| reddit | working | needs Chrome open; `--window background` keeps it from stealing focus |
| github | working | star floor of 120, else `--sort updated` returns only fresh personal repos |
| twitter | working | via OpenCLI + Chrome, not twitter-cli (0.8.5 is broken against X). Low signal: ~1 keeper per 24 |

## Email gating
The digest is written **only** when the reach payload is <24h old *and* there are new
items. Stale reach ⇒ no email, but `data/index.html` still updates and shows how old the
collection is. If nothing has been mailed for 3 days a one-line heartbeat goes out so a
broken pipeline is distinguishable from a quiet one.

## Conventions
- Edit `src/config.ts` to change what's tracked — topics, tiers, feeds, queries. No code changes.
- Every collector is best-effort: it records a per-channel status and never fails the run.
- Never `git init` here — this lives inside the `personal-projects` repo.
