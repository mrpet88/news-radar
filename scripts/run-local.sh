#!/bin/zsh
# Local collection run — invoked by launchd four times a day.
#
# Fires often, works at most once. The three guards below mean the job takes the
# first slot where the Mac is actually awake with Chrome open, and does nothing
# the other three times. launchd already runs a missed StartCalendarInterval at
# next wake, so there is no polling loop here and none is needed.

set -uo pipefail

ROOT="${0:A:h:h}"
cd "$ROOT" || exit 1

# launchd hands over a minimal PATH; every tool this needs lives in Homebrew.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# Twitter/X cookies, if present. Kept in a gitignored .env rather than the plist
# so the tokens never reach the repo — see the twitter section in CLAUDE.md.
if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi

log() { print -r -- "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

# ── Guard 1: Chrome must be running ───────────────────────────────────────────
# OpenCLI drives the user's existing Chrome session. Without Chrome the reddit
# channel cannot work, and starting it here would be an unwanted surprise at 06:45.
if ! pgrep -f "Google Chrome.app" >/dev/null 2>&1; then
  log "skip: Chrome is not running — reddit would be unavailable"
  exit 0
fi

# ── Guard 2: idempotency ──────────────────────────────────────────────────────
# A successful collection in the last 20h means today is already covered.
if node -e '
  const fs = require("fs");
  try {
    const p = JSON.parse(fs.readFileSync("data/reach-raw.json", "utf8"));
    const h = (Date.now() - Date.parse(p.collectedAt)) / 3.6e6;
    process.exit(h < 20 ? 0 : 1);
  } catch { process.exit(1); }
' 2>/dev/null; then
  log "skip: collected less than 20h ago"
  exit 0
fi

# ── Collect ───────────────────────────────────────────────────────────────────
log "building"
npm run build --silent >/dev/null 2>&1 || { log "build failed"; exit 1; }

log "collecting via agent-reach"
if ! node scripts/reach-collect.mjs; then
  # Exit 2 is the collector's "every channel came back empty" signal. It leaves the
  # previous payload in place on purpose, so there is nothing to commit.
  log "collection produced nothing — leaving previous payload in place"
  exit 0
fi

# Render locally too, so data/index.html is correct even if Actions never runs.
node dist/index.js || log "render failed (payload is still on disk)"

# ── Publish ───────────────────────────────────────────────────────────────────
# Opt-in: running this script by hand does not touch git. The LaunchAgent sets
# NEWS_RADAR_PUSH=1 so the scheduled run is the only thing that publishes.
if [[ "${NEWS_RADAR_PUSH:-0}" != "1" ]]; then
  log "done (NEWS_RADAR_PUSH unset — not committing)"
  exit 0
fi

# Only reach-raw.json. This machine's unique product is the collection; the render
# outputs (items.json, index.html) and the state files (seen-history, digest-state)
# belong to the Actions run. Committing them from both sides made every push a
# conflict in generated files, with no meaningful side to prefer.
git add data/reach-raw.json 2>/dev/null
if git diff --cached --quiet 2>/dev/null; then
  log "done (no new collection to commit)"
  exit 0
fi

git -c user.email="40420772+mrpet88@users.noreply.github.com" -c user.name="news-radar" \
  commit -m "news-radar: collect $(date -u +%FT%TZ)" >/dev/null 2>&1 || { log "commit failed"; exit 1; }

# Actions pushes render state between our runs, so the remote is routinely ahead.
# Rebase first (autostash covers the locally-rendered files we deliberately do not
# commit) rather than letting the push fail every time.
git pull --rebase --autostash -q origin main >/dev/null 2>&1 || log "warning: rebase failed; pushing may be rejected"

if git push -q >/dev/null 2>&1; then
  log "done (pushed)"
else
  log "done (commit made, push failed — will go with the next run)"
fi
