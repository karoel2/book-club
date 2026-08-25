---

description: "Task list for User Stats and Leaderboard"
---

# Tasks: User Stats and Leaderboard

**Input**: Design documents from `/specs/001-user-stats/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/ui.md`, `quickstart.md`

**Tests**: No separate test suite was requested; validation tasks use the documented fixtures, production build, and manual browser checks.

**Organization**: Tasks are grouped by user story so each story can be implemented and validated as an independent increment after the shared data foundation.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the existing Astro project and establish a clean baseline before feature work.

- [X] T001 Verify the existing Astro/TypeScript baseline and current build with `npm run build` in `package.json`
- [X] T002 [P] Review the source-order and member-link assumptions against `src/data/books.json`, `src/data/books.ts`, and `src/components/MemberScore.astro`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Create the derived statistics model and deterministic ranking helpers required by every user story.

**Checkpoint**: Foundation ready when the data helpers expose valid member statistics, archive-order histories, category leaders, and tie handling without changing source data.

- [X] T003 Extend `Book` and `MemberRating` types in `src/data/books.ts` with stable archive indices needed for chronological history and streak calculation
- [X] T004 Implement valid-grade filtering, count, average, highest grade, lowest grade, and minimum-three-grade average eligibility in `src/data/books.ts`
- [X] T005 Implement longest consecutive grading streak calculation in source book order in `src/data/books.ts`
- [X] T006 Implement deterministic leaderboard category helpers for activity, highest average, lowest average, and streak, including all tied leaders in `src/data/books.ts`
- [X] T007 Update `getMemberRatings` in `src/data/books.ts` to return valid ratings from earliest to latest archive order instead of score order
- [X] T008 Verify the derived helpers against fixtures covering null/invalid grades, one- and two-grade users, three-grade eligibility, gaps, ties, and empty data in `specs/001-user-stats/quickstart.md`

---

## Phase 3: User Story 1 - Odkrywanie rankingu użytkowników (Priority: P1) MVP

**Goal**: Show a below-scoreboard Polish leaderboard that makes participation, average, and streak leaders discoverable.

**Independent Test**: Open `/` with representative data and confirm the four categories, correct leaders and ties, golden treatment, user links, and mobile-readable layout appear directly below the existing scoreboard.

- [X] T009 [P] [US1] Define the four Polish category labels, metric formatting, and leader metadata contract in `src/pages/index.astro`
- [X] T010 [US1] Render the user statistics section directly below the existing scoreboard using derived helpers from `src/data/books.ts` in `src/pages/index.astro`
- [X] T011 [US1] Render every tied category leader with a golden frame and a non-color `Lider` indicator in `src/pages/index.astro`
- [X] T012 [US1] Link each displayed leaderboard user to `/members/{slug}` using `getMemberSlug` and `url` in `src/pages/index.astro`
- [X] T013 [US1] Add responsive scoreboard statistics styles with visible focus states and no horizontal scrolling in `src/pages/index.astro` and `src/styles/global.css`
- [X] T014 [US1] Validate User Story 1 using the representative data, tie data, and mobile checks in `specs/001-user-stats/quickstart.md`

**Checkpoint**: The scoreboard independently delivers the MVP discovery experience and every displayed user link resolves to a member route.

---

## Phase 4: User Story 2 - Przeglądanie aktywności użytkownika (Priority: P1)

**Goal**: Make member detail pages useful as public profile summaries with complete chronological grading history.

**Independent Test**: Select a user from `/` and `/books/{slug}`, then confirm the member route shows all required statistics and books in source/archive order with each valid grade.

- [ ] T015 [P] [US2] Add highest grade, lowest grade, and longest streak fields to the derived member model consumed by `src/pages/members/[slug].astro`
- [ ] T016 [US2] Render the complete Polish member summary with count, average, highest grade, lowest grade, and streak in `src/pages/members/[slug].astro`
- [ ] T017 [US2] Render the member's valid graded books in earliest-to-latest archive order with the user's grade in `src/pages/members/[slug].astro`
- [ ] T018 [US2] Preserve and verify member navigation from book score rows through `src/components/MemberScore.astro` and `src/pages/books/[slug].astro`
- [ ] T019 [US2] Add responsive member summary and history styles with keyboard-accessible links in `src/pages/members/[slug].astro`
- [ ] T020 [US2] Validate User Story 2 from both scoreboard and book-page entry points using `specs/001-user-stats/quickstart.md`

**Checkpoint**: A visitor can navigate from either public surface to a member page and understand the member's contribution without an account.

---

## Phase 5: User Story 3 - Rozumienie wyróżnień i braków danych (Priority: P2)

**Goal**: Make empty, ineligible, missing-user, and accessibility states explicit and trustworthy.

**Independent Test**: Use empty, partial, invalid-grade, tied, and unknown-user scenarios and verify Polish explanatory states, no fabricated metrics, and accessible leader treatment.

