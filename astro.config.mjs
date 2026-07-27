// @ts-check
import { defineConfig } from 'astro/config';

// On GitHub Actions the deploy URL and base path are derived from the repo, so
// nothing needs editing by hand. A project repo (e.g. "book-club") deploys under
// https://<owner>.github.io/book-club/ ; a user site (<owner>.github.io) and
// local dev both serve from the root.
const ghRepo = process.env.GITHUB_REPOSITORY; // "owner/name" on GitHub Actions
const [owner, repo] = ghRepo ? ghRepo.split('/') : [];
const isProjectSite = Boolean(repo) && !repo.endsWith('.github.io');

// https://docs.astro.build/en/reference/configuration-reference/
export default defineConfig({
  site: owner ? `https://${owner}.github.io` : 'http://localhost:4321',
  base: isProjectSite ? `/${repo}` : undefined,
  trailingSlash: 'ignore',
});
