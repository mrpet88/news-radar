# News Radar — working notes

**Read [README.md](README.md) first.** It covers what this is, the architecture, setup,
configuration and the design decisions. This file holds only what is specific to working
*on* the code.

## Stack
TypeScript → `dist/`, Node 22+, **no runtime dependencies** (native `fetch` only).
The collector is plain ESM (`scripts/reach-collect.mjs`) so launchd runs it without a
build step; it imports the compiled config from `dist/` so there is one source of truth.

```bash
npm install && npm run build
node scripts/reach-collect.mjs      # collect → data/reach-raw.json
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
  addresses, no third-party usernames. The plist is a template and the collector omits
  both the machine name and post authors for exactly this reason. This repo is
  publishable; keep it that way.
- **One writer per data file.** `reach-raw.json` belongs to the Mac; the render outputs
  and state files belong to Actions. Both sides writing the same file made every push a
  conflict in generated content.
- Commits use the repo-local git identity, which is the GitHub noreply address. Do not
  add `-c user.email=...` overrides — that publishes whatever is hardcoded.

## Gotchas that cost real time

- **macOS TCC** blocks LaunchAgents from `~/Documents`, `~/Desktop`, `~/Downloads`. The
  failure is `can't open input file` while the same script runs fine by hand.
  `install-agent.sh` refuses those locations.
- **`stripHtml` order is load-bearing.** Feeds deliver entity-encoded markup, so entities
  must be decoded *before* tags are stripped. Decoding afterwards re-creates the tags as
  visible text.
- **`[[:space:]]` does not match U+00A0.** This is why a Gmail app password can look
  clean and still be rejected — see the README's troubleshooting table.
- **twitter-cli 0.8.5 is broken against X** (cannot build `x-client-transaction-id`;
  every call including `whoami` returns HTTP 400). The twitter channel uses OpenCLI's
  browser session instead, and needs no credential.
- **Exa has no date filter.** Recency is enforced in `scoreItem`, not at query time.

## Channel status (verified 2026-08-11)

| channel | state | notes |
|---|---|---|
| exa | working | ~36/run |
| rss | working | 4 QA + 3 AI feeds; `martinfowler.com/feed.atom` refuses connections and is out |
| reddit | working | needs Chrome; `--window background` stops it stealing focus |
| github | working | star floor 120, else `--sort updated` returns only fresh personal repos |
| twitter | works, **disabled** | ~1 keeper per 24, ~60s/run — see README |
