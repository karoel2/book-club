// @ts-check
import { defineConfig } from 'astro/config';

// The site is served from its own domain at the root (see public/CNAME), so
// there is no base path.
//
// Careful with `base`: it only rewrites the links Astro generates — it does NOT
// nest the build output. So while the site lived at
// https://<owner>.github.io/book-club/ the two lined up, but on a root domain a
// base of "/book-club" points every internal link at a directory that does not
// exist, and every page 404s even though the files are there.
//
// If you ever move back to a <owner>.github.io/<repo>/ URL, set
// `base: '/<repo>'` here — that one really is served from a sub-path.

// https://docs.astro.build/en/reference/configuration-reference/
export default defineConfig({
  site: 'https://book-club.space',
  trailingSlash: 'ignore',
});
