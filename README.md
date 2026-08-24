# Klub Książki — Book Club Archive

A clean, no-accounts static site that ranks the books our club has read and shows
every member's individual score. Built with [Astro](https://astro.build). UI in Polish.

See [vision.md](vision.md) for the product vision.

## Run it

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # static output in dist/
npm run preview    # serve the built dist/ locally
```

## Add or edit a book

Everything lives in **[`src/data/books.json`](src/data/books.json)** — one object per book:

```jsonc
{
  "title": "Chirurg",
  "author": "Tess Gerritsen",     // use null when unknown -> shows "Autor nieznany"
  "scores": { "Asia": 5, "Michał": 9, "Zosia": 7 }
  // a score of null = took part but left no number -> shown as "—", excluded from the average
}
```

The average, ranking, ratings count and page URL are all derived automatically.
Just edit the file and rebuild — no other code changes needed.

## Add a cover

Drop an image into **`src/assets/covers/`** named after the book's slug, e.g.
`chirurg.jpg`, `hail-mary.jpg`, `dziki-mroczny-brzeg.png` (`.jpg/.jpeg/.png/.webp/.avif`).
It is optimized and shown on the next build; until then a neat placeholder is used.
The slug is the lowercase title with Polish letters simplified and spaces turned into `-`.

## Add a book automatically (from a screenshot)

`scripts/ingest.mjs` turns a screenshot into a `books.json` entry: OCR (on-device
Apple Vision, via `ocr.swift`) → parse → validate → enrich (description, categories,
cover) → append.

```bash
# 1. Drop screenshot(s) into inbox/
# 2. Preview what would be added (writes nothing):
npm run ingest -- --dry-run inbox/*.jpg
# 3. Add for real (updates books.json, no git):
npm run ingest
# 4. Add + commit + push (triggers the GitHub Pages rebuild):
npm run ingest -- --push
```

What it handles for you:

- Splits multi-book screenshots and skips stray page markers (e.g. `6/8`).
- Fixes the OCR `ł`→`t` name glitch by matching against the existing roster
  (Michat→Michał, Pawet→Paweł); names it can't match are flagged, not guessed.
- Cross-checks the parsed scores against the average printed on the screenshot.
  On a mismatch the image goes to `inbox/review/` with a note and is **not**
  published — so a misread score never reaches the site silently.
- Best-effort title/author split; when unsure it keeps the whole line as the
  title and leaves the author blank for you to fix later.
- Fetches a **description, categories and a cover image** for each new book and
  drops the cover into `src/assets/covers/` (add `--no-enrich` to skip).
- Skips books whose slug already exists, so re-running is safe.

Processed images move to `inbox/processed/`, flagged ones to `inbox/review/`.
Add `--strict` to send anything with any warning to review.

## Book descriptions, categories & covers

Enrichment uses **Google Books** (best Polish descriptions + categories) with
**Open Library** as a fallback and for higher-resolution covers (by ISBN). It's
best-effort — if nothing is found the book is still added, just without extras.
No API key is needed; set `GOOGLE_BOOKS_API_KEY` if you ever hit the daily limit.

Backfill the books you already have (fills only what's missing — description,
categories, or cover — so it's safe to re-run):

```bash
npm run ingest -- --backfill --dry-run  # preview what it would fetch
npm run ingest -- --backfill            # write metadata + download covers
npm run ingest -- --backfill --push     # + commit & push
```

Covers land in `src/assets/covers/<slug>.jpg` and are used automatically. To
override any cover, just drop your own image there with the same slug.

### Fixing data by hand

Reliable matching needs an author, so books with `"author": null` — and any
whose title the lookup can't find — are left blank **on purpose** (no guessing,
so a wrong book's blurb is never attached). To fix one:

1. Correct its `title` / `author` in `src/data/books.json`.
2. Re-enrich just that book, overwriting whatever was there:

   ```bash
   npm run ingest -- --backfill --force "fragment tytułu"
   ```

`--force` re-fetches text and re-downloads the cover even if data is already
present; the title fragment limits the run to matching books. Omit both the
fragment and `--force` to sweep every book that's still missing something.

## Run it on a schedule (cron)

`scripts/cron-ingest.sh` runs the ingest with `--push` and logs to `inbox/ingest.log`.

```bash
crontab -e
# e.g. every 15 minutes (quotes matter — the path has a space):
*/15 * * * * /bin/bash "/Users/karol.idaszak/Work/book club/scripts/cron-ingest.sh"
```

macOS gotchas:

- Grant **Full Disk Access** to `/usr/sbin/cron` (System Settings → Privacy &
  Security → Full Disk Access), otherwise the job can't read your files.
- The push must be non-interactive: use an **SSH remote**
  (`git remote set-url origin git@github.com:<you>/<repo>.git`) with your key
  loaded, or a stored credential/token — otherwise `git push` hangs forever.
- If `node`/`swift` aren't found, fix the `PATH` line at the top of the wrapper
  (`which node`, `which swift`).

## Add a book by email (serverless, no computer)

Instead of keeping a Mac running cron, you can **email a screenshot from your phone**
and have the site update itself. An **Azure Function** plus a **Logic App** watching an
**Outlook** inbox do exactly what the CLI does — OCR → parse → enrich → commit to GitHub
(which triggers the Pages build). The parsing and enrichment are the *same shared code*
(`scripts/lib/parse.mjs`, `scripts/metadata.mjs`); only the OCR engine differs
(macOS Vision → **Azure AI Vision**, which reads Polish fine). Cost is ≈ $0 on the free tiers.

**This is already deployed** — resource names, region and constraints are in
**[azure/README.md](azure/README.md)**. To re-converge it after a change:

```bash
cd azure && ALLOWED_SENDERS=you@example.com ./provision.sh
```

### Day-to-day use

Send the screenshot to the watched mailbox from the allow-listed address. Within a
couple of minutes the book appears on the site.

- **No special subject** — any subject works, including an empty one. (An earlier
  version required `book-club` in the subject, which silently swallowed everything else.)
- **Attach the image as a file.** A pasted/inline image still triggers the workflow,
  but there's no attachment to OCR, so nothing happens.
- **Sender must match `ALLOWED_SENDERS`**, or the function replies `403` and ignores it.
  With no subject filter, this allow-list is the only gate on the inbox.
- **Watch out for Focused Inbox** — mail sorted into "Other" is never seen by the trigger.

Same safety net as the CLI: a misread score or an unrecognised name comes back as
*needs review* and is **not** published. Re-sending the same screenshot is a no-op —
books that already exist are skipped.

The endpoint is protected three ways (function key, a shared-secret header, and the
sender allow-list). The local cron/CLI route above still works as an offline fallback.

## Set the next book by email

The card at the top of the page — the book the club is reading now, when it meets,
and where to get it — is set the same way. **Email one line, no attachment:**

```
Problem trzech ciał, Cixin Liu
Problem trzech ciał, Cixin Liu, 25/08/26 18:00
```

There's no keyword: a mail *with* an attachment is a ratings screenshot, a mail
*without* one is the next book, so a single message never does both. Then:

- The **title/author split** is the same logic the screenshot parser uses, so a
  comma inside the title survives (`Dziki, mroczny brzeg, C. McConaghy`) and either
  order works (`S. King, Worek Kości`).
- The book is **confirmed against Google Books / Open Library**. A line that names
  only one thing and matches nothing is refused with a reply, so `dobra robota`
  can't become the next book.
- **Leave the date out** and the first meeting is `25/08/26`; later meetings
  advance by a fortnight from the previous scheduled Tuesday. Leave the time out
  and the previous one carries over (or `18:00` for the first meeting).
- All five services are **checked live** and the ✓/✗ marks are committed with the
  book, along with a cover if the databases have one.
- You get a **reply** with what was set:

  ```
  📖 Następna książka: Problem trzech ciał — Cixin Liu
  📅 Spotkanie: 25/08/26, 18:00
  🎧 Storytel ✅ · BookBeat ❌ · Audioteka ✅ · Legimi ✅ · B. Raczyńskich ✅
  ```

Re-sending the same book changes nothing. It all lands in
**[`src/data/next-meeting.json`](src/data/next-meeting.json)**, which you can also
edit by hand. To do it from a computer instead:

```bash
npm run next -- "Problem trzech ciał, Cixin Liu"   # set it (add --push to publish)
npm run next -- --recheck --push                   # same book, fresh availability
npm run next -- --dry-run "…"                      # preview, write nothing
```

### Where the ✓, ✗ and ? come from

`scripts/lib/availability.mjs` asks all five services directly, in parallel:

| Service | How it's asked |
|---|---|
| Storytel | public search API; requires an `abook` format, not just an ebook |
| BookBeat | `api.bookbeat.com`, Polish market; requires an `audiobookisbn` |
| Audioteka | no API, but its search page is server-rendered — results parsed from the HTML |
| Legimi | the JSON catalogue API its React app hydrates from (see below) |
| B. Raczyńskich | Ex Libris Primo — and a copy must be **on the shelf**, not merely catalogued |

A hit counts only if title *and* author match. Two rules earn their keep there:
containment is measured in **whole words** (as a substring, `Achaja` sits inside
*Wojna Rzymu z Achajami* — a different book entirely), and the author is scored by
how much of *our* name the catalogue accounts for, so `S. Fitzek` still matches
`Fitzek, Sebastian (1971- ) Autor` without the extra words dragging it under.

The search term is always the **title alone** — these engines AND their terms, so
adding the author returns nothing at all. If the full title finds nothing, the
subtitle is tried on its own (Legimi files *Wiedźmin. Ostatnie życzenie* as plain
*Ostatnie życzenie*), then the first three words.

**Legimi needed a workaround.** It renders results in the browser and its HTML ships
an empty book list, so there's nothing to scrape. But every page embeds the state its
app boots from, including the anonymous API key the app then uses — so we read that
key out of the page and call the same catalogue endpoint. Nothing is hardcoded here:
if Legimi rotates the key, the next run picks up the new one, and if the page ever
stops carrying one the check reports `?` rather than guessing.

`?` means *nobody could ask* — a timeout, a layout change, a missing key. It is never
a stand-in for "no", because a red cross the site never verified is worse than an
honest blank. It links to that service's search so you can look yourself.

**What ✓ claims**: the service has the audiobook in its catalogue — not that it is
free on whichever plan you happen to pay for. The distinction is real on Legimi,
whose catalogue search cannot filter by subscription at all (only by format; the
`format=unlimited_audio` in the old hardcoded links did nothing). *Problem trzech
ciał*, for instance, is flagged `isInSubscription: false` there while its page
advertises the audiobook under the "ebooki+audiobooki bez limitu" plan. Reading that
per-book flag would cost one extra request per service and still can't be said in one
checkmark, so the card sticks to catalogue presence — the same standard Audioteka,
also a shop, is held to.

> The Python package in `audiobook_scraper/` was the first attempt at this. Three of
> its five endpoints (BookBeat's and Audioteka's `/api/search`, Legimi's result page)
> no longer exist and answer `404`, which is why those marks were hard-coded `✗`.
> Nothing on the site uses it now; the Node module above is the live one.

## Hosting on GitHub Pages (free)

Deployment is already wired up in `.github/workflows/deploy.yml`: every push to
`main` builds the site and publishes it. The base path is derived from the repo
name automatically, so there's nothing to edit.

One-time setup (create an empty repo on GitHub first, then):

```bash
git init -b main
git add .
git commit -m "Book club archive"
git remote add origin git@github.com:<you>/<repo>.git
git push -u origin main
```

Then on GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
The site goes live at `https://<you>.github.io/<repo>/`.

(Name the repo `<you>.github.io`, or attach a custom domain, and it serves from
the root instead — the config handles both cases.)

## Data provenance

Scores were transcribed from the original screenshots in `data/` via on-device OCR
(`ocr.swift` → `ocr_results.txt`). Member names `Michał`/`Paweł` were corrected from an
OCR artifact; unknown authors and one blank score were left as-is.
