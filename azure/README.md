# Serverless email → site ingest (Azure)

Email a book-club screenshot from your phone and the site updates itself —
no Mac, no cron. A Logic App watches an **Outlook** inbox and POSTs each attachment
to an Azure Function that OCRs it, parses the scores, enriches metadata, and commits
to GitHub — which triggers the existing Pages build.

The same mailbox also sets the **next-meeting card**: a mail with no attachment whose
first line reads `Tytuł, Autor` points the card at that book.

```
Outlook → Logic App (new-mail trigger)
  ├─ has attachments? → ingest:    Azure Vision OCR → parse → enrich (Google Books/OL)
  │                                → books.json + cover
  └─ always          → next-book:  parse "Tytuł, Autor" → confirm → check 5 services
                                   → next-meeting.json + cover   (ignores mail with attachments)
  → one GitHub commit each → Pages rebuilds → one confirmation mail for both
  ↑ sender allowlist enforced by the functions, not the Logic App
```

The only difference from the local CLI is the OCR engine: macOS Vision (`ocr.swift`)
→ **Azure AI Vision Read**. Parsing (`scripts/lib/parse.mjs`,
`scripts/lib/next-meeting.mjs`), availability (`scripts/lib/availability.mjs`) and
enrichment (`scripts/metadata.mjs`) are shared verbatim (copied in by `npm run sync`).

## Cost
Effectively **$0**: Functions Consumption free grant, Azure AI Vision **F0** (~5k
scans/mo), Logic App Consumption + Outlook connector within free limits.

---

## Current deployment

This is already provisioned. **This repo is public, so the real resource names are
not committed** — they live in `azure/deployment.local.sh`, which is git-ignored.
Copy `deployment.local.sh.example` to create it; `provision.sh` and
`authorize-outlook.sh` both source it automatically.

```bash
source azure/deployment.local.sh   # then $RG, $FN, $VISION, $LA … are set
az resource list -g "$RG" --query "[].{name:name,type:type}" -o table
```

The stack is a resource group holding an Azure AI Vision (F0) resource, a storage
account, a Function App (Linux Consumption, Node 20, Functions v4), a Logic App
(Consumption) and its mail API connection.

Three constraints worth knowing before you change anything:

- **Region policy.** The subscription restricts which regions may be deployed to;
  anything else fails with `RequestDisallowedByAzure`. West Europe — what earlier
  versions of this file recommended — is *not* permitted. Check yours:
  ```bash
  az policy assignment list --query "[].parameters.listOfAllowedLocations.value"
  ```
  Whatever you pick must also serve Vision **Image Analysis 4.0 `read`**, which is
  not in every region.
- **One free F0 Computer Vision per subscription**, and it is already used. Never
  delete and re-create it casually — you may not get the free tier back.
- **The mail trigger is the Outlook.com *consumer* connector**
  (`managedApis/outlook`, trigger V2, PascalCase attachment fields
  `ContentBytes`/`Name`) — not Office 365. Re-creating a `Microsoft.Web/connections`
  resource drops its OAuth consent, so never PUT over the existing connection.

## Provisioning / re-converging

```bash
cd azure
ALLOWED_SENDERS=you@example.com ./provision.sh
```

Idempotent and adopt-first: it reuses every existing resource, keeps the current
`INGEST_SECRET`, redeploys the function code, relaxes the mail-trigger filters
(via `scripts/patch-logicapp.mjs`), and finishes with a health check. It reads the
GitHub token from `gh auth token` unless you export `GITHUB_TOKEN` — a fine-grained
PAT with **Contents: Read and write** on the site repo is the tighter option.

App settings it manages: `VISION_ENDPOINT`, `VISION_KEY`, `GITHUB_TOKEN`,
`GITHUB_REPO`, `GITHUB_BRANCH`, `GOOGLE_BOOKS_COUNTRY`, `INGEST_SECRET`,
`ALLOWED_SENDERS`.

To deploy code only:
```bash
cd azure && source deployment.local.sh
npm install && npm run sync && func azure functionapp publish "$FN" --build remote
```

