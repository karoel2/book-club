/**
 * Prefix an internal path with Astro's configured base path so links work
 * whether the site is served from the domain root (custom domain, user site,
 * or local dev) or from a project sub-path like /book-club/ (GitHub Pages).
 */
export function url(path = '/'): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  if (path === '/' || path === '') return base + '/';
  return base + '/' + path.replace(/^\//, '');
}
