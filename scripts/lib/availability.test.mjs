import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalize,
  titleSimilarity,
  authorSimilarity,
  scoreMatch,
  formatAvailability,
  queryVariants,
  MATCH_THRESHOLD,
  PROVIDERS,
} from './availability.mjs';

// Only the matching maths is tested here — the five providers hit the live
// internet, and a test that fails when Audioteka is having a bad afternoon is
// worse than no test. `npm run next -- --dry-run "<tytuł>"` exercises those.

const matches = (qt, qa, rt, ra) => scoreMatch(qt, qa, rt, ra) >= MATCH_THRESHOLD;

test('normalises Polish spelling out of the comparison', () => {
  assert.equal(normalize('Problem trzech ciał'), 'problem trzech cial');
  assert.equal(normalize('Wiedźmin. Ostatnie życzenie'), 'wiedzmin ostatnie zyczenie');
});

test('a subtitle or series prefix still counts as the same title', () => {
  assert.ok(titleSimilarity('Wiedźmin', 'Wiedźmin. Ostatnie życzenie') >= 0.95);
  assert.ok(titleSimilarity('Achaja', 'Achaja. T. 2') >= 0.95);
  assert.ok(titleSimilarity('Problem trzech ciał', 'Problem trzech ciał') === 1);
  assert.ok(titleSimilarity('Problem trzech ciał', 'Kwiaty dla Algernona') < 0.5);
});

test('containment is whole words — "Achaja" is not "Wojna Rzymu z Achajami"', () => {
  assert.ok(titleSimilarity('Achaja', 'Wojna Rzymu z Achajami') < 0.5);
  assert.ok(!matches('Achaja', 'Ziemiański', 'Wojna Rzymu z Achajami', 'Adrian Goldsworthy'));
});

test('author names match whatever order or furniture they arrive in', () => {
  // Audioteka writes "Liu Cixin", Primo "Liu, Cixin (1963- ) Autor".
  assert.equal(authorSimilarity('Cixin Liu', 'Liu Cixin'), 1);
  assert.equal(authorSimilarity('Cixin Liu', 'Liu, Cixin (1963- ) Autor'), 1);
  assert.equal(authorSimilarity('S. Fitzek', 'Fitzek, Sebastian (1971- ) Autor'), 1);
  assert.equal(authorSimilarity('Cixin Liu', 'Stephen King'), 0);
});

test('an exact title by the right author clears the bar, wordy catalogue or not', () => {
  // Scored symmetrically this came to 0.82 and the library showed a red cross.
  assert.ok(matches('Mimika', 'S. Fitzek', 'Mimika', 'Fitzek, Sebastian (1971- ) Autor'));
});

test('query variants fall back through subtitle then first words', () => {
  assert.deepEqual(queryVariants('Wiedźmin. Ostatnie życzenie'), [
    'Wiedźmin Ostatnie życzenie',
    'Ostatnie życzenie',
  ]);
  // A one-word part is dropped: "Wiedźmin" alone would match any volume.
  assert.ok(!queryVariants('Wiedźmin. Ostatnie życzenie').includes('Wiedźmin'));
  assert.deepEqual(queryVariants('Problem trzech ciał'), ['Problem trzech ciał']);
  assert.ok(queryVariants('Pierwszych piętnaście żywotów Harrego Augusta').includes('Pierwszych piętnaście żywotów'));
});

test('the right title by the wrong author is not a match', () => {
  assert.ok(matches('Problem trzech ciał', 'Cixin Liu', 'Problem trzech ciał', 'Liu Cixin'));
  assert.ok(!matches('Problem trzech ciał', 'Cixin Liu', 'Problem trzech ciał', 'Remigiusz Mróz'));
});

test('with no author on either side, the title decides alone', () => {
  assert.ok(matches('Achaja', null, 'Achaja', null));
  assert.ok(matches('Achaja', 'Ziemiański', 'Achaja', ''));
  assert.ok(!matches('Achaja', null, 'Bezprawie', null));
});

test('unknown reads as "?", not as "no"', () => {
  const line = formatAvailability({
    storytel: { available: true },
    bookbeat: { available: false },
    legimi: { available: null }, // e.g. its bootstrap state carried no api key
    // audioteka and the library missing entirely — never asked
  });
  assert.equal(line, 'Storytel ✅ · BookBeat ❌ · Audioteka ❔ · Legimi ❔ · B. Raczyńskich ❔');
});

test('every provider offers a search page a human can open', () => {
  for (const p of PROVIDERS) {
    const url = p.searchUrl('Problem trzech ciał', 'Cixin Liu');
    assert.match(url, /^https:\/\//, `${p.id} search url`);
    assert.doesNotMatch(url, /\s/, `${p.id} search url is escaped`);
  }
});