Invoke URL + key:
```bash
az functionapp keys list -n "$FN" -g "$RG" --query functionKeys.default -o tsv
# URL: $FN_HOST/api/ingest?code=<key>
```

## The Logic App

The deployed workflow polls the Inbox roughly every 3 minutes and, for each
attachment, calls the `ingest` function directly (a `Function`-type action, so no
URL or `?code=` to keep in sync). It then calls `next-book` once with the mail
**body**. `provision.sh` keeps two settings correct, and both matter more than they
look:

- **no `subjectFilter`** — a subject filter silently skips every mail that doesn't
  match, and shows up only as `Fired: False` in Trigger History.
- **`fetchOnlyWithAttachment: false`** — phone mail apps often embed a screenshot
  inline rather than as a real attachment.

If the OAuth consent ever expires, `./authorize-outlook.sh` walks the connection
through re-consent (that sign-in is the one step that genuinely cannot be scripted).

### The next-book branch

`Call_next_book` runs **after** `For_each_attachment`, not beside it — both append to
the one `summary` variable, and parallel branches would race it for exactly the reason
the foreach is sequential. `provision.sh` grafts it onto a workflow that predates it
(`scripts/patch-logicapp.mjs` derives the function id from the ingest call and rewires
`Send_summary`), so upgrading is one `./provision.sh`, not a rebuild.

The function ignores any mail with an attachment, so a caption under a screenshot can
never re-point the card, and it returns an **empty summary** for mail that isn't a book
line — which is most mail. That is why `Append_next_book` appends nothing at all rather
than a blank paragraph: otherwise every unrelated message would arrive with a stray gap
in the confirmation.

### Confirmation email

After the attachments are processed the workflow mails a summary back to the
sender, so a `review` book announces itself instead of vanishing:

```
✅ Dodano: Achaja
⚠️ Do przeglądu: „Kiedy żurawie…, Lisa Ridzen" — Nie wiadomo, co jest tytułem…
↩️ Już na stronie: Wiedźmin

Commit: b966510
(screenshot.jpg)
```

The text is built by the function (`buildSummary` in `src/functions/ingest.mjs`)
and returned as `summary` / `summaryHtml`, because Logic App expressions have no
sane way to format a list of notes. Three things about the workflow side:

- It **sends** (`POST /v2/Mail`) rather than replying. Every reply path —
  `/Mail/{id}/Reply`, `/v2/…`, `/v3/…` — returns `NotFound` on the Outlook.com
  connector; only send exists. So the confirmation is a new mail, subject
  `Re: <original>`.
- `Send_summary` runs after `Failed` as well as `Succeeded` — a failed ingest is
  exactly when you want to be told.
- `For_each_attachment` is **sequential** (`concurrency.repetitions: 1`), because
  parallel branches appending to one variable would race and lose lines.

Reference definitions live here:

| File | What it is |
|---|---|
| `logicapp.template.json` | the deployed shape as an ARM template — Outlook.com connector, trigger V2, `ContentBytes`/`Name`, both jobs |
| `logicapp.outlook.workflow.json` | Office 365 variant, trigger V3, `contentBytes`/`name` — for a work/school mailbox |
| `logicapp.workflow.json` | the original Gmail variant, kept for reference only |

Deploying the template needs `nextBookFunctionId` alongside `functionId` (both are
`<function-app-resource-id>/functions/<name>`). Converging the *existing* workflow
needs neither — `./provision.sh` derives the second from the first.

## Sending mail / testing end-to-end

Email a screenshot from the allowlisted address → the Logic App **run history** goes
green → a commit appears in the repo → the Pages workflow runs → the book shows on
the site. The rules for a mail that actually gets processed:

- **No special subject.** Any subject works, including an empty one — there is
  deliberately no `subjectFilter` on the trigger.
- **Attach the image as a file.** Inline/pasted images still fire the trigger
  (`fetchOnlyWithAttachment: false`), but the attachment loop is empty so nothing
  is OCR'd.
