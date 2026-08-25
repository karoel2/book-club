# Research: User Stats and Leaderboard

## Archive Order

- **Decision**: Treat the order of records in `src/data/books.json` as the stable archive-addition order for member histories and streaks.
- **Rationale**: The repository currently constructs `books` directly from the JSON array, while `getBooks()` applies a display-only ranking sort. Preserving the source index avoids changing history when scoreboard sorting changes.
- **Alternatives considered**: Sort by book title or book average; rejected because neither represents when a book entered the archive.

## Average Ranking Eligibility

- **Decision**: A user qualifies for highest/lowest average rankings only after at least three valid numeric grades. Their average remains visible on their detail page with fewer grades.
- **Rationale**: This is the clarified product decision and prevents a single grade from determining a category leader.
- **Alternatives considered**: One-grade eligibility and five-grade eligibility; rejected because the former is misleading and the latter delays useful comparisons in the existing archive.

## Longest Streak

- **Decision**: Scan books in source order and count consecutive books with a valid grade for the user; reset the count at an ungraded or invalid entry and retain the maximum.
- **Rationale**: This directly matches the specification's definition of an uninterrupted run in archive order and works with static build-time data.
- **Alternatives considered**: Consecutive calendar dates or consecutive grading sessions; rejected because the archive has no required date/session data in the current model.

## Static Rendering and Navigation

- **Decision**: Generate member routes with `getStaticPaths()` and calculate rankings during the Astro build; link users using the existing slug helper.
- **Rationale**: This preserves the constitution's static-first and zero-account constraints and reuses established repository patterns.
- **Alternatives considered**: A client-side runtime endpoint; rejected because it would add unnecessary infrastructure and conflict with static hosting requirements.

## Golden Leader Treatment

- **Decision**: Mark every tied first-place entry with the same accessible golden frame and use text/semantic indication in addition to color.
- **Rationale**: This satisfies the tie rule and avoids making color the only way to understand leadership.
- **Alternatives considered**: Highlight only one winner; rejected because it misrepresents ties.
