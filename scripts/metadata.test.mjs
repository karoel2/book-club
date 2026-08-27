import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchMetadataWithFallback } from './metadata.mjs';

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
