import assert from 'node:assert/strict';
import test from 'node:test';
import { serializeBooks } from './lib/parse.mjs';

test('serializes originalTitle only when present', () => {
  const withTitle = JSON.parse(serializeBooks([{
    title: 'Polski tytuł', author: 'Autor', originalTitle: 'Original title', scores: {}, categories: [], description: null,
  }]));
  assert.equal(withTitle[0].originalTitle, 'Original title');

  const withoutTitle = serializeBooks([{ title: 'Bez tytułu', author: 'Autor', scores: {} }]);
  assert.equal(Object.hasOwn(JSON.parse(withoutTitle)[0], 'originalTitle'), false);
});