- **The sender must match `ALLOWED_SENDERS`.** With no subject filter, this is the
  only gate on the inbox; everything else gets `403` and is ignored.
- **Focused Inbox off** for that mailbox, or mail sorted to "Other" is never seen.
- The trigger polls **every ~3 minutes** and only sees mail that arrives after it
  was created.

Re-sending the same screenshot is a no-op — existing books come back under `skipped`.

For the next-meeting card, send **no attachment** and put the book on the first line
(`Problem trzech ciał, Cixin Liu`, optionally `…, 25/08/26 18:00`). Quoted replies and
signatures are stripped, so only what you typed at the top counts.

## Local development
```bash
cd azure
cp local.settings.json.example local.settings.json   # fill in the values
npm install && npm start                              # runs `sync` then `func start`

# simulate the Logic App call with a real screenshot:
FUNC_URL=http://localhost:7071/api/ingest SECRET=<INGEST_SECRET> FROM=you@example.com DRY=1 \
  ./scripts/test-ingest.sh ../data/received_995736336268004.jpeg
```
(Needs a real `VISION_*` and `GITHUB_*` in `local.settings.json`; the commit lands on
`GITHUB_BRANCH`, so point it at a test branch while trying things out.)

## Security notes
- The endpoint is protected three ways: the function key (`?code=`), the
  `x-ingest-secret` header, and the `ALLOWED_SENDERS` allowlist. Verified: a wrong
  secret gets `401`, a non-allowlisted sender gets `403`.
- Keep `GITHUB_TOKEN` / `VISION_KEY` only in Function app settings (or Key Vault),
  never in the repo. `local.settings.json` is git-ignored.
- Same safety as the CLI: strict metadata matching, no-author books skipped,
  low-confidence parses returned as `review` (not committed).

### `review`, and how an ambiguous header resolves

Each book comes back as `added` (committed), `skipped` (already in `books.json`)
or `review` (parsed, but something looked wrong — deliberately not committed).
You don't have to go looking for `review` any more — the workflow emails the
outcome back to whoever sent the screenshot (see *Confirmation email* below).
It is still only a field in the response, so the run history remains the
fallback if the mail itself fails.

A header like `Kiedy żurawie odlatują na południe, Lisa Ridzen` used to go
straight to `review`, because nothing marks which side is the author. Now
`splitTitleAuthor` emits ranked candidates — every comma position, both
orderings, and finally the whole header as a title — and `resolveHeader` asks
Google Books / Open Library which reading actually exists. First confirmed
candidate wins, and its metadata is reused so the book isn't fetched twice.
A title that merely *contains* a comma (`Dziki, mroczny brzeg`) resolves to
itself via that last candidate. Headers where an initial already decides the
split (`Wiedźmin, A. Sapkowski`) never hit the network at all.

> **Set `GOOGLE_BOOKS_API_KEY`.** Without one, Google Books is rate-limited per
> IP and returns HTTP 429 once the daily quota is gone — resolution then falls
> back to Open Library alone, which misses many Polish editions, and books that
> would resolve fine land in `review` instead.

## Notes
- `src/shared/` is generated by `npm run sync` and git-ignored — edit the originals
  in `../scripts/`.
- The local Mac CLI (`../scripts/ingest.mjs`) still works as an offline fallback.

## Troubleshooting

Work from the function outward — prove the function is healthy first, then the email trigger.

### 1. Is the function configured? (`/api/health`)
```bash
source deployment.local.sh
curl "$FN_HOST/api/health?code=<function-key>"
```
Expect `visionConfigured`, `githubConfigured`, `ingestSecretSet` = `true`, `allowlistCount` ≥ 1,
and `github: "ok"` with a `books` count (plus `nextBook`, the title on the card — `null`
until the first next-book mail lands). Anything `false`/`error` is a missing/wrong app
setting or a bad `GITHUB_TOKEN`/`GITHUB_REPO` — fix that before anything else.

