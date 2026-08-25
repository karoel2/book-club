#!/bin/bash
# Send a mail body straight to the next-book function, bypassing email / the
# Logic App entirely. Proves the function (parse → confirm → availability →
# GitHub) works.
#
#   FUNC_URL="https://<app>.azurewebsites.net/api/next-book?code=<key>" \
#   SECRET="<INGEST_SECRET>" [FROM=you@outlook.com] [DRY=1] \
#   ./scripts/test-next-book.sh "Problem trzech ciał, Cixin Liu"
#
# DRY=1  → dry run: returns the card it would write, commits nothing.
# (against a local `func start`, use FUNC_URL=http://localhost:7071/api/next-book)
set -euo pipefail

LINE="${1:?usage: test-next-book.sh \"Tytuł, Autor[, 25/08/26 18:00]\"}"
: "${FUNC_URL:?set FUNC_URL to the function URL (include ?code=<key> for the deployed app)}"
: "${SECRET:?set SECRET to your INGEST_SECRET}"
FROM="${FROM:-you@outlook.com}"
DRY="${DRY:-0}"

BODY=$(LINE="$LINE" FROM="$FROM" DRY="$DRY" node -e 'process.stdout.write(JSON.stringify({body:process.env.LINE,subject:"test",from:process.env.FROM,hasAttachments:false,dryRun:process.env.DRY==="1"}))')

curl -sS -X POST "$FUNC_URL" \
  -H 'content-type: application/json' \
  -H "x-ingest-secret: $SECRET" \
  --data-binary "$BODY" \
| node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.stringify(JSON.parse(s),null,2))}catch{console.log(s)}})'
