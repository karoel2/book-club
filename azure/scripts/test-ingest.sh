#!/bin/bash
# Send a local screenshot straight to the ingest function, bypassing email /
# the Logic App entirely. Proves the function (OCR → parse → GitHub) works.
#
#   FUNC_URL="https://<app>.azurewebsites.net/api/ingest?code=<key>" \
#   SECRET="<INGEST_SECRET>" [FROM=you@outlook.com] [DRY=1] \
#   ./scripts/test-ingest.sh ../data/received_995736336268004.jpeg
#
# DRY=1  → dry run: returns OCR text + parsed books, commits nothing.
# (against a local `func start`, use FUNC_URL=http://localhost:7071/api/ingest)
set -euo pipefail

IMG="${1:?usage: test-ingest.sh <image-path>}"
: "${FUNC_URL:?set FUNC_URL to the function URL (include ?code=<key> for the deployed app)}"
: "${SECRET:?set SECRET to your INGEST_SECRET}"
FROM="${FROM:-you@outlook.com}"
DRY="${DRY:-0}"

B64=$(base64 < "$IMG" | tr -d '\n')
BODY=$(B64="$B64" FROM="$FROM" DRY="$DRY" node -e 'process.stdout.write(JSON.stringify({contentBase64:process.env.B64,filename:"test.jpg",from:process.env.FROM,dryRun:process.env.DRY==="1"}))')

curl -sS -X POST "$FUNC_URL" \
  -H 'content-type: application/json' \
  -H "x-ingest-secret: $SECRET" \
  --data-binary "$BODY" \
| node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.stringify(JSON.parse(s),null,2))}catch{console.log(s)}})'
