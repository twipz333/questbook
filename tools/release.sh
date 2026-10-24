#!/usr/bin/env bash
# Release = version bump on master. CI (.github/workflows/release.yml) builds on Windows
# and publishes GitHub Release vX.Y.Z; installed apps auto-update from it.
# Steps: bump "version" in package.json, add release-notes/vX.Y.Z.md, run this script.
set -euo pipefail
cd "$(dirname "$0")/.."
VER=$(node -p "require('./package.json').version")
npm test
git add -A
git commit -m "Release v$VER"
git push origin HEAD:master
echo "Pushed v$VER — GitHub Actions will build and publish it."
