/**
 * Best-effort book metadata: description, categories, and a cover image.
 *
 * Primary source  : Google Books   (rich Polish descriptions + categories)
 * Fallback / cover : Open Library   (higher-res covers by ISBN, subjects)
 *
 * Matching is deliberately strict: we only accept a result when the author
 * matches (or, when the book has no author, when the title matches closely),
 * so a wrong book's blurb is never attached. A miss leaves the field blank for
 * you to fill in by hand.
 *
 * Env: GOOGLE_BOOKS_API_KEY (optional, raises the limit),
 *      GOOGLE_BOOKS_COUNTRY (default "PL"; the volumes endpoint requires it).
 */
import { writeFileSync } from 'node:fs';

const UA = 'book-club-ingest/1.0 (personal book-club site)';

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) {
    const err = new Error(`HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

function stripHtml(s = '') {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r?\n+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n /g, '\n')
    .trim();
}

// Strip HTML plus the junk crowd-sourced descriptions often carry: inline
// markdown links, reference-style footnotes, and bare URLs (e.g. Open Library's
// "[... PDF](spam-url)" trailers).
function cleanDescription(s = '') {
  return stripHtml(s)
    .replace(/\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/^\s*\[\d+\]:\s*\S+.*$/gm, '')
    .replace(/\bhttps?:\/\/\S+/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanCategories(cats = []) {
  const out = [];
  for (const c of cats) {
    for (const part of String(c).split('/')) {
      const t = part.trim();
      if (t && t.length <= 40 && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
    }
  }
  return out.slice(0, 4);
}

function authorSurname(author) {
  if (!author) return '';
  const parts = author.replace(/\./g, ' ').split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] || '';
}

function norm(s = '') {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenOverlap(a, b) {
  const ta = a.split(' ').filter(Boolean);
  const sb = new Set(b.split(' ').filter(Boolean));
  if (!ta.length) return 0;
  return ta.filter((t) => sb.has(t)).length / ta.length;
}

// Accept a candidate only when we're reasonably sure it's the same book.
function accept(qTitle, qAuthor, resTitle, resAuthors) {
  const nt = norm(qTitle);
  const nr = norm(resTitle);
  if (!nt || !nr) return false;
  const titleClose = nt === nr || nr.includes(nt) || nt.includes(nr);
  const overlap = tokenOverlap(nt, nr);
  if (qAuthor) {
    const sur = norm(authorSurname(qAuthor));
    const authorMatch = sur.length > 1 && (resAuthors || []).some((a) => norm(a).includes(sur));
    return authorMatch && (titleClose || overlap >= 0.5);
  }
  // No author to disambiguate on — demand a strong title match.
  return titleClose || overlap >= 0.8;
}

async function fromGoogle(title, author) {
  const key = process.env.GOOGLE_BOOKS_API_KEY;
  const country = process.env.GOOGLE_BOOKS_COUNTRY || 'PL';
  const surname = authorSurname(author);
  const T = title.replace(/"/g, '');
  const S = surname.replace(/"/g, '');

  const queries = [];
  if (surname) queries.push(`intitle:"${T}" inauthor:"${S}"`);
  queries.push(`intitle:"${T}"`);
  queries.push([title, surname].filter(Boolean).join(' '));

  // The anonymous daily quota is easy to hit and answers 429 to *every* query —
  // remember it so "no metadata" isn't reported as "wrong title/author".
  let quotaHit = false;

  for (const q of queries) {
    for (const lang of ['&langRestrict=pl', '']) {
      const url =
        `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}` +
        `&maxResults=5&printType=books&country=${country}${lang}${key ? `&key=${key}` : ''}`;
      let data;
      try {
        data = await getJson(url);
      } catch (e) {
        if (e.status === 429 || e.status === 403) quotaHit = true;
        continue;
      }
      const items = data.items || [];
      const hit = items.find((it) => accept(title, author, it.volumeInfo?.title || '', it.volumeInfo?.authors));
      if (!hit) continue;
      const vi = hit.volumeInfo || {};
      const ids = vi.industryIdentifiers || [];
      const isbn =
        ids.find((i) => i.type === 'ISBN_13')?.identifier ||
        ids.find((i) => i.type === 'ISBN_10')?.identifier ||
        null;
      const img = vi.imageLinks || {};
      const cover = img.extraLarge || img.large || img.medium || img.small || img.thumbnail || img.smallThumbnail;
      return {
        description: vi.description ? cleanDescription(vi.description) : null,
        categories: cleanCategories(vi.categories || []),
        isbn,
        coverUrls: cover ? [cover.replace(/^http:/, 'https:').replace(/&edge=curl/, '')] : [],
        source: 'Google Books',
      };
    }
  }
  if (quotaHit) {
    const err = new Error(
      'Google Books: wyczerpany dzienny limit zapytań (HTTP 429) — ustaw GOOGLE_BOOKS_API_KEY albo spróbuj jutro',
    );
    err.quota = true;
    throw err;
  }
  return null;
}

async function fromOpenLibrary(title, author) {
  const q = encodeURIComponent([title, author].filter(Boolean).join(' '));
  let data;
  try {
    data = await getJson(
      `https://openlibrary.org/search.json?q=${q}&fields=title,author_name,subject,isbn,cover_i,key&limit=5`,
    );
  } catch {
    return null;
  }
  const hit = (data.docs || []).find((d) => accept(title, author, d.title || '', d.author_name));
  if (!hit) return null;

  let description = null;
  if (hit.key) {
    try {
      const work = await getJson(`https://openlibrary.org${hit.key}.json`);
      const d = work.description;
      description = typeof d === 'string' ? d : d?.value || null;
      if (description) description = cleanDescription(description);
    } catch {
      /* description is optional */
    }
  }
  const isbn = (hit.isbn || [])[0] || null;
  const coverUrls = [];
  if (hit.cover_i) coverUrls.push(`https://covers.openlibrary.org/b/id/${hit.cover_i}-L.jpg`);
  if (isbn) coverUrls.push(`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`);
  return { description, categories: cleanCategories(hit.subject || []), isbn, coverUrls, source: 'Open Library' };
}

