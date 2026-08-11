# News Radar

A personal news radar. It collects from several sources every morning, scores what it
finds against topic lanes you define, and emails you only what is genuinely new —
with a filterable dashboard behind it.

Two lanes ship by default: **QA / testing leadership** and **AI / agent tooling**.
Both are configuration, not code — see [Configuring what it tracks](#configuring-what-it-tracks).

```
News Radar — 9 new (2 QA / Testing, 7 AI / Agents)

  [AI]  Auto mode is now the default in Claude Code for Pro, Max and Team plans
  [AI]  MCP Spec Update: Breaking Changes, Stateless Transport, and How to Migrate
  [QA]  Most "Flaky Tests" Are Really Architecture Tests
  …
```

Built with zero runtime dependencies — Node's own `fetch` and nothing else.
MIT licensed.

---

## How it works

Collection and delivery run in different places, on purpose:

```
  YOUR MAC (launchd, 4×/day)              GITHUB ACTIONS (06:30 UTC daily)
  ───────────────────────────             ────────────────────────────────
  scripts/reach-collect.mjs               npm start
    → queries each channel                  → reads data/reach-raw.json
    → data/reach-raw.json                   → scores, dedupes, diffs vs seen-history
    → commits + pushes                      → writes digest.html + data/index.html
                                            → emails (if the gate passes)
```

**Collection only happens on your machine.** Every channel needs something a CI runner
does not have: local `mcporter` configuration for semantic search, a `gh` token, or a
logged-in Chrome session for Reddit. Actions never collects — it renders and delivers
whatever your Mac last pushed. That is what makes the email provably backed by a real
collection rather than by nothing.

The consequence is the **freshness gate**: an email is only ever sent when the collection
behind it is under 24 hours old. If your Mac was asleep, no email goes out — but the
dashboard still updates and shows exactly how stale the data is.

---

## Requirements

- macOS (the scheduler is a LaunchAgent) and Node 22+
- [`agent-reach`](https://github.com/Panniantong/Agent-Reach) with a working `mcporter`
  setup for the `exa` channel
- `gh` (GitHub CLI), authenticated — used both for the `github` channel and for pushing
- Chrome, logged in to Reddit, for the `reddit` channel
- A Gmail account with 2FA, for delivery

Run `agent-reach doctor --json` to see which channels your machine can currently serve.

---

## Setup

### 1. Install and build

```bash
npm install && npm run build
```

### 2. Schedule the collector

```bash
./scripts/install-agent.sh
```

This generates the LaunchAgent from `scripts/news-radar.plist.template`, substituting
this checkout's path. The plist is generated rather than committed precisely so that no
absolute path — and therefore no local account name — ever enters the repository.

It fires at **06:45 / 12:45 / 18:45 / 22:45** but does real work **at most once per 20
hours**. Four times is not four collections; it is four chances to catch the machine
awake. Each run checks three things first and exits quietly otherwise:

1. Chrome is running (Reddit needs it)
2. no successful collection in the last 20h
3. the build succeeds

launchd also re-runs a missed slot at next wake, so no polling loop is needed.

> **The project must live outside `~/Documents`, `~/Desktop` and `~/Downloads`.** macOS
> TCC blocks LaunchAgents from reading those, and the job dies with an opaque
> `can't open input file` even though the same script runs fine by hand. The installer
> refuses to install from those locations rather than let you discover it at 06:45.

### 3. Email delivery

Add three repository secrets:

| secret | value |
|---|---|
| `MAIL_USERNAME` | the sending Gmail address |
| `MAIL_PASSWORD` | a Gmail **app password** — [create one](https://myaccount.google.com/apppasswords) |
| `MAIL_TO` | where the digest should go |

The mail step requires both `MAIL_USERNAME` and `MAIL_PASSWORD` to be present, so the
workflow is safe to run before they exist — it simply skips delivery.

> **If SMTP returns `535-5.7.8 BadCredentials`:** Google's app-password box separates the
> four groups with **non-breaking spaces** (U+00A0), which survive a copy-paste and which
> `[[:space:]]` does not match. Store only the 16 alphanumeric characters. To check what
> is actually stored, compare `${#MAIL_PASSWORD}` against
> `printf '%s' "$MAIL_PASSWORD" | LC_ALL=C tr -cd 'a-zA-Z0-9' | wc -c` — both should be 16.

### 4. Try it

```bash
npm run all          # collect → render → write digest.html + data/index.html
open data/index.html
```

Or exercise the delivery path without waiting for tomorrow:

```bash
gh workflow run news-radar.yml -f force_digest=true
```

---

## Configuring what it tracks

Everything lives in [`src/config.ts`](src/config.ts). No code changes needed.

A **lane** is a topic with its own keyword tiers, exclusions, per-channel queries and a
cap on how many rows it may contribute to the email:

```ts
{
  id: "qa",
  label: "QA / Testing",
  maxPerDigest: 6,
  keywordTiers: [
    { tier: "core",     weight: 10, groups: [["test", "strategy"], ["flaky", "test"]] },
    { tier: "adjacent", weight: 4,  groups: [["playwright"], ["load", "testing"]] },
  ],
  excludeKeywords: ["pharmaceutical", "air quality", "crash test"],
  exaQueries: ["recently published blog post about software test strategy"],
  feeds: [{ name: "Google Testing Blog", url: "https://testing.googleblog.com/feeds/posts/default" }],
}
```

A group matches when **all** its terms appear; a tier matches when **any** group does.
The highest matched weight becomes the score. Lanes are filled independently against
their own caps before the global ceiling applies, so a busy week in one lane cannot
crowd the other out of the email entirely.

---

## Channels

| channel | source | needs |
|---|---|---|
| `exa` | semantic web search | `mcporter` configured locally |
| `rss` | curated publisher feeds | nothing |
| `reddit` | named subreddits | Chrome logged in to Reddit |
| `github` | `gh search repos` | `gh` authenticated |
| `twitter` | X search | Chrome logged in to x.com — **disabled by default** |

Every channel is best-effort: it records its own status and never fails the run. A
channel that errored is reported differently from one that ran and found nothing, and
both are visible on the dashboard.

**Twitter is off deliberately.** It works, but open search on X returned roughly one
usable item per twenty-four collected. Three rounds of filtering each caught that round's
junk while the next brought different junk — crypto tokens, then marketing contests, then
listicles. That is a source problem, not a filter problem. To make it useful, name the
accounts worth reading:

```ts
twitterHandles: ["simonw", "swyx"],          // becomes a from: clause
enabled: ["exa", "github", "rss", "reddit", "twitter"],
```

---

## Design notes

Things that are non-obvious, and why they are the way they are.

**Documentation is filtered structurally.** Semantic search is not a news wire: ask it
about MCP and it returns the SDK reference, which is an excellent page and not news. The
first run came back 4/6 documentation, so reference material is excluded by URL and title
shape rather than by hoping query wording keeps it out.

**Recency is scored, not just filtered.** A daily radar is about what changed, so a
two-year-old page that matches perfectly loses to yesterday's post that matches
adequately. Undated pages take a small penalty — most reference material reports no
publish date, which is itself a signal.

**Channels are weighted.** A blog post published today is a story; a repository pushed
today is usually just someone committing. Without weighting, `gh search --sort updated`
floods the digest with brand-new personal projects because every one looks maximally
fresh. A star floor handles the rest.

**Deduplication runs twice.** Once by canonical URL, to collapse the same link arriving
via different channels, and once by normalised title — because aggregate feeds carry the
same post under different permalinks, which share a headline and nothing else.

**Only a real digest advances `seen-history`.** If the freshness gate blocks an email,
those items stay new and remain mailable once collection recovers. Marking them seen
would swallow them permanently.

**A heartbeat separates quiet from broken.** If nothing has been mailed for three days,
one line goes out saying so. Silence otherwise means you cannot tell a dead pipeline from
a slow news week.

---

## Data and privacy

`data/` is committed, because Actions needs the collection your Mac produced and the
state must survive between runs.

Nothing personal goes in it. The collector does not record the collecting machine's
hostname, and it does not store the usernames of people whose public posts it collects —
that field existed briefly, was rendered nowhere, and only amounted to committing about
110 third-party identities per run. Titles, links and summaries of public posts are
retained; the people who wrote them are not named.

The LaunchAgent plist is generated at install time so no absolute path is committed, and
automated commits use the repository-local git identity rather than inheriting a global
one — which is how a work address ends up on a personal project.

| file | written by | purpose |
|---|---|---|
| `data/reach-raw.json` | your Mac | the raw collection; the freshness gate reads its timestamp |
| `data/seen-history.json` | Actions | what has already been surfaced, 60-day TTL |
| `data/digest-state.json` | Actions | last digest / heartbeat, for the quiet-period check |
| `data/items.json`, `data/index.html` | Actions | the rendered dashboard |

Each file has exactly one writer. Both sides writing the same generated files made every
push a conflict with no meaningful side to prefer.

---

## Troubleshooting

| symptom | cause |
|---|---|
| `can't open input file` in `data/launchd.log` | project is under a TCC-protected folder; move it |
| `535 BadCredentials` from SMTP | app password stored with Google's non-breaking spaces |
| no email, dashboard still updating | freshness gate — the collection is over 24h old |
| a channel reports "skipped" | precondition unmet (Chrome closed, credential absent) |
| digest keeps re-sending the same items | `seen-history.json` is not being committed back |

Useful environment variables:

- `NEWS_RADAR_DIGEST_FORCE=true` — render a digest even when nothing is new
- `NEWS_RADAR_MAX_AGE_HOURS` — override the 24h freshness gate
- `REACH_CHANNELS=exa,github` — restrict the collector to named channels, including
  disabled ones
