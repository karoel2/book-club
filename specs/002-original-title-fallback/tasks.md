---

description: "Executable task list for original-title metadata fallback"
---

# Tasks: Cross-Language Metadata Fallback via Original Title

**Input**: Design documents from `/specs/002-original-title-fallback/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ui.md, quickstart.md

**Tests**: Focused fixture and smoke-test tasks are included because the specification defines independently testable acceptance scenarios and measurable regression guarantees.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the existing CLI, Azure synchronization, archive, and cover paths used by the feature.

- [X] T001 [P] Inventory metadata, serialization, ingest, Azure shared-copy, archive, and cover paths in `scripts/metadata.mjs`, `scripts/lib/parse.mjs`, `scripts/ingest.mjs`, `azure/src/shared/metadata.mjs`, and `src/data/books.json`
- [X] T002 [P] Add a representative fallback fixture and mocked-response conventions for primary and original-title lookups in `scripts/fixtures/original-title-fallback.mjs`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish the optional data shape and shared metadata result behavior before story-specific enrichment changes.

- [X] T003 Extend the compact archive serializer to emit non-empty `originalTitle` only when present, preserving existing output for records without it in `scripts/lib/parse.mjs`
- [X] T004 Add the optional `originalTitle` field to the parsed book shape and verify absent values remain omitted in `src/data/books.json` and `scripts/lib/parse.mjs`
- [X] T005 [P] Define shared fallback lookup/merge result fields and failure classifications in `scripts/metadata.mjs`
- [X] T006 Synchronize the shared metadata implementation to `azure/src/shared/metadata.mjs` using `azure/scripts/sync-shared.mjs`

**Checkpoint**: Optional original-title data serializes safely and both ingestion environments have the same shared metadata primitives.

---

## Phase 3: User Story 1 - Uzupełnienie kategorii książki w tłumaczeniu (Priority: P1) 🎯 MVP

**Goal**: Fill missing categories from an explicitly supplied original title without changing the stored description or spending unnecessary API calls.

**Independent Test**: Give a category-empty book an original title, run one backfill with mocked metadata, and verify categories are stored while its description remains byte-for-byte unchanged.

### Tests for User Story 1

- [X] T007 [P] [US1] Add metadata fixture tests for distinct original-title lookup, no-title behavior, same-title skip, and at-most-one fallback request in `scripts/metadata.test.mjs`
- [X] T008 [P] [US1] Add enrichment regression fixtures proving fallback categories use the existing cleaning and four-item cap in `scripts/fixtures/original-title-fallback.mjs`

### Implementation for User Story 1

- [X] T009 [US1] Implement conditional original-title lookup after primary metadata when categories are missing or the cover is unusable, skipping absent and title-equal values in `scripts/metadata.mjs`
- [X] T010 [US1] Merge fallback categories only when the primary category set is empty unless force mode permits refresh, and never merge fallback descriptions in `scripts/ingest.mjs`
- [X] T011 [US1] Preserve the existing primary lookup behavior and no-extra-call path for records without `originalTitle` in `scripts/ingest.mjs`
- [X] T012 [US1] Apply the shared fallback category behavior to serverless ingestion in `azure/src/functions/ingest.mjs` and synchronize `azure/src/shared/metadata.mjs`

**Checkpoint**: A category-empty translated book is enriched from its human-supplied original title, while descriptions and no-title behavior remain unchanged.

---

## Phase 4: User Story 2 - Zachowanie istniejących okładek i opisów (Priority: P1)

**Goal**: Add fallback cover candidates without overwriting curated categories, descriptions, or cover files unless force mode is explicit.

**Independent Test**: Run enrichment on a book with an original title, hand-written categories, an existing cover, and a description; verify all survive without `--force`, then verify force still cannot import a fallback description.

### Tests for User Story 2

- [X] T013 [P] [US2] Add cover candidate tests proving fallback URLs are appended before `pickBestCover` and the ISBN candidate remains present in `scripts/metadata.test.mjs`
- [X] T014 [P] [US2] Add mutation-gate fixtures for existing covers, existing categories, primary failure with fallback success, and fallback failure in `scripts/ingest.test.mjs`

### Implementation for User Story 2

- [X] T015 [US2] Add fallback cover URLs to the existing candidate list while retaining the existing `pickBestCover` and ISBN-by-cover route in `scripts/metadata.mjs`
- [X] T016 [US2] Gate fallback cover downloads on slug cover existence and force mode, preserving all existing cover extensions and rename behavior in `scripts/ingest.mjs`
- [X] T017 [US2] Isolate empty, network, rate-limit, and primary-failure outcomes so fallback failure does not mutate the book or cover in `scripts/ingest.mjs`
- [X] T018 [US2] Mirror cover and failure-isolation behavior in `azure/src/functions/ingest.mjs` and synchronize `azure/src/shared/metadata.mjs`

**Checkpoint**: Existing curated data is safe by default, fallback covers participate in best-image selection, and force mode never imports a fallback description.

---

## Phase 5: User Story 3 - Widoczność źródła danych (Priority: P2)

**Goal**: Make fallback usage, original title, supplied values, misses, and failures visible in Polish operator output.

**Independent Test**: Exercise fallback success, empty result, skipped lookup, and service failure and verify each per-book report identifies the correct state and supplied fields.

### Tests for User Story 3

- [X] T019 [P] [US3] Add report-output assertions for borrowed categories/covers, original title, empty fallback, failure, and skipped fallback in `scripts/ingest.test.mjs`

### Implementation for User Story 3

- [X] T020 [US3] Emit Polish per-book fallback outcome messages using the operator contract in `scripts/ingest.mjs`
- [X] T021 [US3] Return and render equivalent fallback outcome information from the serverless ingest path in `azure/src/functions/ingest.mjs`
- [X] T022 [US3] Document the operator output and compact serialization examples in `specs/002-original-title-fallback/contracts/ui.md`

**Checkpoint**: Operators can distinguish skipped, used, empty, and failed fallback attempts and see the exact original title and supplied values.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Validate the complete feature, both ingestion paths, and compatibility guarantees.

- [X] T023 [P] Update ingestion usage and archive-field documentation for `originalTitle` in `README.md`
- [X] T024 [P] Add the worked-example and byte-identical-no-title regression cases to `scripts/fixtures/original-title-fallback.mjs`
- [X] T025 Run `npm run build` and the focused metadata/ingest fixture tests; record results against `specs/002-original-title-fallback/quickstart.md`
- [X] T026 Run `cd azure && npm run sync` and the Azure ingest smoke test, then verify the synchronized shared modules match `scripts/metadata.mjs` behavior
- [X] T027 Run the full quickstart validation, including force mode, no-cover/candidate selection, primary failure recovery, and no-op rerun checks described in `specs/002-original-title-fallback/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No implementation dependency; establishes paths and fixtures.
- **Foundational (Phase 2)**: Depends on Setup and blocks all story work.
- **User Story 1 (Phase 3)**: Depends on Foundational; delivers the MVP category fallback.
- **User Story 2 (Phase 4)**: Depends on Foundational and shared metadata behavior from US1; protects and extends enrichment output.
- **User Story 3 (Phase 5)**: Depends on the outcome types from US1 and US2 so reports describe real states.
- **Polish (Phase 6)**: Depends on all desired story phases.

