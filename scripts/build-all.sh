#!/usr/bin/env bash
# Build every game and assemble the full site into _site/, mirroring what CI deploys.
# Preview with: npx serve _site
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf _site
mkdir -p _site
cp -r site/. _site/

for dir in games/*/; do
  game=$(basename "$dir")
  echo "==> $game"
  (cd "$dir" && npm ci --no-audit --no-fund && npm run build)
  cp -r "$dir/dist" "_site/$game"
done

echo "Site assembled in _site/"
