# Data Model: User Stats and Leaderboard

## Existing Source Records

### Book

| Field | Type | Rules |
|---|---|---|
| `title` | string | Required; used for display and slug generation |
| `author` | string or null | Existing optional book metadata |
| `scores` | map of user name to number or null | Numeric values are valid grades; null means no grade |
| source index | integer | Derived from `books.json`; canonical archive-addition order |

### Member Score

| Field | Type | Rules |
|---|---|---|
| `name` | string | Existing roster/name key; links to one member slug |
| `score` | number or null | Only numeric, accepted-scale values contribute to statistics |

## Derived Entities

### User Statistics

| Field | Type | Rules |
|---|---|---|
| `slug` | string | Stable URL identity generated from the canonical name |
| `name` | string | Displayed Polish member name |
| `ratedCount` | integer | Count of valid numeric grades |
| `average` | number or null | Sum of valid grades divided by `ratedCount`; null when zero |
| `averageLabel` | string | Polish-formatted average or `—` |
| `highestScore` | number or null | Maximum valid grade or null |
| `lowestScore` | number or null | Minimum valid grade or null |
| `longestStreak` | integer | Maximum consecutive run in source book order; zero when no valid grades |
| `averageEligible` | boolean | True only when `ratedCount >= 3` |

### Member Rating

| Field | Type | Rules |
|---|---|---|
| `book` | Book | Existing book record |
| `score` | number | Valid numeric grade for the member |
| `archiveIndex` | integer | Source order used for chronological display and streak calculation |

### Leaderboard Category

| Field | Type | Rules |
|---|---|---|
| `key` | `activity` / `highest-average` / `lowest-average` / `streak` | One of the four public categories |
| `label` | string | Polish user-facing category label |
| `entries` | User Statistics[] | Ranked by category metric with deterministic tie ordering |
| `leaderSlugs` | string[] | Every entry tied for the best eligible metric |

## Relationships and Invariants

- A member rating belongs to one book and one canonical user name.
- User statistics are derived from member ratings; they are not persisted separately.
- Null, invalid, or missing grades never contribute to counts, averages, extrema, or streaks.
- Average ranking categories include only users with `averageEligible = true`.
- Activity and streak rankings include users with at least one valid grade.
- A user detail page can show an average with one or two grades, but it cannot show that user as an average-category leader.
- The source index is never replaced by `getBooks()` display ranking when building member history or streaks.
