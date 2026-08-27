# Feature Specification: Cross-Language Metadata Fallback via Original Title

**Feature Branch**: `002-original-title-fallback`

**Created**: 2026-08-26

**Status**: Draft

**Input**: User description: "Let categories (not descriptions) fall back to a foreign-language edition and covers."

## Context

Books read in Polish translation are frequently catalogued twice: once under the Polish
title (a sparse, often Amazon-scraped stub) and once under the original title (a rich
record with subjects and covers). The two records are not linked by any database field.

Worked example — *Pierwszych piętnaście żywotów Harry'ego Augusta* (C. North):

| Source | Result |
|---|---|
| Google Books, Polish title | found, ISBN `9788379437924`, `categories: []`, `description: null` |
| Open Library, Polish title text search | 0 results |
| Open Library, by ISBN | work `OL20714493W`, `subjects: []`, no `translation_of`, no `languages` |
| Open Library, original title | `Reincarnation`, `Fiction`, `Time travel`, `End of the world` |

The records share no author-plus-title signal strong enough to link automatically: the two
titles have zero tokens in common, and the author has a dozen other works. Therefore the
link MUST be stated by a human rather than inferred.

## Clarifications

### Session 2026-08-26

- Q: Should a foreign-language record be allowed to supply the description? → A: No. A Polish
  book must never display an English blurb. Categories and covers only.
- Q: Should the original title be inferred from the author plus a fuzzy title match? → A: No.
  Any rule loose enough to link the two titles above would mis-link other books. The original
  title is an explicit, human-supplied field.
- Q: Do covers need new work? → A: No. `fetchMetadata` already appends an Open Library
  cover-by-ISBN URL, which is an exact identifier. The fallback lookup contributes its cover
  URLs as additional candidates to the existing `pickBestCover` selection; it does not
  replace the ISBN route.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Uzupełnienie kategorii książki w tłumaczeniu (Priority: P1)

As an archive maintainer, I want to record a book's original title so that its categories can
be filled from the original-language edition when the translated edition has none.

**Why this priority**: This is the whole point of the feature; without it the affected books stay permanently uncategorised.

**Independent Test**: Add an original title to a book whose stored record has empty categories, run the backfill for that book alone, and verify categories appear while the description remains unchanged.

**Acceptance Scenarios**:

1. **Given** a book with an original title recorded and no categories, **When** enrichment runs, **Then** categories are taken from the original-language record and stored.
2. **Given** that same book, **When** enrichment runs, **Then** the stored description is neither set nor replaced from the original-language record.
3. **Given** a book with no original title recorded, **When** enrichment runs, **Then** behaviour is byte-for-byte identical to the current behaviour.
4. **Given** a book whose primary lookup already returned categories, **When** enrichment runs, **Then** no fallback lookup is performed and no extra API call is spent.

---

### User Story 2 - Zachowanie istniejących okładek i opisów (Priority: P1)

As an archive maintainer, I want the fallback to add only what is missing so that data I curated by hand is never silently replaced.

**Why this priority**: The archive is hand-editable by design; a fallback that overwrites would make manual correction pointless.

**Independent Test**: Hand-write categories and place a cover file for a book that also has an original title, run the backfill, and verify both survive untouched.

**Acceptance Scenarios**:

1. **Given** a book already has a cover file matching its slug, **When** enrichment runs without the force flag, **Then** no cover is downloaded and no cover file is written.
2. **Given** a book already has non-empty categories, **When** enrichment runs without the force flag, **Then** the stored categories are left exactly as they are.
3. **Given** the force flag is used, **When** enrichment runs, **Then** categories and cover may be refreshed, and the description still MUST NOT come from the fallback record.

---

### User Story 3 - Widoczność źródła danych (Priority: P2)

As an archive maintainer, I want to see when a value came from the original-language edition so that I can judge whether it is appropriate for a Polish book.

**Why this priority**: Categories borrowed across languages are a judgement call; silent borrowing hides the decision from review.

