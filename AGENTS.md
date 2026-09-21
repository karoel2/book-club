# Repository Guidelines

These instructions apply to the whole repository. The project is a Polish-language,
static Astro site for a private book club, with optional local and Azure-based tools
for importing book-club screenshots and updating the next-meeting card.

## Project Layout

- `src/pages/` contains the homepage, book detail routes, member routes, and 404 page.
- `src/components/`, `src/layouts/`, and `src/styles/` contain the Astro UI and styles.
- `src/data/books.json` is the source of truth for archived books and member scores.
- `src/data/next-meeting.json` is the source of truth for the next-book card.
- `src/assets/covers/` contains optional covers matched by title slug.
- `src/data/*.ts` derives slugs, averages, rankings, member statistics, and provider data
  from the JSON files. Do not manually duplicate derived values in the JSON.
- `scripts/` contains the local ingest CLI, metadata enrichment, availability checks,
  parsers, and Node tests.
- `azure/` contains the optional serverless email-ingest deployment. Its shared parser,
  metadata, and availability code is generated from the root `scripts/` directory.
- `ocr.swift` is the macOS Apple Vision OCR entry point used by local screenshot ingest.

## Commands

Run these from the repository root:

```bash
npm install
npm run dev       # Astro development server at http://localhost:4321
npm run build     # production static build in dist/
npm run preview   # serve the production build locally
npm test          # Node tests under scripts/**/*.test.mjs
```

Useful data workflows:

```bash
npm run ingest -- --dry-run inbox/*.jpg
npm run ingest
npm run ingest -- --backfill --dry-run
npm run next -- --dry-run "Tytuł książki, Autor"
npm run next -- "Tytuł książki, Autor"
```

The ingest CLI uses macOS Swift/Apple Vision and network metadata providers. Do not
assume it can run in a minimal Linux environment. Use `--dry-run` before changing
data, and use `--push` only when an explicit commit and deployment are intended.

For metadata, the supported source of truth is the backfill workflow, not manually
copied descriptions, categories, or covers:

```bash
set -a
source .env
set +a
npm run ingest -- --backfill --dry-run
npm run ingest -- --backfill
```

The CLI does not automatically load `.env`. Export `GOOGLE_BOOKS_API_KEY` in the
same shell before running backfill when it is available; otherwise the providers run
anonymously and may hit their quota. Keep `.env` local and never commit its contents.
Use `--force "fragment tytułu"` only when a specific book needs metadata replaced.

## Editing Book Data

- Add or correct books in `src/data/books.json`; it is a JSON array with one object per
  book.
- Scores are normally integers from `1` to `10`. Use `null` when a member participated
  but did not provide a numeric score. Null scores are excluded from averages.
- Keep author names and member names consistent with existing data. The ingest parser
  canonicalizes known OCR variants, but unknown names must be reviewed rather than
  guessed.
- A book's slug is derived from its title by lowercasing, simplifying Polish letters,
  and replacing separators with `-`. Add a cover in `src/assets/covers/` using that
  slug and a supported extension: `.jpg`, `.jpeg`, `.png`, `.webp`, or `.avif`.
- Do not hand-edit averages, rating counts, member rankings, or generated page URLs.
- Do not manually invent or paste enrichment metadata into `books.json`; use
  `npm run ingest -- --backfill --dry-run` to inspect provider results, then run the
  supported backfill command to write descriptions, categories, and covers.
- Update `src/data/next-meeting.json` through `npm run next` when possible. Its provider
  IDs must remain synchronized with `src/data/next-meeting.ts` and
  `scripts/lib/availability.mjs`.

## Code Conventions

- Follow the existing Astro and TypeScript style; keep changes small and local.
- Preserve the Polish user-facing copy and accessibility attributes unless the task
  specifically changes product language.
- Use `url()` from `src/lib/url.ts` for internal links so the site works at the custom
  domain root and at a possible GitHub Pages sub-path.
- Keep the Astro site static. Do not introduce a client-side framework or runtime
  backend for features that can be derived at build time.
- Avoid adding dependencies when existing Astro, Node, and standard-library code is
  sufficient.

## Ingest and Azure Rules

- Treat uncertain OCR parses, score mismatches, and unknown members as review cases;
  never silently publish guessed data.
- `inbox/` is local working data and is git-ignored. Screenshots should not be added
  to commits unless explicitly requested.
- Edit shared logic in root `scripts/`, not in `azure/src/shared/`. Run
  `cd azure && npm run sync` when updating the generated Azure copy.
- Never commit credentials or deployment details. Keep `azure/local.settings.json`,
  `azure/deployment.local.sh`, API keys, function secrets, and tokens out of Git.
- Azure provisioning is adopt-first. Do not delete and recreate the existing Outlook
  connection or Azure Vision F0 resource casually; doing so can lose OAuth consent or
  the subscription's free-tier resource.

## Deployment

- A push to `main` triggers `.github/workflows/deploy.yml`, which builds and deploys
  the static site to GitHub Pages.
- The live site is `https://book-club.space/`. Keep `CNAME` and
  `astro.config.mjs` aligned with that custom-domain setup; do not add a project
  `base` path unless hosting moves back to a repository sub-path.
- The local ingest and next-book `--push` options commit data and covers, then rely on
  the same GitHub Pages workflow.

## Validation Checklist

Before handing off a change:

1. Run `npm test` for parser, metadata, and availability behavior.
2. Run `npm run build` to catch Astro, TypeScript, route, and asset errors.
3. Run `git diff --check` to catch whitespace errors.
4. If data or covers changed, inspect the generated routes and relevant JSON diff.
5. Do not include ignored secrets, local inbox files, `dist/`, or generated Azure
   shared files in the change.
