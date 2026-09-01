# Implementation Plan: Cross-Language Metadata Fallback via Original Title

**Branch**: `002-original-title-fallback` | **Date**: 2026-08-26 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-original-title-fallback/spec.md`

## Summary

Add an optional human-supplied `originalTitle` to stored books and use it for one conditional metadata lookup when primary categories or a usable cover are missing. Merge only fallback categories and cover candidates into the existing enrichment flow; never use fallback descriptions. Keep compact JSON serialization, preserve manual data unless forced, and report Polish fallback outcomes in both local and Azure ingest paths through the shared metadata module.

## Technical Context

**Language/Version**: JavaScript ES modules on Node.js; TypeScript in Astro 7.1.4

**Primary Dependencies**: Existing Node `fetch`, Astro, Azure Functions, Open Library and Google Books HTTP APIs; no new dependency

**Storage**: `src/data/books.json`; covers in `src/assets/covers/`; Azure path synchronizes shared modules

**Testing**: Existing build plus focused Node fixture tests for metadata merge, fallback gating, serialization, errors, and cover preservation; Azure ingest smoke test

**Target Platform**: GitHub Pages static site and Node/Azure Functions ingest environments

**Project Type**: Static Astro web application with CLI and serverless ingestion tools

**Performance Goals**: At most one additional fallback metadata lookup per book per run; no fallback call after primary categories and usable cover are available

**Constraints**: Fallback supplies categories and cover candidates only; Polish operator messages; no title inference; compact hand-editable serialization; failed/empty fallback must not mutate the record

**Scale/Scope**: Existing archive backfill and new-book ingest, one fallback lookup per eligible book, shared local/serverless metadata behavior

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **PASS** Static-first: archive display remains build-time and no runtime API is added.
- **PASS** Data-driven content: `originalTitle` is persisted in the existing hand-editable archive format.
- **PASS** Shared behavior: local and Azure ingestion use the same metadata and parsing/serialization rules.
- **PASS** Safe enrichment: fallback descriptions are excluded and failed fallback requests do not overwrite records.
- **PASS** Quality gates: preserve existing build and ingestion validation, with explicit fixture coverage for the new branch.
- **PASS** Complexity: no new dependency, service, or persistence layer is required.

## Project Structure

### Documentation (this feature)

```text
specs/002-original-title-fallback/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── ui.md
└── tasks.md                 # created by /speckit.tasks
```

### Source Code (repository root)

```text
scripts/
├── metadata.mjs             # shared metadata lookup and cover candidates
├── ingest.mjs               # CLI enrichment, backfill, reporting, mutation gates
└── lib/parse.mjs            # compact books.json serialization
azure/src/shared/metadata.mjs # synchronized serverless metadata implementation
src/data/books.json          # optional originalTitle input field
```

**Structure Decision**: Extend the existing shared metadata and serialization modules. Keep fallback orchestration and mutation protection in the CLI/serverless consumers, synchronize the Azure shared copy using the existing script, and do not add a display field or public route.

## Complexity Tracking

No constitution violations. No complexity exceptions are required.

## Phase 0: Research

See [research.md](research.md) for decisions on fallback gating, result merging, failure isolation, and synchronization.

## Phase 1: Design

- [data-model.md](data-model.md) defines the optional persisted field and transient enrichment/report shapes.
- [contracts/ui.md](contracts/ui.md) defines the operator output contract and serialization compatibility.
- [quickstart.md](quickstart.md) defines fixture and end-to-end validation scenarios.

## Post-Design Constitution Check

- **PASS** Optional metadata remains in the existing JSON archive and is omitted when absent.
- **PASS** Fallback is explicitly bounded to one lookup and categories/cover candidates.
- **PASS** Existing descriptions, categories, and cover files remain protected by force-aware gates.
- **PASS** Local and Azure paths share the same behavior and Polish reporting requirements.