- [ ] T021 [P] [US3] Add the no-valid-grades empty state below the scoreboard in `src/pages/index.astro`
- [ ] T022 [P] [US3] Add the below-three-grades presentation rule for detail averages versus average-ranking eligibility in `src/pages/members/[slug].astro`
- [ ] T023 [US3] Add a Polish not-found member state with a scoreboard link for unknown member slugs in `src/pages/members/[slug].astro` and `src/pages/404.astro`
- [ ] T024 [US3] Add accessible text semantics for golden leaders, category labels, empty states, and navigation in `src/pages/index.astro` and `src/pages/members/[slug].astro`
- [ ] T025 [US3] Validate empty, partial, invalid-grade, tie, unknown-user, desktop, mobile, and keyboard scenarios in `specs/001-user-stats/quickstart.md`

**Checkpoint**: The feature communicates all defined edge cases without false rankings, inaccessible color-only meaning, or account requirements.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verify the complete static feature and preserve project governance requirements.

- [ ] T026 [P] Review all new visible copy for Polish labels, names, diacritics, empty states, errors, and navigation in `src/pages/index.astro`, `src/pages/members/[slug].astro`, and `src/pages/books/[slug].astro`
- [ ] T027 [P] Review derived-value ownership to ensure no rankings or book facts are duplicated outside `src/data/books.ts`
- [ ] T028 Run the complete production build and quickstart validation from `specs/001-user-stats/quickstart.md`
- [ ] T029 Review the final diff for static hosting, zero-account access, strict TypeScript, responsive behavior, and constitution compliance in `specs/001-user-stats/plan.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: No dependencies; establishes the baseline.
- **Phase 2 Foundational**: Depends on Phase 1 and blocks all story work because every story consumes the derived statistics helpers.
- **Phase 3 User Story 1**: Depends on Phase 2; is the recommended MVP.
- **Phase 4 User Story 2**: Depends on Phase 2 and can proceed in parallel with US1, but its final navigation validation benefits from US1 links.
- **Phase 5 User Story 3**: Depends on Phase 2 and can proceed in parallel with US1/US2; final cross-surface checks follow their UI changes.
- **Phase 6 Polish**: Depends on all selected story phases.

### User Story Dependencies

- **US1**: No dependency on another user story after the foundational data helpers.
- **US2**: No data dependency on US1; shares the same member helpers and uses the scoreboard/book links as entry points.
- **US3**: No data dependency on US1 or US2; validates states exposed by those stories.

### Parallel Opportunities

- T002 can run in parallel with T001.
- T003 and T004 can be developed in parallel only if they coordinate the shared `src/data/books.ts` interface; T005-T007 follow the resulting types.
- T009 and T013 can be prepared in parallel because they concern separate presentation concerns in the same story phase.
- T015 and T018 can be prepared in parallel in US2; T016-T017 depend on the derived fields and ordering contract.
- T021 and T022 can run in parallel in US3; T024 follows the final markup.
- T026 and T027 can run in parallel during polish.
- US1, US2, and US3 can be assigned to separate developers after Phase 2, with shared-file coordination for `src/data/books.ts`.

## Parallel Example: User Story 1

```text
Task: T009 Define category labels and metric presentation in src/pages/index.astro
Task: T013 Add responsive scoreboard statistics styles in src/pages/index.astro and src/styles/global.css
```

## Parallel Example: User Story 2

```text
Task: T015 Add derived member fields consumed by src/pages/members/[slug].astro
Task: T018 Verify member links in src/components/MemberScore.astro and src/pages/books/[slug].astro
```

## Implementation Strategy

### MVP First

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 (US1) and run its independent test.
3. Stop for review/demo if the below-scoreboard leaderboard meets the engagement goal.

### Incremental Delivery

1. Add US2 for richer member discovery and chronological histories.
2. Add US3 for trustworthy empty/error/accessibility behavior.
3. Complete Phase 6 and run the production build plus responsive checks.

## Notes

- Every implementation task names its target file or validation document.
- Separate test files were not added because tests were not explicitly requested; T008 and story validation tasks still require fixture and browser verification.
- `[P]` marks only work that can proceed independently without waiting on incomplete tasks; tasks sharing `src/data/books.ts` require coordination.

## Phase 6: Convergence

- [X] T030 [US2] Add highest grade, lowest grade, and longest streak statistics to member detail view in `src/pages/members/[slug].astro` per US2/AC1 (missing)
- [X] T031 [US2] Render member's graded books in earliest-to-latest archive order using `getMemberRatingsChronological` in `src/pages/members/[slug].astro` per US2/AC2 (missing)
- [X] T032 [US3] Add below-three-grades presentation rule for detail averages versus average-ranking eligibility in `src/pages/members/[slug].astro` per US3/AC2 (missing)
- [X] T033 [US3] Create Polish not-found member state with scoreboard link in `src/pages/404.astro` and update error handling in `src/pages/members/[slug].astro` per US3/AC3 (missing)
- [X] T034 [US3] Add accessible text semantics for statistics, empty states, and navigation in `src/pages/index.astro` and `src/pages/members/[slug].astro` per US3/AC4 (missing)
