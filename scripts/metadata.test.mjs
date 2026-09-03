import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchMetadataWithFallback, resolveHeader } from './metadata.mjs';

const primaryTitle = "Pierwszych piętnaście żywotów Harry'ego Augusta";
const originalTitle = 'Reincarnation';

function googleItem(title, categories, description = null) {
  return { volumeInfo: { title, authors: ['C. North'], categories, description, imageLinks: { large: `https://example.test/${encodeURIComponent(title)}.jpg` } } };
}

test('uses original title categories without importing its description', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    if (String(url).includes('googleapis.com')) {
      const isOriginal = String(url).includes(encodeURIComponent(originalTitle));
      return Response.json({ items: [googleItem(isOriginal ? originalTitle : primaryTitle, isOriginal ? ['Fiction', 'Time travel', 'End of the world'] : [], isOriginal ? 'English blurb' : null)] });
    }
    return Response.json({ numFound: 0, docs: [] });
  };

  try {
    const result = await fetchMetadataWithFallback(primaryTitle, 'C. North', originalTitle);
    assert.deepEqual(result.categories, ['Fiction', 'Time travel', 'End of the world']);
    assert.equal(result.description, null);
    assert.equal(result.fallbackUsed, true);
    assert.equal(result.fallbackOutcome, 'success');
    assert.ok(result.coverUrls.some((url) => url.includes(encodeURIComponent(originalTitle))));
    assert.equal(requests.filter((url) => url.includes('googleapis.com') && url.includes(encodeURIComponent(originalTitle))).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Google silent, Open Library answering: exercises the accept()/resolveHeader
// path that decides an ambiguous "A, B" header.
async function withStubbedApis({ google = () => Response.json({ items: [] }), docs = [] }, fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('googleapis.com')) return google();
    if (u.includes('openlibrary.org/search.json')) return Response.json({ numFound: docs.length, docs });
    return Response.json({});
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('a two-letter surname does not match inside a longer name', async () => {
  // "We, Yevgeny Zamyatin" reversed asks for the surname "We", which a substring
  // test finds in "Wells" — and hands the header to a book *about* the novel.
  const docs = [
    { title: 'WE, Yevgeny Zamyatin and a Modern Utopia, H. G. Wells (2 Books)', author_name: ['Евгений Иванович Замятин', 'H. G. Wells'] },
  ];
  const hit = await withStubbedApis({ docs }, () =>
    resolveHeader([
      { title: 'We', author: 'Yevgeny Zamyatin' },
      { title: 'Yevgeny Zamyatin', author: 'We' },
    ]),
  );
  assert.equal(hit, null);
});

test('a short surname still matches as a whole word', async () => {
  const docs = [{ title: 'Problem trzech ciał', author_name: ['Cixin Liu'] }];
  const hit = await withStubbedApis({ docs }, () =>
    resolveHeader([{ title: 'Problem trzech ciał', author: 'Cixin Liu' }]),
  );
  assert.equal(hit?.title, 'Problem trzech ciał');
});

test('an inflected long surname still matches', async () => {
  const docs = [{ title: 'Rok 1984', author_name: ['George Orwella'] }];
  const hit = await withStubbedApis({ docs }, () =>
    resolveHeader([{ title: 'Rok 1984', author: 'George Orwell' }]),
  );
  assert.equal(hit?.title, 'Rok 1984');
});

test('a quota day is reported as unchecked, not as an unknown book', async () => {
  // Google 429 for every query and Open Library empty: the gate never actually
  // asked. Returning null here reads to the caller as "this is not a book".
  const google = () => new Response('quota', { status: 429 });
  await assert.rejects(
    () => withStubbedApis({ google, docs: [] }, () => resolveHeader([{ title: 'Chłopki', author: 'Joanna Kuciel-Frydryszak' }])),
    (e) => e.quota === true,
  );
});

test('a confirmed reading wins even when a later one would hit the quota', async () => {
  const docs = [{ title: 'Rok 1984', author_name: ['George Orwell'] }];
  const google = () => new Response('quota', { status: 429 });
  const hit = await withStubbedApis({ google, docs }, () =>
    resolveHeader([{ title: 'Rok 1984', author: 'George Orwell' }]),
  );
  assert.equal(hit?.title, 'Rok 1984');
});

test('skips fallback when original title is absent or equal to stored title', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return Response.json({ numFound: 0, docs: [] });
  };
  try {
    await fetchMetadataWithFallback('Same title', 'Author', 'Same title');
    await fetchMetadataWithFallback('No original', 'Author', null);
    assert.equal(requests.some((url) => url.includes('Same%20title') && url.includes('No%20original')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
