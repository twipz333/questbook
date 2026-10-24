#!/usr/bin/env bash
# Build the Windows installer and publish it as a GitHub Release.
# The installed app (electron-updater) picks up the release by latest.yml.
# Usage: tools/release.sh [notes-file]
set -euo pipefail
cd "$(dirname "$0")/.."
VER=$(node -p "require('./package.json').version")
export WINEDEBUG=-all
npm test
rm -rf dist
npx electron-builder --win nsis --x64 --publish never
NOTES=${1:-}
gh release create "v$VER" \
  "dist/Questbook-Setup-$VER.exe" \
  "dist/Questbook-Setup-$VER.exe.blockmap" \
  dist/latest.yml \
  --repo twipz333/questbook --title "Questbook $VER" \
  ${NOTES:+--notes-file "$NOTES"} ${NOTES:---generate-notes}
