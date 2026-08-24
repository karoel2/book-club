/**
 * Where can the club get the next book? One check per service, all run in
 * parallel, no dependencies beyond `fetch` — so the same module serves the CLI
 * (`scripts/next-book.mjs`) and the serverless function (copied into
 * `azure/src/shared/` by `npm run sync`).
 *
 * Every check is best-effort and returns one of three answers:
 *
 *   available: true   confirmed — a matching edition is in the catalogue
 *   available: false  searched, nothing matched
 *   available: null   couldn't tell (site down, layout changed, no usable API)
 *
 * The third one matters. A scraper that quietly reports "no" when it is really
 * "don't know" is worse than useless: the site then states, in green and red,
 * something nobody checked. `null` renders as a neutral "?" instead.
 *
 * Provider ids are the contract with the site (`src/data/next-meeting.json` and
 * the labels/icons in `src/data/next-meeting.ts`) — don't rename one without the
 * other.
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TIMEOUT_MS = 12000;

/** Combined title+author score above which we call it a match. */
export const MATCH_THRESHOLD = 0.85;

/* --------------------------- string matching --------------------------- */

const PL_DIACRITICS = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };

/** Lowercase, strip Polish diacritics and punctuation, collapse whitespace. */
export function normalize(text) {
  if (!text) return '';
  return String(text)
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (ch) => PL_DIACRITICS[ch] ?? ch)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,!?;:"'’„”()[\]{}\/–—-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(s) {
  const out = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}

/** Sørensen–Dice coefficient over character bigrams: 0…1. */
function dice(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const ga = bigrams(a);
  const gb = bigrams(b);
  let shared = 0;
  let total = 0;
  for (const n of ga.values()) total += n;
  for (const [g, n] of gb) {
    total += n;
    shared += Math.min(n, ga.get(g) || 0);
  }
  return (2 * shared) / total;
}

/**
 * Titles differ by subtitle and series more often than by spelling: a search
 * for "Wiedźmin" should recognise "Wiedźmin. Ostatnie życzenie". So whole-phrase
 * containment counts as a near-match, and Dice handles the rest.
 *
 * Containment is measured in whole words. As a plain substring test, "Achaja"
 * sits inside "Wojna Rzymu z Achajami" — which is a different book by a
 * different author, and scored 0.95 against the one we wanted.
 */
