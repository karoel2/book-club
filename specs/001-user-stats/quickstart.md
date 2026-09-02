# Quickstart: User Stats and Leaderboard

## Prerequisites

- Node.js dependencies installed with `npm install`.
- Repository data available in `src/data/books.json`.
- A current Chromium-based browser for visual checks.

## Build Validation

Run:

```bash
npm run build
```

Expected outcome: Astro completes a static production build and generates the scoreboard, book pages, and member pages without TypeScript or route errors.

## Functional Validation

1. Open `/` and confirm the user statistics section appears below the scoreboard.
2. Confirm all four Polish categories are present: activity, highest average, lowest average, and streak.
3. Confirm users with fewer than three valid grades do not lead either average category.
4. Confirm every tied leader has a golden frame and a non-color leader indication.
5. Select a user from the scoreboard and confirm `/members/{slug}` shows the full summary and history.
6. Open a book page at `/books/{slug}`, select a member name, and confirm it reaches the same member route.
7. Confirm member history is in `books.json` source order, not score or title order.
8. Temporarily validate a no-valid-grade fixture and a missing-member URL; confirm the Polish empty and not-found states.

## Calculation Fixtures

Use the rules in [data-model.md](data-model.md) to verify manually calculated fixtures for:

- count and average from valid numeric grades;
- exclusion from average rankings below three grades;
- highest/lowest grade values;
- a streak of one, a streak with gaps, and a tie;
- null or invalid grades excluded from every statistic.

## Responsive and Accessibility Validation

- Check the scoreboard and member page at desktop width and a narrow mobile width.
- Confirm no horizontal scrolling is needed.
- Navigate user links and leader indicators with keyboard focus.
- Confirm the golden treatment is not the sole source of leader information.
