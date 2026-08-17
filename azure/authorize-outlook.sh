#!/usr/bin/env bash
# The one step that cannot be scripted: the Office 365 Outlook connector's OAuth
# consent. Microsoft requires a human to sign in to the mailbox in a browser.
#
# This gets it down to: open a link, sign in, paste the URL you land on back here.
#
#   ./authorize-outlook.sh
set -euo pipefail

# Real names live in deployment.local.sh (git-ignored — this repo is public).
# shellcheck source=/dev/null
if [ -f "$(dirname "$0")/deployment.local.sh" ]; then . "$(dirname "$0")/deployment.local.sh"; fi
: "${RG:?set RG (see deployment.local.sh.example)}"
: "${CONN:?set CONN to the mail API connection name}"
SUB=$(az account show --query id -o tsv)
CONN_ID="/subscriptions/$SUB/resourceGroups/$RG/providers/Microsoft.Web/connections/$CONN"
API="https://management.azure.com$CONN_ID"
# The portal's own connector callback page — the only redirect the consent flow accepts.
REDIRECT="https://ema.hosting.portal.azure.net/ema/Content/1.0.0.0/Views/HostedEditor/callback.html"

status() { az resource show --ids "$CONN_ID" --query "properties.statuses[0].status" -o tsv 2>/dev/null || echo Unknown; }

if [ "$(status)" = Connected ]; then
  echo "✅ $CONN is already Connected — nothing to do."
  exit 0
fi

LINK=$(az rest --method post --uri "$API/listConsentLinks?api-version=2016-06-01" \
  --body "{\"parameters\":[{\"parameterName\":\"token\",\"redirectUrl\":\"$REDIRECT\"}]}" \
  --query "value[0].link" -o tsv)

cat <<EOF

1. Open this link and sign in with the mailbox the Logic App should watch:

$LINK

2. You'll land on a mostly blank callback page. Copy that page's full URL
   from the address bar and paste it below (it contains ?code=…).

EOF
command -v open >/dev/null && open "$LINK" 2>/dev/null || true

read -r -p "Callback URL (or just the code): " RAW
CODE=$(printf %s "$RAW" | sed -n 's/.*[?&]code=\([^&]*\).*/\1/p')
[ -n "$CODE" ] || CODE="$RAW"
[ -n "$CODE" ] || { echo "no code given" >&2; exit 1; }

az rest --method post --uri "$API/confirmConsentCode?api-version=2016-06-01" \
  --body "{\"code\":\"$CODE\"}" -o none

FINAL=$(status)
echo
if [ "$FINAL" = Connected ]; then
  echo "✅ $CONN is Connected. The Logic App will start polling within ~3 minutes."
else
  echo "⚠️  Status is '$FINAL'. Fall back to the portal: open the '$CONN' resource"
  echo "   in $RG → 'Edit API connection' → Authorize → Save."
fi
