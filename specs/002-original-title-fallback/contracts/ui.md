# Operator Contract: Metadata Enrichment Reporting

The CLI and serverless ingest report one result per enriched book. Messages introduced for
the fallback are Polish and identify the original title when a lookup is attempted.

## Outcomes

- **Skipped**: no original title, same title, or no eligible metadata gap; no fallback request.
- **Used**: report `oryginalny tytuł: ...` and mark supplied values as borrowed categories and/or cover candidates.
- **Empty**: report that the original title was searched but no metadata was found; preserve the entry.
- **Failure**: report that fallback enrichment failed and include the error classification; do not label it as not found.

## Data Contract

- Fallback output can alter only `categories` and cover selection.
- `description` is sourced only from the primary result or existing entry.
- Existing non-empty categories and cover files are retained unless force mode explicitly permits refresh.
- Serialization omits `originalTitle` when absent and retains all existing compact JSON conventions.

## Compatibility

Books without `originalTitle` follow the current lookup, mutation, serialization, and reporting behavior.
