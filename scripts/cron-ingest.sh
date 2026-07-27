#!/bin/bash
# Wrapper for cron: OCR any screenshots sitting in inbox/ and push new books.
# cron runs with a minimal environment, so set an explicit PATH and cd first.
set -uo pipefail

# Adjust if node/swift live elsewhere (`which node`, `which swift`).
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

cd "$(dirname "$0")/.." || exit 1
mkdir -p inbox
LOG="inbox/ingest.log"

{
  echo "===== $(date '+%Y-%m-%d %H:%M:%S') ====="
  node scripts/ingest.mjs --push
  echo
} >> "$LOG" 2>&1
