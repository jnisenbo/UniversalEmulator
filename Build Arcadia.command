#!/bin/zsh
# Double click to build Arcadia.app and install it in Applications.
# Run it again any time the code changes.
set -e
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:$PATH"
export pnpm_config_minimum_release_age=0

echo "Installing packages..."
pnpm install

echo "Building Arcadia (this takes a minute or two)..."
pnpm dist

APP="dist/mac-arm64/Arcadia.app"
DEST="/Applications/Arcadia.app"
if [ ! -w /Applications ]; then
  mkdir -p "$HOME/Applications"
  DEST="$HOME/Applications/Arcadia.app"
fi

osascript -e 'tell application "Arcadia" to quit' >/dev/null 2>&1 || true
rm -rf "$DEST"
ditto "$APP" "$DEST"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

echo ""
echo "Done. Arcadia is installed at $DEST"
open "$DEST"