/** Merge Google Books (preferred for text) with Open Library (covers/fallback). */
export async function fetchMetadata(title, author, { reportErrors = false } = {}) {
  let g = null;
  let o = null;
  let googleErr = null;
  let openLibraryErr = null;
  try {
    g = await fromGoogle(title, author);
  } catch (e) {
    googleErr = e;
  }
  try {
    o = await fromOpenLibrary(title, author);
  } catch (error) {
    openLibraryErr = error;
    /* ignore */
  }
  // Only surface the quota problem when Open Library couldn't cover for it.
  if (!g && !o && googleErr?.quota) throw googleErr;
  if (!g && !o && reportErrors && (openLibraryErr || googleErr)) throw openLibraryErr || googleErr;
  if (!g && !o) return null;

  const description = g?.description || o?.description || null;
  const categories = (g?.categories?.length ? g.categories : o?.categories) || [];
  const isbn = g?.isbn || o?.isbn || null;

  const coverUrls = [];
  for (const r of [g, o]) if (r) for (const u of r.coverUrls) if (!coverUrls.includes(u)) coverUrls.push(u);
  if (isbn) {
    const iu = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`;
    if (!coverUrls.includes(iu)) coverUrls.push(iu);
  }

  const sources = [g && 'Google Books', o && 'Open Library'].filter(Boolean);
  return { description, categories, isbn, coverUrls, sources };
}

/**
 * Decide an ambiguous "A, B" header by asking the book databases which reading
 * actually exists. Candidates come from parse.mjs ranked best-first; the first
 * one that returns metadata wins, because fetchMetadata only answers when the
 * author (or, author-less, a strong title match) genuinely matches.
 *
 * Returns `{ title, author, meta }` or null. The metadata is handed back so the
 * caller can enrich from it instead of fetching the same book twice.
 *
 * `limit` caps the lookups: each candidate costs up to two API calls, and Google
 * Books is rate-limited without a key.
 */
export async function resolveHeader(candidates, { limit = 5 } = {}) {
  for (const c of (candidates || []).slice(0, limit)) {
    let meta = null;
    try {
      meta = await fetchMetadata(c.title, c.author);
    } catch {
      // fetchMetadata only throws when Google hit its quota *and* Open Library
      // had nothing. That says this reading is unknown, not that the next one
      // is — keep going, or a quota day would block every ambiguous header.
      continue;
    }
    if (meta) return { title: c.title, author: c.author, meta };
  }
  return null;
}

/**
 * Perform fallback metadata lookup using original title when primary lookup
 * yields insufficient categories or cover. Returns enhanced result with
 * fallback attribution and source information.
 */
export async function fetchMetadataWithFallback(primaryTitle, author, originalTitle, { hasUsableCover = false } = {}) {
  const fallbackTitle = typeof originalTitle === 'string' ? originalTitle.trim() : '';
  // Skip fallback if original title is same as primary or missing
  if (!fallbackTitle || fallbackTitle === primaryTitle) {
    return await fetchMetadata(primaryTitle, author);
  }

  // Get primary result first
  const primaryResult = await fetchMetadata(primaryTitle, author);
  const primary = primaryResult || { description: null, categories: [], isbn: null, coverUrls: [], sources: [] };

  // Check if fallback is needed (no categories or no usable cover)
  const needsCategories = !primaryResult?.categories?.length;
  const needsCover = !hasUsableCover && !primaryResult?.coverUrls?.length;

  if (!needsCategories && !needsCover) {
    return { ...primaryResult, fallbackUsed: false };
  }

  // Perform fallback lookup
  let fallbackResult = null;
  let fallbackError = null;
  try {
    fallbackResult = await fetchMetadata(fallbackTitle, author, { reportErrors: true });
  } catch (error) {
    fallbackError = error;
  }

  if (!fallbackResult && !fallbackError) {
    // Fallback found nothing
    return {
      ...primary,
      fallbackUsed: true,
      fallbackOutcome: 'empty',
      fallbackOriginalTitle: fallbackTitle
    };
  }

  if (fallbackError) {
    // Fallback failed
    return {
      ...primary,
      fallbackUsed: true,
      fallbackOutcome: 'failure',
      fallbackOriginalTitle: fallbackTitle,
      fallbackError: fallbackError.message
    };
  }

  // Merge results: categories from fallback if needed, cover URLs combined
  const mergedCategories = needsCategories && fallbackResult.categories?.length
    ? fallbackResult.categories
    : primaryResult?.categories || [];

  const mergedCoverUrls = [...(primaryResult?.coverUrls || [])];
  if (fallbackResult?.coverUrls) {
    for (const url of fallbackResult.coverUrls) {
      if (!mergedCoverUrls.includes(url)) {
        mergedCoverUrls.push(url);
      }
    }
  }

  // Always include ISBN from primary if available
  const mergedIsbn = primaryResult?.isbn || fallbackResult?.isbn || null;

  return {
    description: primaryResult?.description || null, // Never use fallback description
    categories: mergedCategories,
    isbn: mergedIsbn,
    coverUrls: mergedCoverUrls,
    sources: [...(primaryResult?.sources || []), ...(fallbackResult?.sources || [])].filter(Boolean),
    fallbackUsed: true,
    fallbackOutcome: 'success',
    fallbackOriginalTitle: fallbackTitle,
    fallbackSupplied: {
      categories: Boolean(needsCategories && fallbackResult.categories?.length),
      cover: Boolean(fallbackResult.coverUrls?.length)
    }
  };
}

/**
 * Try each cover URL and return the largest valid image (a proxy for
 * resolution) as `{ buf, ext }`, or null. Portable (no filesystem) — used by
 * both the CLI and the serverless function.
 */
export async function pickBestCover(coverUrls) {
  let best = null;
  for (const url of coverUrls) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } }); // fetch follows redirects
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const isJpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
      const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e;
      if ((!isJpg && !isPng) || buf.length < 3000) continue; // reject blanks/placeholders
      if (!best || buf.length > best.buf.length) best = { buf, ext: isPng ? 'png' : 'jpg' };
    } catch {
      /* try the next candidate */
    }
  }
  return best;
}

/**
 * CLI wrapper: pick the best cover and write it to `${destNoExt}.<ext>`.
 * Returns the written path, or null if none worked.
 */
export async function downloadBestCover(coverUrls, destNoExt) {
  const best = await pickBestCover(coverUrls);
  if (!best) return null;
  const dest = `${destNoExt}.${best.ext}`;
  writeFileSync(dest, best.buf);
  return dest;
}