### 2. Does the function work end-to-end? (bypass email)
```bash
FUNC_URL="$FN_HOST/api/ingest?code=<key>" \
SECRET="<INGEST_SECRET>" FROM="$ALLOWED_SENDERS" DRY=1 \
./scripts/test-ingest.sh ../data/received_995736336268004.jpeg

# and the next-meeting card:
FUNC_URL="$FN_HOST/api/next-book?code=<key>" \
SECRET="<INGEST_SECRET>" FROM="$ALLOWED_SENDERS" DRY=1 \
./scripts/test-next-book.sh "Problem trzech ciał, Cixin Liu"
```
`DRY=1` returns the OCR text + parsed books and **commits nothing**. If you get back
sensible `parsed` entries, then **OCR + parse + GitHub-read all work, and the problem is the
mail trigger** — go to §4. Drop `DRY=1` (point `GITHUB_BRANCH` at a throwaway branch first)
to test a real commit.

### 3. Reading the function's answer
| Response | Meaning |
|---|---|
| `401 unauthorized` | `x-ingest-secret` header ≠ `INGEST_SECRET` |
| `403 sender not allowed` | the `from` isn't in `ALLOWED_SENDERS` (check the `from` echoed back) |
| `400 missing contentBase64` | the attachment field didn't map (see §4.3) |
| `502 ocr_failed` | `VISION_ENDPOINT`/`VISION_KEY` wrong, or region without Image Analysis 4.0 |
| `502 github_*` | token scope/repo/branch problem |
| `200 { added:[], skipped:[...] }` | working — those books already exist (re-sending the same shot is a no-op) |
| `200 { added:[], review:[...] }` | parsed but low-confidence (bad average / unknown member); not published on purpose |
| `200 { ignored:true }` (next-book) | the mail had an attachment, or its first line isn't a book line — normal for most mail |
| `200 { refused:true }` (next-book) | a one-sided line no book database knows; send it as `Tytuł, Autor` |
| `200 { unchanged:true }` (next-book) | that book is already on the card (the trigger can deliver a mail twice) |

Live logs: Function App → **Log stream** (or Application Insights). Every call logs
`ocrChars`, `blocks`, and `added/review/skipped`.

### 4. "No Logic App run at all" — the mail trigger isn't firing
Check in this order:
1. **Trigger History ≠ Runs.** A trigger that polls but matches nothing shows only under the
   Logic App's **Trigger History** as `Fired: False`, never in Runs. Look there first — this
   is the single most common symptom.
2. **Subject filter.** A leftover `subjectFilter` skips every mail that doesn't contain it.
   `provision.sh` strips it; check Code view if you edited the trigger by hand.
3. **Inline vs real attachment.** Phone mail apps often embed the screenshot **inline**, not
   as an attachment. Keep `fetchOnlyWithAttachment: false` so the mail still triggers.
4. **Focused Inbox.** If the mail lands in **Other**, the Inbox trigger misses it. Turn off
   Focused Inbox for that mailbox, or add a rule moving the sender to Focused/Inbox.
5. **Folder** — the trigger's *Folder* must be the one the mail actually reaches (`Inbox`),
   not Junk or a rule folder.
6. **Connection & Enabled** — the mail connection (`$CONN`) is authorised to the **same
   mailbox** you're emailing and not expired; the Logic App resource is **Enabled**.
7. **Polling** — the trigger polls (~3 min) and only sees mail arriving *after* it was
   created. Use **Run Trigger** to force a poll, or wait a cycle.

Inspect the live trigger without opening the portal:
```bash
source deployment.local.sh
SUB=$(az account show --query id -o tsv)
az rest --method get --uri "https://management.azure.com/subscriptions/$SUB/resourceGroups/$RG/providers/Microsoft.Logic/workflows/$LA/triggers/When_a_new_email_arrives_%28V2%29/histories?api-version=2016-06-01&\$top=5" \
  --query "value[].{start:properties.startTime,status:properties.status,fired:properties.fired}" -o table
```

### Debugging parsing without a Vision key
POST `{ "text": "<paste OCR/plain text>", "dryRun": true, "from": "you@example.com" }` to
`/api/ingest` to run the parser on text you supply — handy for reproducing a bad parse locally.
