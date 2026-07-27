/**
 * Best-effort book metadata: description, categories, and a cover image.
 *
 * Primary source  : Google Books   (rich Polish descriptions + categories)
 * Fallback / cover : Open Library   (higher-res covers by ISBN, subjects)
 *
 * Nothing here throws for "not found" — callers get partial data or null and
 * carry on. Set GOOGLE_BOOKS_API_KEY to raise Google's rate limit (optional).
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

// Loose title match so we don't attach the wrong book's blurb.
function titlesMatch(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const ta = new Set(na.split(' '));
  const tb = nb.split(' ');
  const overlap = tb.filter((w) => ta.has(w)).length;
  return overlap >= Math.max(1, Math.ceil(tb.length * 0.6));
}

async function fromGoogle(title, author) {
  const key = process.env.GOOGLE_BOOKS_API_KEY;
  const q = encodeURIComponent([title, authorSurname(author)].filter(Boolean).join(' '));
  const base = `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=5&printType=books${key ? `&key=${key}` : ''}`;
  for (const lang of ['&langRestrict=pl', '']) {
    let data;
    try {
      data = await getJson(base + lang);
    } catch {
      continue;
    }
    const items = data.items || [];
    const hit = items.find((it) => titlesMatch(it.volumeInfo?.title || '', title)) || items[0];
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
      description: vi.description ? stripHtml(vi.description) : null,
      categories: cleanCategories(vi.categories || []),
      isbn,
      coverUrls: cover ? [cover.replace(/^http:/, 'https:').replace(/&edge=curl/, '')] : [],
      source: 'Google Books',
    };
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
  const docs = data.docs || [];
  const hit = docs.find((d) => titlesMatch(d.title || '', title)) || docs[0];
  if (!hit) return null;

  let description = null;
  if (hit.key) {
    try {
      const work = await getJson(`https://openlibrary.org${hit.key}.json`);
      const d = work.description;
      description = typeof d === 'string' ? d : d?.value || null;
      if (description) description = stripHtml(description).replace(/\s*\(\[source\]\[\d+\]\).*$/s, '').trim();
    } catch {
      /* description is optional */
    }
  }
  const isbn = (hit.isbn || [])[0] || null;
  const coverUrls = [];
  if (hit.cover_i) coverUrls.push(`https://covers.openlibrary.org/b/id/${hit.cover_i}-L.jpg`);
  if (isbn) coverUrls.push(`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`);
  return {
    description,
    categories: cleanCategories(hit.subject || []),
    isbn,
    coverUrls,
    source: 'Open Library',
  };
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
