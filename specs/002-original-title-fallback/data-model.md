# Data Model: Cross-Language Metadata Fallback via Original Title

## Persisted Book Record

| Field | Type | Rules |
|---|---|---|
| `title` | string | Required stored/display title and primary lookup key |
| `author` | string or null | Existing author used by strict metadata matching |
| `originalTitle` | string, optional | Human supplied lookup key; trim/ignore empty values; never inferred or displayed |
| `scores` | object | Existing member score map |
| `categories` | string[] optional | Existing cleaned category values; fallback may fill only when permitted |
| `description` | string or null optional | Existing primary-language/content result; never sourced from fallback |

## Metadata Result

| Field | Type | Rules |
|---|---|---|
| `description` | string or null | Used only for the primary lookup |
| `categories` | string[] | Cleaned with the existing four-item cap |
| `isbn` | string or null | Existing identifier used to add exact cover candidate |
| `coverUrls` | string[] | Candidate URLs passed to existing best-cover selection |
| `sources` | string[] | Existing source labels |

## Enrichment Report

| Field | Type | Rules |
|---|---|---|
| fallback attempted | boolean | True only for a non-empty distinct original title and an eligible gap |
| original title | string | The exact human-supplied lookup title when attempted |
| outcome | success / empty / failure / skipped | Polish output maps these states to operator messages |
| supplied | categories, cover, both, none | Describes fallback contributions; never includes description |

## Invariants and State Transitions

- Empty or absent `originalTitle` preserves the existing enrichment path.
- `originalTitle` equal to `title` skips the second lookup.
- A fallback lookup occurs at most once per book per run.
- Fallback categories use the existing cleaning and cap rules.
- Fallback cover URLs are merged before `pickBestCover`; an existing non-forced cover prevents downloading.
- Fallback description is ignored in every outcome, including force mode.
- A failed or empty fallback does not mutate the entry or cover files.
- Successful primary changes may remain when fallback is attempted; fallback failure must not roll them back.
