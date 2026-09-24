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

# ── Guard 1: idempotency ──────────────────────────────────────────────────────
# A successful collection in the last 20h means today is already covered — but if
# that collection never made it to GitHub, retry the publish rather than waiting a
# day. The publish is idempotent, so this costs one fetch when all is well.
FRESH=0
if node -e '
  const fs = require("fs");
  try {
    const p = JSON.parse(fs.readFileSync("data/reach-raw.json", "utf8"));
    const h = (Date.now() - Date.parse(p.collectedAt)) / 3.6e6;
    process.exit(h < 20 ? 0 : 1);
  } catch { process.exit(1); }
' 2>/dev/null; then
  FRESH=1
  log "collected less than 20h ago — checking it is published"
fi

# ── Collect ───────────────────────────────────────────────────────────────────
if (( ! FRESH )); then
  # Chrome must be running: OpenCLI drives the user's existing Chrome session, and
  # starting it here would be an unwanted surprise at 06:45. Publishing a collection
  # that already exists does not need it, which is why this sits inside the block.
  if ! pgrep -f "Google Chrome.app" >/dev/null 2>&1; then
    log "skip: Chrome is not running — reddit would be unavailable"
    exit 0
  fi

  log "building"
  npm run build --silent >/dev/null 2>&1 || { log "build failed"; exit 1; }

  log "collecting via agent-reach"
  if ! node scripts/reach-collect.mjs; then
    # Exit 2 is the collector's "every channel came back empty" signal. It leaves the
    # previous payload in place on purpose, so there is nothing to commit.
    log "collection produced nothing — leaving previous payload in place"
    exit 0
  fi
fi

# No local render. Rendering writes items.json, index.html and the two state files,
# which Actions owns; leaving them modified here is what wedged this checkout in a
# half-finished autostash merge from 2026-08-18 on, after which every commit failed
# and no collection reached GitHub for five weeks. Actions renders within minutes of
# the push below (the workflow triggers on reach-raw.json), so nothing is lost.

# ── Publish ───────────────────────────────────────────────────────────────────
# Opt-in: running this script by hand does not touch git. The LaunchAgent sets
# NEWS_RADAR_PUSH=1 so the scheduled run is the only thing that publishes.
if [[ "${NEWS_RADAR_PUSH:-0}" != "1" ]]; then
  log "done (NEWS_RADAR_PUSH unset — not publishing)"
  exit 0
fi

# Publish with plumbing, not commit/pull/push. The commit is built directly on top
# of origin/main with only reach-raw.json replaced, in a throwaway index, and pushed
# by hash. The working tree, the local branch and the real index are never touched,
# so there is no merge, no rebase and no state that can be left half-done — whatever
# this checkout looks like (dirty, behind, even mid-conflict), the publish works.
# Identity comes from the repo-local git config, which install-agent.sh checks for.
publish() {
  local base blob tree commit idx
  git fetch -q origin main || { log "fetch failed"; return 1; }
  base=$(git rev-parse FETCH_HEAD) || return 1
  blob=$(git hash-object -w data/reach-raw.json) || return 1
  idx="$(mktemp -d)/index"
  GIT_INDEX_FILE="$idx" git read-tree "$base" || return 1
  GIT_INDEX_FILE="$idx" git update-index --add --cacheinfo "100644,$blob,data/reach-raw.json" || return 1
  tree=$(GIT_INDEX_FILE="$idx" git write-tree) || return 1
  rm -rf "${idx:h}"
  if [[ "$tree" == "$(git rev-parse "$base^{tree}")" ]]; then
    log "done (remote already has this collection)"
    return 0
  fi
  commit=$(git commit-tree "$tree" -p "$base" -m "news-radar: collect $(date -u +%FT%TZ)") || return 1
  git push -q origin "${commit}:refs/heads/main" || return 1
  log "done (pushed $commit)"
}

# A rejected push only means Actions landed a render commit in between; rebuilding
# on the new tip is always clean because the two sides never write the same file.
for attempt in 1 2 3; do
  publish && exit 0
  log "publish attempt $attempt failed"
  sleep 20
done
log "PUBLISH FAILED — collection is on disk but not on GitHub"
exit 1
