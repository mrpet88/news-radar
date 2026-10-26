#!/bin/zsh
# Morning delivery trigger — invoked by launchd every 5 minutes.
#
# Starts the day's delivery run once you are actually at the Mac, not merely once
# it is awake. The Mac often never sleeps overnight (a held sleep assertion is
# enough), so "first slot that finds it awake" meant 06:46 every day, before you
# had opened it. Presence is read from the keyboard/mouse idle time instead.
#
# When you arrive it first runs the regular collector — Chrome is usually open by
# then, so reddit makes it into the email — and then starts the workflow, which
# starts in seconds where GitHub's cron starts hours late. The workflow sends at
# most one automatic digest a day, so the cron that follows only refreshes the
# dashboard; on days you never open the Mac, the cron sends instead.

set -uo pipefail

ROOT="${0:A:h:h}"
cd "$ROOT" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# Opt-in, like run-local.sh: only the LaunchAgent dispatches.
[[ "${NEWS_RADAR_PUSH:-0}" == "1" ]] || exit 0

# Not before this hour: a late night at the Mac must not send tomorrow's email.
EARLIEST_HOUR=6
# Input within this many seconds counts as "you are here".
PRESENT_WITHIN=300

DISPATCH_MARK=data/.dispatched-on
today=$(date +%F)
[[ "$(cat "$DISPATCH_MARK" 2>/dev/null)" == "$today" ]] && exit 0
(( $(date +%-H) >= EARLIEST_HOUR )) || exit 0

idle=$(ioreg -c IOHIDSystem | awk '/HIDIdleTime/ { print int($NF / 1e9); exit }')
[[ -n "$idle" ]] && (( idle <= PRESENT_WITHIN )) || exit 0

log() { print -r -- "$(date '+%Y-%m-%d %H:%M:%S') $*"; }
log "you're at the Mac — collecting, then starting today's delivery run"

# Collect and publish first, so this morning's Mac channels are in the email. Its
# own guards apply (skips when collected <20h ago or Chrome is closed); whatever it
# does, the cloud channels still deliver, so the dispatch goes ahead regardless.
zsh scripts/run-local.sh

for attempt in 1 2 3; do
  if gh workflow run news-radar --ref main -f trigger=mac >/dev/null 2>&1; then
    print -r -- "$today" > "$DISPATCH_MARK"
    log "triggered today's delivery run"
    exit 0
  fi
  sleep 20
done
# No mark, so the next 5-minute tick retries.
log "could not trigger the delivery run — retrying at the next tick"