### User Story Dependencies

- **US1 (P1)**: Can start after Phase 2; no dependency on another story.
- **US2 (P1)**: Can start after Phase 2, but its merge and mutation tests should use the shared fallback contract established by US1.
- **US3 (P2)**: Follows US1 and US2 because it reports their final outcome states.

### Parallel Opportunities

- T001 and T002 can run in parallel.
- T005 and T003/T004 can run in parallel when they touch separate concerns.
- T007 and T008 can run in parallel.
- T013 and T014 can run in parallel.
- T019, T023, and T024 can run in parallel after their source behavior is stable.
- Azure synchronization tasks must follow the corresponding local shared-module changes.

## Parallel Example: User Story 1

```text
Task: "Add metadata fixture tests for distinct original-title lookup and one-call gating in scripts/metadata.test.mjs"
Task: "Add fallback category cleaning and cap fixtures in scripts/fixtures/original-title-fallback.mjs"
```

## Parallel Example: User Story 2

```text
Task: "Add cover candidate tests in scripts/metadata.test.mjs"
Task: "Add mutation-gate fixtures in scripts/ingest.test.mjs"
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Setup and Foundational phases.
2. Implement and validate conditional category fallback in US1.
3. Verify no fallback descriptions, no-title compatibility, and one-call gating.
4. Stop for independent MVP validation before adding cover protection and reporting refinements.

### Incremental Delivery

1. Deliver US1 category fallback.
2. Deliver US2 cover candidate merging and mutation protection.
3. Deliver US3 Polish operator reporting.
4. Run cross-cutting CLI/Azure synchronization and regression validation.

### Notes

- Every task uses the required checkbox, sequential ID, optional `[P]`, story label where applicable, and an exact file path.
- No public site UI changes are planned because `originalTitle` is lookup input only.

---

## Phase 7: Convergence

**Purpose**: Complete remaining implementation work identified through gap analysis

- [X] T028 [US1] Implement conditional original-title lookup trigger in `scripts/ingest.mjs` enrichment function per FR-003 (missing)
- [X] T029 [US1] Integrate `fetchMetadataWithFallback` into CLI backfill path in `scripts/ingest.mjs` per US1/AC1 (missing)
- [X] T030 [US1] Ensure fallback description exclusion in `scripts/ingest.mjs` per FR-005 (missing)
- [X] T031 [US2] Add cover candidate merging to existing `pickBestCover` logic in `scripts/metadata.mjs` per FR-006 (missing)
- [X] T032 [US2] Implement cover file protection gates in `scripts/ingest.mjs` per FR-007 (missing)
- [X] T033 [US3] Add Polish fallback outcome reporting in `scripts/ingest.mjs` per FR-011, FR-012 (missing)
- [X] T034 [US3] Implement serverless fallback reporting in `azure/src/functions/ingest.mjs` per FR-009 (missing)
- [X] T035 [P] Create metadata test file with fallback scenarios in `scripts/metadata.test.mjs` per plan testing (missing)
- [X] T036 [P] Add ingest test coverage for fallback outcomes in `scripts/ingest.test.mjs` per plan testing (missing)
- [X] T037 Update README with `originalTitle` usage examples in `README.md` per T023 (missing)
