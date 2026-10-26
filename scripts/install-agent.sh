#!/bin/zsh
# Install (or reinstall) the LaunchAgents for this checkout: the collector and the
# morning trigger.
#
# The plist is generated rather than committed: it needs absolute paths, and a
# committed absolute path would publish the local account name. Everything
# machine-specific is resolved here at install time.

set -euo pipefail

ROOT="${0:A:h:h}"
# label → template
AGENTS=(
  local.news-radar         news-radar.plist.template
  local.news-radar.morning news-radar-morning.plist.template
)

# TCC blocks LaunchAgents from reading these, and the failure is an opaque
# "can't open input file" — worth catching here rather than in a 06:45 log.
case "$ROOT" in
  "$HOME/Documents"/*|"$HOME/Desktop"/*|"$HOME/Downloads"/*)
    print -r -- "refusing to install: $ROOT is under a TCC-protected folder."
    print -r -- "macOS blocks LaunchAgents from reading it. Move the project elsewhere (e.g. ~/personal-projects)."
    exit 1;;
esac

# Automated commits must not inherit a global identity that may be a work address.
if ! git -C "$ROOT" config --local user.email >/dev/null 2>&1; then
  print -r -- "warning: no repo-local git identity set. The scheduled run commits with your"
  print -r -- "global identity, which may not be the one you want on this project. Set it with:"
  print -r -- "  git -C \"$ROOT\" config --local user.email you@example.com"
fi

mkdir -p "$HOME/Library/LaunchAgents"
for LABEL TEMPLATE in "${AGENTS[@]}"; do
  TEMPLATE="$ROOT/scripts/$TEMPLATE"
  TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
  [[ -f "$TEMPLATE" ]] || { print -r -- "missing $TEMPLATE"; exit 1; }
  sed "s|__PROJECT_DIR__|$ROOT|g" "$TEMPLATE" > "$TARGET"
  plutil -lint "$TARGET" >/dev/null
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$TARGET"
  print -r -- "installed $LABEL → $TARGET"
done

print -r -- "collector fires 06:45 / 12:45 / 18:45 / 22:45; works at most once per 20h"
print -r -- "morning trigger ticks every 5 min; starts the delivery run once a day, when you're at the Mac"
print -r -- "run the collector now: launchctl kickstart -k gui/\$(id -u)/local.news-radar"
