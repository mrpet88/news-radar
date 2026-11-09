# News Radar

A personal news radar. It collects from several sources every day, scores what it
finds against topic lanes you define, and emails you only what is genuinely new —
with a filterable dashboard behind it.

Two lanes ship by default: **QA / testing leadership** and **AI / agent tooling**.
Both are configuration, not code — see [Configuring what it tracks](#configuring-what-it-tracks).

Below the radar, the same email carries a **newspaper**: top headlines from Dutch and
international outlets, and the newest Marktplaats listings in a few categories under a
price you set. See [The newspaper](#the-newspaper).

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

Everything runs in GitHub Actions; no local machine is involved.

```
  GITHUB ACTIONS (one delivery a day, 12:00 Amsterdam)
  ────────────────────────────────────────────────────
  reach-collect.mjs  REACH_SIDE=cloud
    → exa, github, rss, reddit, news, marktplaats
    → data/reach-cloud.json
  npm start
    → scores, dedupes, diffs vs seen-history
    → writes digest.html + data/index.html, emails if the gate passes
```

Every enabled channel needs only the network, which is what `collector.cloudChannels`
in `src/config.ts` lists. A channel left off that list would have to be collected on a
local machine (`REACH_SIDE=mac` into `data/reach-mac.json`, merged while under 36h old).
Only twitter needs that, because it drives a logged-in Chrome, and it is off.

**When it arrives: around 12:00 Amsterdam time.** GitHub starts scheduled runs hours
late (a 06:37 UTC cron has landed anywhere from 11:08 to 16:03 UTC), so a single noon
cron would mean an afternoon email. The workflow instead ticks every 30 minutes from
05:17 to 12:47 UTC, and its `gate` job lets one tick a day through: a tick that lands
between 10:00 and 12:00 local waits until 12:00 and then delivers; one that lands after
12:00 delivers at once unless today's run already happened; every other tick ends in
seconds. If GitHub delays every tick past noon, the email comes with the first one.
A run started by hand from the Actions tab skips the gate and always may send.

The **freshness gate** still applies: an email is only sent when the merged collection
behind it is under 24 hours old. In practice that closes only if the Actions collection
itself fails — and after two days of that the heartbeat says **BROKEN**, not "quiet".

---

## Requirements

- Node 22+, to run or test it locally
- A GitHub repository with Actions and Pages enabled. The workflow installs `mcporter`
  pointed at Exa's hosted endpoint (no key) and uses the job's own token for `gh`.
- A Gmail account with 2FA, for delivery

---

## Setup

### 1. Install and build

```bash
npm install && npm run build
```

### 2. Schedule

Nothing to install: the workflow's schedule is in `.github/workflows/news-radar.yml`.
To change the delivery time, change the hour in its `gate` job (and keep the cron
range covering it in both CET and CEST).

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

A group matches when **all** its terms appear (whole words, plural allowed: `agent`
matches "agents"); a tier matches when **any** group does. The highest matched weight
becomes the score.

A feed marked `trusted: true` is on-topic by construction, so its posts join the lane
even when they match no keyword, at `trustedFeedWeight` (default 4, the adjacent tier).
Use it for single-topic writers, not aggregators — Hacker News stays keyword-scored. Lanes are filled independently against
their own caps before the global ceiling applies, so a busy week in one lane cannot
crowd the other out of the email entirely.

---

## Channels

| channel | source | runs on | needs |
|---|---|---|---|
| `exa` | semantic web search | Actions | nothing (hosted MCP endpoint) |
| `rss` | curated publisher feeds | Actions | nothing |
| `github` | `gh search repos` | Actions | the job token |
| `reddit` | named subreddits, public feed | Actions | nothing |
| `twitter` | X search | a local machine | Chrome logged in to x.com — **disabled by default** |
| `news` | publisher RSS feeds (newspaper) | Actions | nothing |
| `marktplaats` | Marktplaats search API (newspaper) | Actions | nothing |

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

## The newspaper

The second half of the email and two dashboard tabs, configured by `newspaper` and
`marktplaats` in `src/config.ts`. Nothing here is scored against the lanes — a BBC story
about AI is world news, not a radar pick — so the two halves never leak into each other.

**Headlines.** Four sections (Netherlands, World, Tech & science, Economy & money), five
headlines each, in the outlets' own order. Within a section the feeds take turns, newest
first, so a high-volume outlet cannot own a section. Anything older than 36 hours or
already mailed is skipped.

**Translation.** Dutch headlines (feeds marked `lang: "nl"`) are translated to English
with DeepL, with the Dutch original in small type underneath. DeepL's free "Developer"
plan is a *one-time* credit of 1M characters, not a monthly allowance, so only headlines
that go into the email are translated, each exactly once (cached in
`data/translations.json`). That is roughly 330k characters a year — about three years of
credit. The dashboard reuses cached translations and never spends any. Without the
`DEEPL_API_KEY` secret, or once the credit is gone, titles stay Dutch and the dashboard's
`translate` chip says why.

**Marktplaats.** The newest listings per category, nationwide, capped at five per
category in the email, each with a thumbnail, price and city. Price ranges and categories
are per search:

```ts
{ id: "bikes", label: "Bikes", categoryIds: [445], minEur: 1, maxEur: 250,
  onlyPaths: ["fietsen-"], skipPaths: ["kinderfiets"] },
```

`categoryIds` are Marktplaats' top-level categories. `onlyPaths` / `skipPaths` match the
subcategory in the listing's URL (`/v/fietsen-en-brommers/fietsen-dames-damesfietsen/…`),
which is what separates a bike from a bike part. Listings with no asking price and
"gevraagd"/"wij kopen" ads are dropped. Paid "Dagtopper" boosts are *not* a filter —
almost every listing has one, private sellers included — but a boosted listing that
resurfaces is the same URL, so it is never sent twice.

Only a listing's title, price, city, thumbnail and link are stored. Seller names and
descriptions are not: the collection is committed to this repository.

Only what was actually mailed counts as seen. The dashboard lists run longer than the
email, and a headline or listing that did not make the cut stays eligible for tomorrow.

Vinted is not included: its API refuses requests that do not come from a real browser.

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

`data/` is committed, because the state must survive between Actions runs.

Nothing personal goes in it. The collector does not record the collecting machine's
hostname, and it does not store the usernames of people whose public posts it collects —
that field existed briefly, was rendered nowhere, and only amounted to committing about
110 third-party identities per run. Titles, links and summaries of public posts are
retained; the people who wrote them are not named.

Automated commits use a bot identity, and any commit made from a checkout should use the
repository-local git identity rather than inheriting a global one — which is how a work
address ends up on a personal project.

| file | written by | purpose |
|---|---|---|
| `data/reach-cloud.json` | Actions | the collection: every enabled channel |
| `data/seen-history.json` | Actions | what has already been surfaced, 60-day TTL |
| `data/digest-state.json` | Actions | last digest / heartbeat, for the quiet-period check |
| `data/items.json`, `data/index.html` | Actions | the rendered dashboard |
| `data/translations.json` | Actions | DeepL translations of mailed Dutch headlines, 60-day TTL |

Each file has exactly one writer. When a Mac also collected, both sides writing the same
generated files made every push a conflict with no meaningful side to prefer.

---

## Troubleshooting

| symptom | cause |
|---|---|
| `535 BadCredentials` from SMTP | app password stored with Google's non-breaking spaces |
| no email, dashboard still updating | freshness gate — check the Collect step of the Actions run |
| "BROKEN" heartbeat email | no fresh collection for 48h+ — check the Collect step of the Actions run |
| reddit failed with HTTP 403/429 | Reddit refused or rate-limited the runner's feed request |
| no email at noon | GitHub delayed every tick; the gate job's log says what each tick decided |
| a channel reports "skipped" | precondition unmet (credential absent) |
| digest keeps re-sending the same items | `seen-history.json` is not being committed back |

Useful environment variables:

- `NEWS_RADAR_DIGEST_FORCE=true` — render a digest even when nothing is new
- `NEWS_RADAR_MAX_AGE_HOURS` — override the 24h freshness gate
- `REACH_SIDE=cloud` — collect the Actions channels (the default collects local-only ones)
- `REACH_CHANNELS=reddit,rss` — collect only these channels
  (writes `data/reach-cloud.json`); the default is `mac`
- `REACH_CHANNELS=exa,github` — restrict the collector to named channels of that side,
  including disabled ones
