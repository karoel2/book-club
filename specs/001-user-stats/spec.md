# Feature Specification: User Stats and Leaderboard

**Feature Branch**: `001-user-stats`

**Created**: 2026-08-21

**Status**: Draft

**Input**: User description: "Add a user screen showing the most active user, highest and lowest average grade, and longest grading streak. Show books in the order they were added. From a book, selecting a user should show that user's stats. Put the user information below the scoreboard and highlight category leaders with a golden frame to increase engagement."

## Clarifications

### Session 2026-08-21

- Q: Should the highest and lowest average-grade rankings include users who have graded only one book? → A: No; require at least 3 graded books.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Odkrywanie rankingu użytkowników (Priority: P1)

As a visitor, I want to see member statistics below the scoreboard so that I can compare participation and discover engaging contributors.

**Why this priority**: The leaderboard is the primary discovery surface and directly supports the engagement goal.

**Independent Test**: Open the scoreboard page with representative graded-book data and verify that the user statistics section appears below the scoreboard with all defined categories and understandable values.

**Acceptance Scenarios**:

1. **Given** multiple users have graded books, **When** a visitor opens the scoreboard page, **Then** a user statistics section appears below the scoreboard and shows rankings for number of graded books, highest average grade, lowest average grade, and longest grading streak.
2. **Given** a category has a clear leader, **When** the leaderboard is displayed, **Then** the leading user in that category is shown with a visually distinct golden frame.
3. **Given** two or more users tie for a category lead, **When** the leaderboard is displayed, **Then** every tied leader receives the golden frame and no tied user is presented as the sole winner.
4. **Given** a visitor views the page on a narrow screen, **When** the user statistics section is displayed, **Then** all category labels, values, names, and navigation actions remain readable without horizontal scrolling.

---

### User Story 2 - Przeglądanie aktywności użytkownika (Priority: P1)

As a visitor, I want to open a user's detail view so that I can understand that user's contribution and grading history.

**Why this priority**: Individual profiles turn an anonymous ranking into a navigable social discovery experience.

**Independent Test**: Select a user from a leaderboard entry or a book page and verify that the resulting view contains that user's summary statistics and chronologically ordered books.

**Acceptance Scenarios**:

1. **Given** a user appears in the leaderboard, **When** a visitor selects the user, **Then** the visitor reaches that user's detail view with their graded-book count, average grade, lowest and highest grade, and longest grading streak.
2. **Given** a user has graded multiple books, **When** the detail view is opened, **Then** the books are listed in the order they were added to the archive, from earliest to latest, and each book identifies the user's grade.
3. **Given** a visitor is viewing a book with recorded user grades, **When** the visitor selects a user name, **Then** the user's detail view opens for that selected user.
4. **Given** a visitor opens a user detail view directly by URL, **When** the user exists, **Then** the view is accessible without an account or login.

---

### User Story 3 - Rozumienie wyróżnień i braków danych (Priority: P2)

As a visitor, I want clear explanations and graceful empty states so that the statistics feel trustworthy rather than confusing or competitive in a misleading way.

**Why this priority**: Transparent calculation and empty states protect trust while keeping the feature useful as the archive grows.

**Independent Test**: Use data sets containing one user, unrated books, missing user grades, and ties, then verify labels, values, and explanatory states.

**Acceptance Scenarios**:

1. **Given** a user has fewer than three graded books, **When** that user is considered for average-grade rankings, **Then** they are excluded from those rankings and are not presented as a highest- or lowest-average leader.
2. **Given** no users have graded books, **When** a visitor opens the scoreboard page, **Then** the section explains that statistics will appear after users grade books instead of showing fabricated rankings.
3. **Given** a user has graded exactly one book, **When** their statistics are shown, **Then** their average is that grade and their longest streak is one book.
4. **Given** the archive contains fewer books than the requested activity history, **When** the user detail view is shown, **Then** it lists all available graded books without placeholders for unavailable records.

### Edge Cases

