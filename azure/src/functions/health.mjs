// GET /api/health?code=<key> — quick config + reachability check with no secret
// values echoed. Confirms the app settings are present and GitHub is reachable.
import { app } from '@azure/functions';
import { loadBooksJson } from '../github.mjs';

app.http('health', {
  methods: ['GET'],
  authLevel: 'function',
  handler: async () => {
    const config = {
      visionConfigured: !!(process.env.VISION_ENDPOINT && process.env.VISION_KEY),
      githubConfigured: !!(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO),
      ingestSecretSet: !!process.env.INGEST_SECRET,
      allowlistCount: (process.env.ALLOWED_SENDERS || '').split(',').map((s) => s.trim()).filter(Boolean).length,
      repo: process.env.GITHUB_REPO || null,
      branch: process.env.GITHUB_BRANCH || 'main',
    };

    let github = 'skipped';
    let books = null;
    if (config.githubConfigured) {
      try {
        books = (await loadBooksJson()).length;
        github = 'ok';
      } catch (e) {
        github = `error: ${e.message}`;
      }
    }

    return { status: 200, jsonBody: { ok: true, config, github, books } };
  },
});