export function titleSimilarity(query, candidate) {
  const a = normalize(query);
  const b = normalize(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const contains = (haystack, needle) => ` ${haystack} `.includes(` ${needle} `);
  if (contains(b, a) || contains(a, b)) return 0.95;
  return dice(a, b);
}

/**
 * Author names arrive in every order and dressed in catalogue furniture —
 * "Cixin Liu", "Liu Cixin", "Liu, Cixin (1963- ) Autor". Compare word sets so
 * that order stops mattering, and score by how much of *our* name the candidate
 * accounts for, not how much they share.
 *
 * The asymmetry is the point. Judged symmetrically, "S. Fitzek" against
 * "Fitzek, Sebastian (1971- ) Autor" scores 0.4 purely because the catalogue is
 * wordier, which dragged an exact title match below the threshold. One-letter
 * tokens drop out, so an initial neither helps nor hurts.
 */
export function authorSimilarity(query, candidate) {
  const words = (s) => new Set(normalize(s).split(' ').filter((t) => t.length > 1));
  const a = words(query);
  const b = words(candidate);
  if (!a.size || !b.size) return 0;
  let found = 0;
  for (const t of a) if (b.has(t)) found += 1;
  return found / a.size;
}

/**
 * How well a catalogue hit answers the query. The author is a third of the
 * score — enough to reject the right title by the wrong writer, not so much
 * that a catalogue which omits authors can never match.
 */
export function scoreMatch(qTitle, qAuthor, rTitle, rAuthor) {
  const t = titleSimilarity(qTitle, rTitle);
  if (!qAuthor || !rAuthor) return t;
  return 0.7 * t + 0.3 * authorSimilarity(qAuthor, rAuthor);
}

/** Best-scoring candidate, or null. `items` are `{ title, author, url }`. */
function bestMatch(items, title, author) {
  let best = null;
  for (const item of items) {
    const confidence = scoreMatch(title, author, item.title, item.author);
    if (!best || confidence > best.confidence) best = { ...item, confidence };
  }
  return best;
}

/* ------------------------------ fetching ------------------------------- */

// Five services queried at once, several of them with rate limits: a 502 or a
// dropped connection on the first try is common and almost always transient.
// One retry turns most of those back into a real answer instead of a "?".
async function get(url, { accept = 'application/json', headers = {}, attempt = 1 } = {}) {
  const opts = { accept, headers };
  let res;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.8', ...headers },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    if (attempt > 1) throw e;
    await sleep(700);
    return get(url, { ...opts, attempt: attempt + 1 });
  }
  if (res.status >= 500 && attempt === 1) {
    await sleep(700);
    return get(url, { ...opts, attempt: attempt + 1 });
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return accept.includes('json') ? res.json() : res.text();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const q = (s) => encodeURIComponent(s);

/**
 * What to type into the search box.
 *
 * Title only — never the author. Every one of these engines ANDs its terms
 * against the title field alone, so "Bezprawie Mróz" and "Problem trzech ciał
 * Cixin Liu" both return nothing at all while the bare title returns the book.
 * The author still decides the match; it just does so here, after the search.
 *
 * Punctuation goes too ("Wiedźmin. Ostatnie życzenie" finds nothing, without
 * the dot it works).
 *
 * Then two fallbacks, tried only if the full title found nothing, because
 * catalogues rarely agree on how much of a series belongs in the title. Legimi
 * files the same book as plain "Ostatnie życzenie", Storytel as "Wiedźmin":
 *
 *   1. each part around a subtitle separator, longest first — but never a
 *      one-word part, which would match any volume of the series;
 *   2. the first three words of a long title.
 */
export function queryVariants(title) {
  const strip = (s) => s.replace(/[.,:;!?„”"'()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  const raw = String(title || '');
  const clean = strip(raw);
  const variants = [clean];

  const parts = raw
    .split(/[.:–—]/)
    .map(strip)
    .filter((p) => p.split(' ').length >= 2)
    .sort((a, b) => b.length - a.length);
  variants.push(...parts);

  const words = clean.split(' ');
  if (words.length > 3) variants.push(words.slice(0, 3).join(' '));

  return [...new Set(variants.filter(Boolean))];
}

/** Run `search` over the query variants, stopping at the first one with hits. */
async function searchVariants(title, search) {
  for (const variant of queryVariants(title)) {
    const items = await search(variant);
    if (items.length) return items;
  }
  return [];
}

/* ------------------------------ providers ------------------------------ */

/**
 * Each provider exposes `label`, `searchUrl(title)` — always a valid page a
 * human can open — and `check()`, which resolves to
 * `{ available, url, matched, matchedAuthor, confidence }` or throws (the
 * caller turns a throw into `available: null`).
 */
export const PROVIDERS = [
  {
    id: 'storytel',
    label: 'Storytel',
    searchUrl: (t) => `https://www.storytel.com/pl/search-${q(queryVariants(t)[0])}`,
    // Public search API behind the web player. `abook` is the audiobook format;
    // an ebook-only hit is not what the club is asking about.
    async check(title, author) {
      const items = await searchVariants(title, async (term) => {
        const data = await get(
          `https://api.storytel.net/search/client/web?query=${q(term)}&limit=20&offset=0&country=pl&store=STHP-PL`,
        );
        return (data.items || [])
          .filter((it) => it.title)
          .map((it) => ({
            title: it.title,
            author: (it.authors || []).map((x) => x.name).join(', '),
            url: it.id ? `https://www.storytel.com/pl/books/${it.id}` : null,
            isAudio: (it.formats || []).some((f) => f.type === 'abook' && f.isReleased !== false),
          }));
      });
      const best = bestMatch(items, title, author);
      return {
        available: !!best && best.confidence >= MATCH_THRESHOLD && best.isAudio,
        url: best?.url,
        matched: best?.title,
        matchedAuthor: best?.author,
        confidence: best?.confidence ?? 0,
      };
    },
  },
  {
    id: 'bookbeat',
    label: 'BookBeat',
    searchUrl: (t) => `https://www.bookbeat.com/pl/search?query=${q(queryVariants(t)[0])}`,
    // market=48 is BookBeat's Polish store. `audiobookisbn` is the tell that the
    // hit has an audio edition and not only an ebook one.
    async check(title, author) {
      const items = await searchVariants(title, async (term) => {
        const data = await get(`https://api.bookbeat.com/api/search/books?query=${q(term)}&market=48&limit=20`);
        return (data?._embedded?.books || [])
          .filter((b) => b.title)
          .map((b) => ({
            title: b.title,
            author: b.author,
            url: b.shareurl || (b.id ? `https://www.bookbeat.com/pl/book/${b.id}` : null),
            isAudio: !!b.audiobookisbn,
          }));
      });
      const best = bestMatch(items, title, author);
      return {
        available: !!best && best.confidence >= MATCH_THRESHOLD && best.isAudio,
        url: best?.url,
        matched: best?.title,
        matchedAuthor: best?.author,
        confidence: best?.confidence ?? 0,
      };
    },
  },
  {
    id: 'audioteka',
    label: 'Audioteka',
    searchUrl: (t) => `https://audioteka.com/pl/szukaj/?phrase=${q(queryVariants(t)[0])}`,
    // No public API, but the search page is server-rendered, so the results are
    // in the HTML. Class names are hashed per build (`teaser_title__hDeCG`), so
    // match the stable prefix and never the whole name.
    async check(title, author) {
      const items = await searchVariants(title, async (term) => {
        const html = await get(`https://audioteka.com/pl/szukaj/?phrase=${q(term)}`, { accept: 'text/html' });
        const found = [];
        for (const chunk of html.split('<li class="teaser').slice(1)) {
          const href = chunk.match(/href="(\/pl\/audiobook\/[^"]+)"/)?.[1];
          const t = chunk.match(/class="teaser_title[^"]*"[^>]*>([^<]+)</)?.[1];
          const a = chunk.match(/class="teaser_author[^"]*"[^>]*>([^<]+)</)?.[1];
          if (!href || !t) continue;
          found.push({
            title: decodeEntities(t),
            author: decodeEntities(a || ''),
            url: `https://audioteka.com${href}`,
          });
        }
        return found;
      });
      const best = bestMatch(items, title, author);
      return {
        available: !!best && best.confidence >= MATCH_THRESHOLD,
        url: best?.url,
        matched: best?.title,
        matchedAuthor: best?.author,
        confidence: best?.confidence ?? 0,
      };
    },
  },
  {
    id: 'legimi',
    label: 'Legimi',
    searchUrl: (t) => `https://www.legimi.pl/ebooki/?searchPhrase=${q(queryVariants(t)[0])}&format=unlimited_audio`,
    // Legimi renders its result list in the browser — the server sends the page
    // shell and the filter chips, with `bookList.books` empty — so there is
    // nothing to scrape. It does hydrate from a JSON catalogue API, which is
    // what we call instead. See legimiConfig for where the credentials come from.
    async check(title, author) {
      const { apiUrl, apiKey } = await legimiConfig();
      const items = await searchVariants(title, async (term) => {
        const data = await get(`${apiUrl}catalogue?searchphrase=${q(term)}&filters=["audiobooks"]`, {
          headers: { Authorization: `Basic ${apiKey}`, 'Content-Type': 'application/json' },
        });
        return (data?.bookList?.books || [])
          .filter((b) => b.title)
          .map((b) => ({
            title: b.title,
            author: (b.authors || []).map((a) => a.name).join(', '),
            url: b.url ? `https://www.legimi.pl${b.url}` : null,
            // `filters=["audiobooks"]` already narrows the search, but a hit can
            // still come back as the ebook edition of the same work.
            isAudio: b.audiobookFormat === true && b.isAvailable !== false,
          }));
      });
      const best = bestMatch(items, title, author);
      return {
        available: !!best && best.confidence >= MATCH_THRESHOLD && best.isAudio,
        url: best?.url,
        matched: best?.title,
        matchedAuthor: best?.author,
        confidence: best?.confidence ?? 0,
      };
    },
  },
  {
    id: 'biblioteka_raczynskich',
    label: 'B. Raczyńskich',
    searchUrl: (t) =>
      `https://omnis-br.primo.exlibrisgroup.com/discovery/search?query=any,contains,${q(t)}` +
      '&tab=LibraryCatalog&search_scope=MyInstitution2&vid=48OMNIS_BRP:BRACZ&offset=0',
    // Ex Libris Primo VE, the catalogue behind the library's search page. Unlike
    // the audiobook services this one answers about a physical copy, so it also
    // has to be on a shelf right now — `available_in_library`.
    async check(title, author) {
      const items = await searchVariants(title, async (term) => {
        const data = await get(
          'https://omnis-br.primo.exlibrisgroup.com/primaws/rest/pub/pnxs' +
            `?vid=${q('48OMNIS_BRP:BRACZ')}&q=${q(`any,contains,${term}`)}&limit=20`,
        );
        return (data.docs || []).map((doc) => {
          const display = doc.pnx?.display || {};
          // Catalogue titles carry the statement of responsibility:
          // "Problem trzech ciał / Cixin Liu ; przełożył Andrzej Jankowski."
          const [rawTitle] = String(display.title?.[0] || '').split(' / ');
          return {
            title: rawTitle.trim(),
            author: String(display.creator?.[0] || display.contributor?.[0] || '').split('$$')[0],
            url: this.searchUrl(rawTitle.trim()),
            onShelf:
              (doc.delivery?.availability || []).includes('available_in_library') ||
              doc.delivery?.bestlocation?.availabilityStatus === 'available',
            isBook: !String(display.type?.[0] || '').match(/audio|video|journal|score/i),
          };
        });
      });
      const best = bestMatch(items, title, author);
      return {
        available: !!best && best.confidence >= MATCH_THRESHOLD && best.isBook && best.onShelf,
        url: best?.url,
        matched: best?.title,
        matchedAuthor: best?.author,
        confidence: best?.confidence ?? 0,
      };
    },
  },
];

/**
 * Legimi's API base and client credential, read out of the page rather than
 * hard-coded.
 *
 * Every legimi.pl page embeds the state its React app boots from, including the
 * `Basic` key the app then uses for its own catalogue calls — the same
 * anonymous, public credential every visitor's browser gets. Reading it at run
 * time keeps it out of this repo and means a rotated key fixes itself; if the
 * page ever stops carrying one, the check reports "?" rather than guessing.
 *
 * Fetched once per process: a run checks one book, and the key doesn't change
 * between five parallel requests.
 */
let legimiConfigPromise = null;
function legimiConfig() {
  legimiConfigPromise ??= (async () => {
    const html = await get('https://www.legimi.pl/ebooki/', { accept: 'text/html' });
    const raw = html.match(/window\["initialReduxState"\]\s*=\s*JSON\.parse\("([\s\S]*?)"\);?<\/script>/)?.[1];
    if (!raw) throw new Error('legimi: no bootstrap state in the page');
    const { apiUrl, apiKey } = JSON.parse(JSON.parse(`"${raw}"`)).configData || {};
    if (!apiUrl || !apiKey) throw new Error('legimi: no api credentials in the page');
    return { apiUrl, apiKey };
  })();
  return legimiConfigPromise;
}

// The five entities that actually turn up in Polish catalogue markup.
function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim();
}

/* ------------------------------- public -------------------------------- */

/**
 * Ask every service about one book, in parallel.
 *
 * Never rejects: a provider that throws or times out comes back as
 * `available: null` with its error, because one flaky site must not cost us the
 * other four answers. Returns an object keyed by provider id, each entry
 * `{ available, url, matched, confidence, note?, error? }`, with `url` always
 * pointing somewhere useful — the exact edition when we found one, the search
 * page otherwise.
 */
export async function checkAvailability(title, author = null) {
  const settled = await Promise.allSettled(
    PROVIDERS.map(async (p) => ({ id: p.id, ...(await p.check(title, author)) })),
  );

  const out = {};
  settled.forEach((res, i) => {
    const p = PROVIDERS[i];
    const search = p.searchUrl(title, author);
    if (res.status === 'rejected') {
      out[p.id] = { available: null, url: search, error: String(res.reason?.message || res.reason) };
      return;
    }
    const { id, url, ...rest } = res.value;
    out[p.id] = { ...rest, url: url || search };
  });
  return out;
}

/** One line per service for the confirmation email: "Storytel ✅ · Legimi ❔". */
export function formatAvailability(results) {
  return PROVIDERS.map(({ id, label }) => {
    const r = results[id] || {};
    const mark = r.available === true ? '✅' : r.available === false ? '❌' : '❔';
    return `${label} ${mark}`;
  }).join(' · ');
}