**Acceptance Scenarios**:

1. **Given** the fallback supplied categories, **When** enrichment reports its result, **Then** the report names the original title used and marks the categories as borrowed.
2. **Given** the fallback was attempted and found nothing, **When** enrichment reports its result, **Then** the report says so rather than failing silently.

### Edge Cases

- The original title is recorded but no database knows it; the book keeps its existing data and the attempt is reported.
- The original title is recorded and equals the stored title; no second lookup is performed.
- The fallback record's categories exceed the archive's category cap; the same cap that applies to primary results applies here.
- The primary lookup fails entirely while the fallback succeeds; categories and cover may still be taken, and the description stays empty.
- A rate-limit or network error during the fallback lookup leaves the book unchanged and is reported as a failure, not as "not found".
- Correcting a stored title changes the derived slug and therefore the expected cover filename; the existing cover file must be renamed in the same change or it is orphaned.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A book record MUST support an optional original-title field alongside its title and author.
- **FR-002**: The field MUST be optional; records without it MUST behave exactly as they do today.
- **FR-003**: A fallback lookup MUST be performed only when the original-title field is present AND the primary lookup yielded no categories or no usable cover.
- **FR-004**: The fallback lookup MUST contribute categories and cover-image candidates only.
- **FR-005**: The system MUST NOT take a description from the fallback record under any circumstance, including when the force flag is used.
- **FR-006**: Cover candidates from the fallback MUST be added to the existing best-cover selection rather than bypassing it, so the largest valid image still wins.
- **FR-007**: Existing non-empty categories and existing cover files MUST NOT be overwritten unless the force flag is used.
- **FR-008**: The archive file MUST remain hand-editable and MUST keep its current compact serialisation, with the new field omitted entirely when absent.
- **FR-009**: The fallback MUST apply to both the local command-line enrichment path and the serverless ingest path, via the modules those two already share.
- **FR-010**: The system MUST NOT infer, translate, or guess an original title from the stored title, the author, or any search result.
- **FR-011**: Enrichment output MUST report, per book, whether the fallback was used, which original title it used, and what it supplied.
- **FR-012**: All operator-facing messages introduced by this feature MUST be written in Polish, matching the existing enrichment output.
- **FR-013**: The fallback MUST cost at most one additional metadata lookup per book per run.
- **FR-014**: A failed or empty fallback MUST leave the book record unchanged.

### Key Entities

- **Book Record**: A stored archive entry — title, author, scores, and optionally categories, description, and original title.
- **Original Title**: A human-supplied string naming the same work in its original language, used solely as a lookup key.
- **Metadata Result**: What a lookup returns for one title/author pair — description, categories, identifier, and cover candidates.
- **Enrichment Report**: The per-book account of which sources answered and which fields were filled, borrowed, or skipped.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a book with an original title recorded and no categories, a single backfill run fills its categories in 100% of cases where the original-language record has subjects.
- **SC-002**: Across the full archive, 0 descriptions change as a result of this feature.
- **SC-003**: Across the full archive, 0 existing cover files are modified when the backfill is run without the force flag.
- **SC-004**: Re-running the backfill immediately after a successful run produces 0 further changes and 0 fallback lookups.
- **SC-005**: For records without an original title, the produced archive file is byte-identical to the file produced before this feature.
- **SC-006**: The worked example above resolves to at least 3 categories after adding its original title and re-running the backfill.

## Assumptions

- The archive's existing category cap and cleaning rules apply unchanged to borrowed categories.
- Borrowed categories may be in the original language; the archive already stores source-language category strings and does not translate them.
- The cover-by-identifier route already in place is sufficient for covers; the fallback improves candidate coverage rather than introducing a new mechanism.
- Maintainers add original titles by hand, one book at a time, as they notice gaps. Bulk discovery of original titles is out of scope.
- The two enrichment paths continue to share their metadata and serialisation modules, so a single implementation covers both.
- Reading the site does not change; original title is lookup input, not display data. Showing it to visitors is out of scope.
