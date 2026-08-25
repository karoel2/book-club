# UI Contract: User Stats and Leaderboard

## Public Routes

### Scoreboard

- **Path**: `/`
- **Placement**: User statistics section directly below the existing book scoreboard.
- **Required categories**: `Najwięcej ocen`, `Najwyższa średnia`, `Najniższa średnia`, `Najdłuższa seria`.
- **Navigation**: Each displayed user name links to `/members/{slug}`.
- **Empty state**: Polish explanation that statistics appear after users grade books when no valid grades exist.

### Member Detail

- **Path**: `/members/{slug}`
- **Generated paths**: One static path for every user with at least one valid grade.
- **Summary**: Name, graded-book count, average, highest grade, lowest grade, and longest streak.
- **History**: All valid user-rated books from earliest archive-addition order to latest, with the user's grade.
- **Back navigation**: Link to the scoreboard.
- **Missing user**: Polish not-found state with a link back to the scoreboard.

### Book Member Link

- **Path**: Existing `/books/{slug}` page.
- **Interaction**: Each member name in the member score list links to that member's detail route, including members with a null displayed grade only when an existing link surface already exposes their identity.

## Visual and Accessibility Contract

- Category leaders, including ties, receive a golden frame and a non-color semantic label such as `Lider`.
- Links are keyboard reachable and retain visible focus styling.
- The layout must remain readable at mobile widths without horizontal scrolling.
- All new visible copy is Polish and uses the existing score formatting conventions.
