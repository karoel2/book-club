# Serverless email → site ingest (Azure)

Email a book-club screenshot from your phone (Gmail) and the site updates itself —
no Mac, no cron. A Logic App watches a Gmail inbox and POSTs each attachment to an
Azure Function that OCRs it, parses the scores, enriches metadata, and commits to
GitHub — which triggers the existing Pages build.

```
Gmail (screenshot) → Logic App (new-mail trigger, sender allowlist)
  → HTTP POST → Function: Azure Vision OCR → parse → enrich (Google Books/OL)
  → single GitHub commit (books.json + cover) → Pages rebuilds
```

The only difference from the local CLI is the OCR engine: macOS Vision (`ocr.swift`)
→ **Azure AI Vision Read**. Parsing (`scripts/lib/parse.mjs`) and enrichment
(`scripts/metadata.mjs`) are shared verbatim (copied in by `npm run sync`).

## Cost
Effectively **$0**: Functions Consumption free grant, Azure AI Vision **F0** (~5k
scans/mo), Logic App Consumption + Gmail connector within free limits.

---

## 1. GitHub token
Create a **fine-grained PAT** with **Contents: Read and write** on the site repo only.
Save it for `GITHUB_TOKEN`.

## 2. Provision Azure (CLI)
```bash
RG=bookclub-rg; LOC=westeurope; PREFIX=bookclub$RANDOM

az group create -n $RG -l $LOC

# Azure AI Vision (free F0)
az cognitiveservices account create -n ${PREFIX}-vision -g $RG \
  --kind ComputerVision --sku F0 -l $LOC --yes
VISION_ENDPOINT=$(az cognitiveservices account show -n ${PREFIX}-vision -g $RG --query properties.endpoint -o tsv)
VISION_KEY=$(az cognitiveservices account keys list -n ${PREFIX}-vision -g $RG --query key1 -o tsv)

# Storage (required by Functions) + Function App (Consumption, Node 20, Linux)
az storage account create -n ${PREFIX}st -g $RG -l $LOC --sku Standard_LRS
az functionapp create -n ${PREFIX}-fn -g $RG \
  --storage-account ${PREFIX}st --consumption-plan-location $LOC \
  --runtime node --runtime-version 20 --functions-version 4 --os-type Linux

# Secrets / config
az functionapp config appsettings set -n ${PREFIX}-fn -g $RG --settings \
  VISION_ENDPOINT="$VISION_ENDPOINT" VISION_KEY="$VISION_KEY" \
  GITHUB_TOKEN="<pat>" GITHUB_REPO="<owner>/<repo>" GITHUB_BRANCH="main" \
  GOOGLE_BOOKS_COUNTRY="PL" \
  INGEST_SECRET="$(openssl rand -hex 24)" \
  ALLOWED_SENDERS="you@gmail.com"
```

## 3. Deploy the function
```bash
cd azure
npm install
npm run sync                       # copies parse.mjs + metadata.mjs into src/shared/
func azure functionapp publish ${PREFIX}-fn --build remote
```
Grab the invoke URL + key:
```bash
az functionapp function keys list -n ${PREFIX}-fn -g $RG --function-name ingest
# URL: https://${PREFIX}-fn.azurewebsites.net/api/ingest?code=<default key>
```

## 4. Logic App + Gmail (Designer — Gmail needs interactive OAuth)
1. **Create** → *Logic App (Consumption)* in `$RG`, open the **Designer**.
2. Trigger: **Gmail → "When a new email arrives"**. Sign in / authorise your Google
   account. Set *Label* = `INBOX`, *Include Attachments* = **Yes** (optionally a
   subject filter like `ksiazka`).
3. Add **Control → Condition**: `From` **contains** `you@gmail.com`
   (your allowlisted sender). In the *If true* branch:
4. **Control → For each** over the trigger's **Attachments**, then inside it
   **HTTP** action:
   - Method `POST`, URI = the function URL **including `?code=`**.
   - Header `x-ingest-secret` = your `INGEST_SECRET`.
   - Body:
     ```json
     { "contentBase64": "<Attachments Content-Bytes>", "filename": "<Attachments Name>", "from": "<From>" }
     ```
     (pick `Content-Bytes`, `Name`, `From` from dynamic content).
5. *(Optional)* add **Gmail → "Reply to email"** using the HTTP response
   (`@body('HTTP')?['added']`) so you get a confirmation on your phone.
6. **Save**. `logicapp.workflow.json` here mirrors these steps for the Code view.

## 5. Test end-to-end
Email a screenshot from the allowlisted address → watch the Logic App **run
history** go green → a new commit appears in the repo → the Pages workflow runs →
the book shows on the site. Sending from another address is ignored.

## Local development
```bash
cd azure
cp local.settings.json.example local.settings.json   # fill in the values
npm install && npm start                              # runs `sync` then `func start`

# simulate the Logic App call with a real screenshot:
B64=$(base64 -i ../data/received_995736336268004.jpeg)
curl -s -X POST "http://localhost:7071/api/ingest" \
  -H "content-type: application/json" -H "x-ingest-secret: <INGEST_SECRET>" \
  -d "{\"contentBase64\":\"$B64\",\"filename\":\"t.jpeg\",\"from\":\"you@gmail.com\"}" | jq
```
(Needs a real `VISION_*` and `GITHUB_*` in `local.settings.json`; the commit lands on
`GITHUB_BRANCH`, so point it at a test branch while trying things out.)

## Security notes
- The endpoint is protected three ways: the function key (`?code=`), the
  `x-ingest-secret` header, and the `ALLOWED_SENDERS` allowlist.
- Keep `GITHUB_TOKEN` / `VISION_KEY` only in Function app settings (or Key Vault),
  never in the repo. `local.settings.json` is git-ignored.
- Same safety as the CLI: strict metadata matching, no-author books skipped,
  low-confidence parses returned as `review` (not committed).

## Notes
- `src/shared/` is generated by `npm run sync` and git-ignored — edit the originals
  in `../scripts/`.
- The local Mac CLI (`../scripts/ingest.mjs`) still works as an offline fallback.
