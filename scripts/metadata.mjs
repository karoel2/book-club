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
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
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

  for (const q of queries) {
    for (const lang of ['&langRestrict=pl', '']) {
      const url =
        `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}` +
        `&maxResults=5&printType=books&country=${country}${lang}${key ? `&key=${key}` : ''}`;
      let data;
      try {
        data = await getJson(url);
      } catch {
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
export async function fetchMetadata(title, author) {
  let g = null;
  let o = null;
  try {
    g = await fromGoogle(title, author);
  } catch {
    /* ignore */
  }
  try {
    o = await fromOpenLibrary(title, author);
  } catch {
    /* ignore */
  }
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
 * Try each cover URL, keep the largest valid image (a proxy for resolution),
 * and write it to `${destNoExt}.<ext>`. Skips tiny blank placeholders.
 * Returns the written path, or null if none worked.
 */
export async function downloadBestCover(coverUrls, destNoExt) {
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
  if (!best) return null;
  const dest = `${destNoExt}.${best.ext}`;
  writeFileSync(dest, best.buf);
  return dest;
}
