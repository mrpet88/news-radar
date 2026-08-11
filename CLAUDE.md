# News Radar

Daily news radar for two lanes: **QA/testing leadership** and **AI & agent tooling**.
Collects via `agent-reach`, mails a digest, publishes a dashboard.

Sibling of `job-radar` (`~/Documents/projects/job-radar`) and deliberately mirrors its
shape: zero runtime deps, `config.ts` as the only file you edit to retune, seen-history
so only genuinely new items get mailed.

Own repo: <https://github.com/mrpet88/news-radar>. Extracted from
`personal-projects` via `git subtree split`, so its history is preserved there.

## Stack
TypeScript → `dist/`, Node 22+, **no runtime dependencies** (native `fetch` only).
The collector is plain ESM (`scripts/reach-collect.mjs`) so launchd can run it with no build step.

## Architecture

    launchd (4×/day, local)          GitHub Actions (06:30 UTC)
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
./scripts/install-agent.sh
```

The plist is generated from `scripts/news-radar.plist.template` at install time rather
than committed: launchd needs absolute paths, and a committed absolute path would put
the local account name in the repository.

Fires 06:45 / 12:45 / 18:45 / 22:45, works at most once per 20h, skips silently when
Chrome is closed. Logs to `data/launchd.log`. Force a run with
`launchctl kickstart -k gui/$(id -u)/local.news-radar`.

**2. Email delivery** — `.github/workflows/news-radar.yml` needs `MAIL_USERNAME` /
`MAIL_PASSWORD` / `MAIL_TO` repo secrets (a Gmail **app password**, not the account
password). Enabled and running daily at 06:30 UTC. The mail step needs both
`MAIL_USERNAME` and `MAIL_PASSWORD` present or it skips, so a dry run is safe.

If SMTP ever returns `535 BadCredentials`: Google's app-password box separates the
four groups with **non-breaking spaces**, which survive a copy and which
`[[:space:]]` does not match. Store only the 16 alphanumerics.

**3. Twitter/X** needs nothing — it runs through OpenCLI against the logged-in Chrome
session, same as reddit. Just keep Chrome open and logged in to x.com.

Not twitter-cli: version 0.8.5 cannot build the `x-client-transaction-id` header X now
requires, so every call including `whoami` fails with HTTP 400 no matter how valid the
cookies are. A `.env` with `TWITTER_AUTH_TOKEN`/`TWITTER_CT0` is therefore **not needed**
and can be deleted. The loader in `reach-collect.mjs` stays for any future channel that
does need a credential.

⚠️ **Twitter is OFF by default** (`collector.enabled` in `config.ts`) — working, but not
earning its ~60s. Open search on X yielded ~1 usable item per 24 collected here, and
three rounds of filtering each caught that round's junk while the next brought different
junk: crypto tokens, then marketing contests, then listicles. That is a source problem,
not a filter problem.

To make it useful, name the accounts worth reading and switch it on:

```ts
// in a lane
twitterHandles: ["simonw", "swyx"],
// and
enabled: ["exa", "github", "rss", "reddit", "twitter"],
```

Handles become a `from:` clause, so it reads those accounts instead of the firehose.
`opencli twitter list-tweets` is the other option if you keep a curated X list.

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
| twitter | works, **disabled** | via OpenCLI + Chrome, not twitter-cli (0.8.5 is broken against X). Off in `collector.enabled`: ~1 keeper per 24, ~60s/run |

## Email gating
The digest is written **only** when the reach payload is <24h old *and* there are new
items. Stale reach ⇒ no email, but `data/index.html` still updates and shows how old the
collection is. If nothing has been mailed for 3 days a one-line heartbeat goes out so a
broken pipeline is distinguishable from a quiet one.

## Conventions
- Edit `src/config.ts` to change what's tracked — topics, tiers, feeds, queries. No code changes.
- Every collector is best-effort: it records a per-channel status and never fails the run.
- Nothing personal in tracked files: no absolute home paths, no hostnames, no email
  addresses. The plist is templated and the collector omits the machine name for
  exactly this reason. Keep it that way — this repo is publishable.