- A user name is present on one book but has no valid grade; that record does not contribute to any user statistic.
- Grades outside the archive's accepted grading scale are not included in calculations and are not silently converted.
- Books added on the same date retain the archive's existing deterministic order, so user histories do not reorder between page visits.
- A requested user does not exist; the page shows a Polish not-found message and a link back to the scoreboard.
- A user has graded books with gaps in archive order; the streak counts the longest uninterrupted sequence of consecutive archived books graded by that user.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The scoreboard page MUST show a user statistics section directly below the existing scoreboard.
- **FR-002**: The user statistics section MUST provide rankings for total graded books, highest average grade, lowest average grade, and longest uninterrupted grading streak.
- **FR-003**: The system MUST calculate each user's total graded books from valid grades attributed to that user.
- **FR-004**: The system MUST calculate each user's average grade using only that user's valid grades and MUST exclude users with fewer than three valid grades from highest- and lowest-average rankings.
- **FR-005**: The system MUST calculate a user's longest grading streak as the maximum consecutive run of archived books, in archive-addition order, that the user graded.
- **FR-006**: The system MUST identify every tied first-place user in each category and MUST apply the category's golden frame to each tied leader.
- **FR-007**: The system MUST provide a selectable user identity in leaderboard entries and in user-grade information on book views.
- **FR-008**: Selecting a user MUST open a user detail view that includes the user's total graded books, average grade, highest grade, lowest grade, and longest grading streak.
- **FR-009**: The user detail view MUST list the user's graded books in the archive's book-addition order and show the user's grade for each listed book.
- **FR-010**: The feature MUST be publicly accessible without account creation, authentication, or personal data collection.
- **FR-011**: All labels, explanatory text, empty states, navigation guidance, and error messages introduced by this feature MUST be written in Polish.
- **FR-012**: The feature MUST show an understandable empty state when there are no valid user grades and a not-found state when a requested user does not exist.
- **FR-013**: The user statistics and detail views MUST remain usable on desktop and narrow mobile screens without horizontal scrolling.
- **FR-014**: User statistics MUST be derived from the existing structured book and grade records and MUST update when those records change.

### Key Entities

- **User**: A named book-club participant identified by the existing roster/name data and associated with grades across books.
- **User Statistics**: Derived measures for one user: graded-book count, average grade, highest grade, lowest grade, and longest grading streak.
- **User Leaderboard Category**: One ranked measure and its leading user or tied leading users: activity, highest average, lowest average, or streak.
- **Book Activity Record**: A book, its stable archive-addition order, and the valid grade attributed to a user.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In usability checks with representative data, at least 90% of visitors can identify the leader for each available category within 30 seconds of opening the scoreboard.
- **SC-002**: At least 90% of visitors can open a user's detail view from both the scoreboard and a book view on their first attempt.
- **SC-003**: For a test archive of 1,000 books and 100 users, the complete scoreboard and user detail statistics are visible to visitors within 2 seconds under typical broadband conditions.
- **SC-004**: In validation against manually calculated fixtures, 100% of user counts, averages, leaders, ties, and longest streaks match the expected results.
- **SC-005**: In mobile and desktop usability checks, 100% of required user statistics, book history entries, and navigation actions are accessible without horizontal scrolling.
- **SC-006**: During the first month after release, the proportion of scoreboard visitors who open at least one user detail view increases by 20% compared with the baseline measured during the preceding month.

## Assumptions

- The archive already has a defined valid grading scale and existing structured records connecting users, books, and grades.
- Users must have at least three valid graded books to qualify for the highest- and lowest-average rankings; their individual average may still be shown in their detail view with fewer grades.
- "Book order" means the stable order in which books were added to the archive, not the order in which a user graded them.
- The first release shows all four categories on the scoreboard; category filtering, sorting controls, and pagination are out of scope.
- A golden frame is a visual distinction only and does not change ranking, access, or user permissions.
- Ties are determined using the exact displayed metric value after applying the archive's normal grade precision.
- The feature uses existing public archive data and does not add profiles, comments, reactions, accounts, or personal information.
- The project remains a statically generated public site, so statistics are prepared from archive data before visitors view them.
