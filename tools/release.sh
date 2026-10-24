#!/usr/bin/env bash
# Release = tag push. CI (.github/workflows/release.yml) builds on Windows and publishes.
# Usage: tools/release.sh   (bump package.json version and add release-notes/vX.Y.Z.md first)
set -euo pipefail
cd "$(dirname "$0")/.."
VER=$(node -p "require('./package.json').version")
npm test
git tag "v$VER"
git push origin "v$VER"
echo "Tag v$VER pushed — see GitHub Actions for the build."
