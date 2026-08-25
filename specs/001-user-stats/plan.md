# Implementation Plan: User Stats and Leaderboard

**Branch**: `001-user-stats` | **Date**: 2026-08-21 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-user-stats/spec.md`

## Summary

Add a Polish-language user statistics section below the existing scoreboard and enrich public member detail pages with derived counts, averages, highest/lowest grades, and longest grading streaks. Reuse the existing static Astro data pipeline in `src/data/books.ts`, preserve the source book order as archive-addition order, and render category leaders with a golden frame. No accounts, runtime APIs, or new persisted data are required.

## Technical Context

<!--
-->

**Language/Version**: TypeScript with Astro 7.1.4, Node.js package tooling

**Primary Dependencies**: Existing Astro components, CSS, and data helpers; no new dependency

**Storage**: `src/data/books.json`; derived values calculated at build time

**Testing**: `npm run build`; fixture-level TypeScript/data checks and manual Chromium checks at desktop and mobile widths

**Target Platform**: GitHub Pages-compatible static site in current Chromium-based browsers, desktop and mobile widths

**Project Type**: Static Astro web application

**Performance Goals**: Generated scoreboard and member pages visible within 2 seconds for 1,000 books and 100 users under typical broadband conditions

**Constraints**: Static generation only; no authentication or personal-data storage; all new user-facing copy in Polish; preserve stable source order for streak and history calculations

**Scale/Scope**: Existing archive data, approximately 1,000 books and 100 users for the stated performance target; one scoreboard section and public member detail routes

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **PASS** Static-first: all calculations and pages remain build-time/client-rendered with no runtime server.
- **PASS** Data-driven content: rankings and member views derive from `src/data/books.json` through `src/data/books.ts`; no duplicated book facts.
- **PASS** Zero-account UX: public routes remain accessible without login or personal data collection.
- **PASS** Polish language: all introduced labels, empty states, navigation, and errors are specified in Polish.
- **PASS** Quality gates: the implementation must preserve strict TypeScript and pass `npm run build`; manual desktop/mobile Chromium checks are included in validation.
- **PASS** Complexity: no constitution violation requires tracking.

## Project Structure

### Documentation (this feature)

```text
specs/001-user-stats/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)
<!--
-->

```text
src/
├── data/books.ts                 # member statistics and archive-order derivation
├── pages/index.astro             # scoreboard and user statistics section
├── pages/members/[slug].astro    # member summary and chronological history
├── pages/books/[slug].astro       # existing member links on book details
├── components/MemberScore.astro  # existing user navigation surface
└── styles/global.css              # shared responsive/golden treatment as needed
```

**Structure Decision**: Extend the existing single Astro project. Keep domain calculations in `src/data/books.ts`, compose the scoreboard in `src/pages/index.astro`, retain static member paths in `src/pages/members/[slug].astro`, and use the existing `MemberScore` link from book pages. Add a focused component only if the leaderboard markup becomes difficult to read; do not introduce a service or runtime API.

## Complexity Tracking

No constitution violations. No complexity exceptions are required.

## Phase 0: Research

See [research.md](research.md) for decisions on archive ordering, ranking eligibility, streak calculation, and static-site rendering.

## Phase 1: Design

- [data-model.md](data-model.md) defines the derived member statistics and validation rules.
- [contracts/ui.md](contracts/ui.md) defines the public UI contract, routes, labels, and empty/not-found states.
- [quickstart.md](quickstart.md) defines build, fixture, and responsive validation scenarios.

## Post-Design Constitution Check

- **PASS** Derived statistics remain build-time values from structured JSON.
- **PASS** Stable archive order is retained instead of relying on the existing score-sorted member history.
- **PASS** Public member links and static paths preserve zero-account access.
- **PASS** Polish copy, responsive behavior, and production-build validation are explicit in the design artifacts.
