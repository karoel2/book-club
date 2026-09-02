# Quickstart: Cross-Language Metadata Fallback via Original Title

## Prerequisites

- Node.js dependencies installed with `npm install`.
- Repository data available in `src/data/books.json`.
- A test fixture or mocked metadata responses for primary and original-title lookups.

## Build Validation

```bash
npm run build
```

Expected outcome: the Astro site builds successfully; original title remains lookup-only and is not rendered.

## CLI Validation

1. Add `"originalTitle": "Reincarnation"` to the worked example and run `npm run ingest -- --backfill "Pierwszych"` with mocked/API metadata.
2. Confirm at least three cleaned categories are stored and the existing description is unchanged.
3. Confirm the fallback report names `Reincarnation` and marks categories as borrowed.
4. Run the same command again and confirm no fallback lookup occurs after the metadata gap is closed.
5. Test a book with an existing category list and cover file; confirm neither is changed without `--force`.
6. Test a fallback miss and a simulated network/rate-limit failure; confirm the record is unchanged and messages distinguish empty from failure.
7. Test `--force`; confirm categories/covers may refresh but fallback description never replaces the stored description.
8. Serialize records with and without `originalTitle`; confirm the field is omitted when absent.

## Shared Serverless Validation

```bash
cd azure
npm run sync
```

Run the existing Azure ingest smoke test and verify the same fallback outcomes and field restrictions as the CLI path.

## Regression Checks

- Run `npm run build` with unchanged records and compare generated archive behavior.
- Confirm books without `originalTitle` produce no additional metadata request.
- Confirm a primary lookup failure can still be enriched from the original title, with no description copied from fallback.
- Confirm fallback cover URLs remain candidates to `pickBestCover`, including the existing ISBN candidate.
