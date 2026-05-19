#!/usr/bin/env bash
# Runs the cross-browser harness inside the official Playwright Docker image
# (which has WebKit/iOS Safari libs preinstalled). Use this when your host
# OS is missing libicu74 / libflite1 (Arch and other modern distros).
#
# Usage:
#   ./run-docker.sh                    # all profiles, default URL
#   ./run-docker.sh --only "iPhone"    # one profile substring
#   ./run-docker.sh --url https://...  # different URL
#
# Output lands in ./output/ on the host, identical to running natively.

set -euo pipefail
cd "$(dirname "$0")"

# Match the Playwright npm version pinned in package.json.
PW_VERSION="$(node -p "require('./package.json').dependencies.playwright" | tr -d '^~')"
IMAGE="mcr.microsoft.com/playwright:v${PW_VERSION}-noble"

docker run --rm \
  --network host \
  -v "$PWD":/work \
  -w /work \
  --ipc=host \
  "$IMAGE" \
  bash -lc "npm install --silent && node run.js $*"
