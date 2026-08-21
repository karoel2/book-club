<!--
Sync Impact Report
- Version change: 1.0.0 -> 1.1.0
- Modified principles: all five existing principles retained and clarified
- Added sections: Technology Standards; Development Workflow
- Removed sections: none
- Follow-up TODOs: none
-->

# Book Club Archive Constitution

## Core Principles

### I. Static-First Architecture
All user-facing features MUST be delivered as statically generated pages or client-side
JavaScript. Server-side rendering and runtime application servers are prohibited so the
archive remains deployable on zero-runtime static hosting. Every change MUST preserve a
successful static production build.

### II. Data-Driven Content
Book records MUST be stored in `src/data/books.json`, and covers MUST be stored in
`src/assets/covers/` using the record slug. Pages and components MUST derive titles,
authors, scores, averages, rankings, and member views from the structured data. Book
facts MUST NOT be duplicated as hardcoded UI content.

### III. Automation-Centric Development
Book ingestion MUST use reusable OCR, parsing, validation, and metadata-enrichment
modules where automation is available. Automated imports MUST validate member names,
scores, duplicate slugs, and score averages before publishing. Warnings or mismatches
MUST route the item to review rather than silently publishing guessed data. Dry-run
operation MUST remain available for write-producing ingestion changes.

### IV. Zero-Account User Experience
The public archive MUST NOT require accounts, authentication, login, or personal data
storage. Every public page and its core ranking and score-breakdown functionality MUST
be accessible by URL without registration. Any automation endpoint MUST protect secrets
and restrict ingestion independently of the public browsing experience.

### V. Polish Language Priority
All user-facing labels, descriptions, errors, navigation, and guidance MUST be written
in Polish. Code comments and internal technical documentation MAY use English. New
content MUST preserve Polish names and diacritics, and OCR corrections MUST prefer a
known roster match over an unverified guess.

## Technology Standards

### Frontend Stack
- **Framework**: Astro with TypeScript.
- **Styling**: Astro CSS handling with minimal dependencies.
- **Build**: Static site generation only; `npm run build` MUST pass before release.
- **Deployment**: GitHub Pages-compatible static output.

### Backend/Automation
- **Scripting**: Node.js for repository automation and ingestion scripts.
- **OCR**: macOS Vision locally and Azure AI Vision in the serverless path.
- **APIs**: Google Books and Open Library for best-effort metadata enrichment.
- **Secrets**: API keys, tokens, shared secrets, and function keys MUST come from
  environment or deployment settings and MUST NOT be committed.

### Data Management
- **Primary storage**: JSON files in `src/data/`.
- **Asset storage**: Images in `src/assets/covers/`.
- **Temporary storage**: `inbox/` for processing and review queues; unreviewed input
  MUST NOT be published.

## Development Workflow

### Code Quality
- TypeScript strict mode MUST remain enabled where TypeScript is used.
- Scripts MUST handle expected OCR, network, parsing, filesystem, and Git failures
  without silently reporting success.
- JSON data MUST be validated for required shape and score values before publication.
- Changes MUST avoid duplicating derived values that can be calculated at build time.

### Testing Strategy
- A production build MUST be run for changes affecting pages, layouts, data shape, or
  assets.
- Ingestion changes MUST be exercised with dry-run input and representative review and
  success cases.
- User-facing changes MUST be manually checked at desktop and mobile widths and in a
  current Chromium-based browser.
- A pull request MUST document any validation that cannot be run locally.

### Deployment Process
- Pushes to `main` MUST use the repository GitHub Actions workflow to build and publish
  the static site.
- Deployment MUST contain only output produced by the approved build process.
- A failed build MUST block publication.
- A rollback MUST use a reviewed Git revert or an equivalent history-preserving change.

## Governance

This constitution supersedes conflicting project practices and coding standards.
Amendments MUST document the proposed rule, its rationale, affected behavior, and any
migration or rollout impact. The amendment MUST be reviewed by the project owner and
recorded in version control with a commit message that states the governance change.

The version follows semantic versioning for governance: MAJOR indicates a backward-
incompatible removal or redefinition of a principle; MINOR indicates a new principle,
section, or materially expanded requirement; PATCH indicates clarification, wording,
or non-semantic correction. The `Last Amended` date MUST change whenever the document
changes, while `Ratified` remains the original adoption date.

Every pull request and code review MUST assess compliance with applicable principles,
technology standards, and workflow gates. The reviewer MUST call out exceptions and
their compensating controls. Complexity MUST be justified by a clear user benefit or
technical requirement. The constitution MUST be revisited when the hosting model,
data model, ingestion path, or language policy changes.

**Version**: 1.1.0 | **Ratified**: 2026-08-21 | **Last Amended**: 2026-08-21
