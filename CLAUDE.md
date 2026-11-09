# News Radar — working notes

**Read [README.md](README.md) first.** It covers what this is, the architecture, setup,
configuration and the design decisions. This file holds only what is specific to working
*on* the code.

## Stack
TypeScript → `dist/`, Node 22+, **no runtime dependencies** (native `fetch` only).
The collector is plain ESM (`scripts/reach-collect.mjs`); it imports the compiled config
from `dist/` so there is one source of truth. **Everything runs in GitHub Actions**
(`REACH_SIDE=cloud`, every channel in `collector.cloudChannels`). There is no local
scheduler any more: the Mac side (LaunchAgents, Chrome-driven reddit, idle-time trigger)
was removed on 2026-11-09 because it ran on a monitored work laptop.

```bash
npm install && npm run build
REACH_SIDE=cloud node scripts/reach-collect.mjs   # → data/reach-cloud.json
REACH_SIDE=cloud REACH_CHANNELS=reddit node scripts/reach-collect.mjs  # one channel
npm start                           # render → digest.html + data/index.html
npm run all                         # both
```

Sibling project: `job-radar`, same shape, same delivery pattern.

## Conventions

- **`src/config.ts` is the only file to edit to retune** what is tracked. If a change
  needs code, ask whether it belongs in config instead.
- **Every collector is best-effort.** Wrap failures, record a per-channel status, never
  fail the run. A channel that errored must stay distinguishable from one that ran and
  found nothing — the dashboard and the digest both rely on that.
- **Nothing personal in tracked files.** No absolute home paths, no hostnames, no email
  addresses, no third-party usernames. The collector omits both the machine name and
  post authors for exactly this reason. This repo is
  publishable; keep it that way.
- **Actions owns every data file.** Don't render locally and commit the outputs: a local
  render plus `pull --autostash` is what wedged a checkout for five weeks in 2026.
- **Don't reintroduce a local scheduler** (LaunchAgents, idle-time polling, browser
  automation) without asking — those tripped the employer's endpoint security.
- Commits use the repo-local git identity, which is the GitHub noreply address. Do not
  add `-c user.email=...` overrides — that publishes whatever is hardcoded.

## Gotchas that cost real time

- **`stripHtml` order is load-bearing.** Feeds deliver entity-encoded markup, so entities
  must be decoded *before* tags are stripped. Decoding afterwards re-creates the tags as
  visible text.
- **`[[:space:]]` does not match U+00A0.** This is why a Gmail app password can look
  clean and still be rejected — see the README's troubleshooting table.
- **twitter-cli 0.8.5 is broken against X** (cannot build `x-client-transaction-id`;
  every call including `whoami` returns HTTP 400). The twitter channel uses OpenCLI's
  browser session instead, and needs no credential.
- **Newspaper items bypass lane scoring.** They carry `section`; `isPaperItem` splits
  them off in `index.ts` before `scoreItem`. Unlike radar items, only what was mailed
  is written to seen-history.
- **Marktplaats: nearly every listing is a paid "Dagtopper"**, private sellers too, and
  unboosted ones are mostly dealer feeds. Filtering on `priorityProduct` empties the
  results. Filter on subcategory slug (`vipUrl` segment 3) instead.
- **DeepL credit is one-time, not monthly** (Developer plan: 1M characters total, hard
  limit — HTTP 456 when spent, no billing). `src/translate.ts` therefore translates only
  headlines picked for the email, only when the gate is open, and caches by item id.
  Don't widen it to the dashboard or Marktplaats without redoing the arithmetic.
- **Exa has no date filter.** Recency is enforced in `scoreItem`, not at query time.
- **GitHub starts scheduled runs hours late** (06:37 UTC landed 11:08–16:03 UTC). Hence
  the half-hourly ticks plus the `gate` job that holds one until 12:00 Amsterdam. Jobs
  check out the branch tip, not `github.sha`: a tick queued behind the noon run would
  otherwise read stale state and mail again.
- **Reddit's anonymous feed allows about one request a minute.** Each lane fetches one
  combined `r/a+b/new/.rss`, and a 429 waits out `x-ratelimit-reset`. Authors are cut
  from the entry body before parsing.

## Channel status (verified 2026-09-24; reddit 2026-11-09)

| channel | runs on | state | notes |
|---|---|---|---|
| exa | Actions | working | ~36/run; hosted endpoint, no key |
| rss | Actions | working | 4 QA + 3 AI feeds; `martinfowler.com/feed.atom` refuses connections and is out |
| github | Actions | working | job token; star floor 120, else `--sort updated` returns only fresh personal repos |
| reddit | Actions | moved 2026-11-09 | public `/new/.rss`, one combined feed per lane (~32/run from the Mac); first Actions run pending verification |
| news | Actions | working | 10 feeds across 4 sections, ~150/run |
| marktplaats | Actions | working | `/lrp/api/search`, no key; ~130/run after subcategory filters |
| twitter | local only | **disabled** | needs OpenCLI + logged-in Chrome; ~1 keeper per 24 — see README |
