#!/bin/zsh
# Install (or reinstall) the LaunchAgent for this checkout.
#
# The plist is generated rather than committed: it needs absolute paths, and a
# committed absolute path would publish the local account name. Everything
# machine-specific is resolved here at install time.

set -euo pipefail

ROOT="${0:A:h:h}"
LABEL="local.news-radar"
TEMPLATE="$ROOT/scripts/news-radar.plist.template"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"

[[ -f "$TEMPLATE" ]] || { print -r -- "missing $TEMPLATE"; exit 1; }

# TCC blocks LaunchAgents from reading these, and the failure is an opaque
# "can't open input file" — worth catching here rather than in a 06:45 log.
case "$ROOT" in
  "$HOME/Documents"/*|"$HOME/Desktop"/*|"$HOME/Downloads"/*)
    print -r -- "refusing to install: $ROOT is under a TCC-protected folder."
    print -r -- "macOS blocks LaunchAgents from reading it. Move the project elsewhere (~/Projects works)."
    exit 1;;
esac

# Automated commits must not inherit a global identity that may be a work address.
if ! git -C "$ROOT" config --local user.email >/dev/null 2>&1; then
  print -r -- "warning: no repo-local git identity set. The scheduled run commits with your"
  print -r -- "global identity, which may not be the one you want on this project. Set it with:"
  print -r -- "  git -C \"$ROOT\" config --local user.email you@example.com"
fi

mkdir -p "$HOME/Library/LaunchAgents"
sed "s|__PROJECT_DIR__|$ROOT|g" "$TEMPLATE" > "$TARGET"
plutil -lint "$TARGET" >/dev/null

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$TARGET"

print -r -- "installed $LABEL → $TARGET"
print -r -- "fires 06:45 / 12:45 / 18:45 / 22:45; works at most once per 20h"
print -r -- "run now: launchctl kickstart -k gui/\$(id -u)/$LABEL"
