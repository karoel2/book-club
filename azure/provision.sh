#!/usr/bin/env bash
# Converge the Azure side of the email → OCR → GitHub ingest onto its desired
# state: resources, app settings, function code, mail-trigger filters, health.
#
#   ALLOWED_SENDERS=you@example.com ./provision.sh
#
# Idempotent and adopt-first: existing resources are reused, never re-created.
# That matters — re-creating the Outlook API connection would drop its OAuth
# consent, and the subscription only allows one free F0 Computer Vision.
#
# Overridable via env: RG LOC VISION STORAGE FN LA GITHUB_REPO GITHUB_BRANCH
#                      GITHUB_TOKEN ALLOWED_SENDERS
set -euo pipefail
cd "$(dirname "$0")"

# Real resource names live in deployment.local.sh, which is git-ignored because
# this repo is public. Copy deployment.local.sh.example to create it.
# shellcheck source=/dev/null
if [ -f deployment.local.sh ]; then . ./deployment.local.sh; fi

: "${RG:?set RG (see deployment.local.sh.example)}"
# Subscriptions can carry an Allowed-regions policy — check yours before changing
# LOC, and confirm the region serves Vision "Image Analysis 4.0 read":
#   az policy assignment list --query "[].parameters.listOfAllowedLocations.value"
: "${LOC:?set LOC}"
: "${VISION:?set VISION}"
: "${STORAGE:?set STORAGE}"
: "${FN:?set FN}"
LA="${LA:-}"
REPO="${GITHUB_REPO:?set GITHUB_REPO as <owner>/<repo>}"
BRANCH="${GITHUB_BRANCH:-main}"
: "${ALLOWED_SENDERS:?set ALLOWED_SENDERS to the address you will mail screenshots from}"

# gh's token already carries repo scope; a fine-grained PAT in GITHUB_TOKEN wins.
GITHUB_TOKEN="${GITHUB_TOKEN:-$(gh auth token)}"
[ -n "$GITHUB_TOKEN" ] || { echo "no GitHub token (run: gh auth login)" >&2; exit 1; }

SUB=$(az account show --query id -o tsv)
say() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

say "Subscription $(az account show --query name -o tsv)"
echo "  rg=$RG loc=$LOC fn=$FN vision=$VISION"

say "Resource group"
az group show -n "$RG" -o none 2>/dev/null || az group create -n "$RG" -l "$LOC" -o none

say "Azure AI Vision (F0)"
if az cognitiveservices account show -n "$VISION" -g "$RG" -o none 2>/dev/null; then
  echo "  adopting existing $VISION"
else
  az cognitiveservices account create -n "$VISION" -g "$RG" -l "$LOC" \
    --kind ComputerVision --sku F0 --custom-domain "$VISION" --yes -o none || {
      echo "F0 refused. Only one free Computer Vision per subscription — find it with:" >&2
      echo "  az cognitiveservices account list --query \"[?kind=='ComputerVision']\" -o table" >&2
      exit 1; }
fi
VISION_ENDPOINT=$(az cognitiveservices account show -n "$VISION" -g "$RG" --query properties.endpoint -o tsv)
VISION_KEY=$(az cognitiveservices account keys list -n "$VISION" -g "$RG" --query key1 -o tsv)

say "Storage account"
az storage account show -n "$STORAGE" -g "$RG" -o none 2>/dev/null || \
  az storage account create -n "$STORAGE" -g "$RG" -l "$LOC" \
    --sku Standard_LRS --kind StorageV2 \
    --allow-blob-public-access false --min-tls-version TLS1_2 -o none

say "Function App"
az functionapp show -n "$FN" -g "$RG" -o none 2>/dev/null || \
  az functionapp create -n "$FN" -g "$RG" \
    --storage-account "$STORAGE" --consumption-plan-location "$LOC" \
    --runtime node --runtime-version 20 --functions-version 4 --os-type Linux -o none
az functionapp update -n "$FN" -g "$RG" --set httpsOnly=true -o none

say "App settings"
# Reuse an existing secret, or the deployed Logic App's header stops matching.
INGEST_SECRET=$(az functionapp config appsettings list -n "$FN" -g "$RG" \
  --query "[?name=='INGEST_SECRET'].value | [0]" -o tsv 2>/dev/null || true)
[ -n "$INGEST_SECRET" ] || INGEST_SECRET=$(openssl rand -hex 24)

az functionapp config appsettings set -n "$FN" -g "$RG" --settings \
  VISION_ENDPOINT="$VISION_ENDPOINT" \
  VISION_KEY="$VISION_KEY" \
  GITHUB_TOKEN="$GITHUB_TOKEN" \
  GITHUB_REPO="$REPO" \
  GITHUB_BRANCH="$BRANCH" \
  GOOGLE_BOOKS_COUNTRY=PL \
  INGEST_SECRET="$INGEST_SECRET" \
  ALLOWED_SENDERS="$ALLOWED_SENDERS" -o none

say "Deploying the function code"
npm install --silent
npm run sync
func azure functionapp publish "$FN" --build remote

say "Relaxing the mail trigger (drops subjectFilter, allows inline images)"
LA_API="https://management.azure.com/subscriptions/$SUB/resourceGroups/$RG/providers/Microsoft.Logic/workflows/$LA"
if [ -z "$LA" ]; then
  echo "  LA not set — skipping"
elif az rest --method get --uri "$LA_API?api-version=2019-05-01" > /tmp/la-live.json 2>/dev/null; then
  node scripts/patch-logicapp.mjs < /tmp/la-live.json > /tmp/la-body.json
  az rest --method put --uri "$LA_API?api-version=2019-05-01" --body @/tmp/la-body.json -o none
  echo "  patched $LA"
else
  echo "  no Logic App named $LA — skipping (create it in the portal, then re-run)"
fi

say "Health check"
HOST_KEY=$(az functionapp keys list -n "$FN" -g "$RG" --query functionKeys.default -o tsv)
for i in $(seq 1 12); do
  HEALTH=$(curl -fsS "https://$FN.azurewebsites.net/api/health?code=$HOST_KEY" 2>/dev/null) && break
  echo "  warming up ($i/12)…"; sleep 10
done
echo "${HEALTH:-<no response>}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.stringify(JSON.parse(s),null,2))}catch{console.log(s)}})'

say "Done"
cat <<EOF
  Function App  $FN   https://$FN.azurewebsites.net
  Vision        $VISION_ENDPOINT
  Logic App     $LA
  Allowlist     $ALLOWED_SENDERS

  Host key:  az functionapp keys list -n $FN -g $RG --query functionKeys.default -o tsv
  Dry run:   FUNC_URL="https://$FN.azurewebsites.net/api/ingest?code=<key>" \\
             SECRET="<INGEST_SECRET>" FROM="$ALLOWED_SENDERS" DRY=1 \\
             ./scripts/test-ingest.sh ../data/<screenshot>.jpeg
EOF
