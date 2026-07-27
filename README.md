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
Apple Vision, via `ocr.swift`) → parse → validate → append.

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
- Skips books whose slug already exists, so re-running is safe.

Processed images move to `inbox/processed/`, flagged ones to `inbox/review/`.
Add `--strict` to send anything with any warning to review.

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
