// node --test scripts/lib/parse.test.mjs
// Header splitting only — no network. The database lookup that picks between
// ambiguous candidates lives in metadata.mjs (resolveHeader).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitTitleAuthor, applyHeaderResolution } from './parse.mjs';

const cand = (h) => splitTitleAuthor(h).candidates.map((c) => `${c.title}|${c.author ?? ''}`);

test('an initial on one side decides it outright, no candidates needed', () => {
  const r = splitTitleAuthor(['Wiedźmin, A. Sapkowski']);
  assert.equal(r.title, 'Wiedźmin');
  assert.equal(r.author, 'A. Sapkowski');
  assert.equal(r.ambiguous, false);
});

test('reversed order still resolves from the initial', () => {
  const r = splitTitleAuthor(['S. King, Worek Kości']);
  assert.equal(r.title, 'Worek Kości');
  assert.equal(r.author, 'S. King');
  assert.equal(r.ambiguous, false);
});

test('a comma inside the title keeps the author, because every comma is tried', () => {
  const r = splitTitleAuthor(['Dziki, mroczny brzeg, C. McConaghy']);
  assert.equal(r.title, 'Dziki, mroczny brzeg');
  assert.equal(r.author, 'C. McConaghy');
  assert.equal(r.ambiguous, false);
});

test('a bare personal name against prose decides it with no lookup', () => {
  const r = splitTitleAuthor(['Kiedy żurawie odlatują na południe, Lisa Ridzen']);
  assert.equal(r.title, 'Kiedy żurawie odlatują na południe');
  assert.equal(r.author, 'Lisa Ridzen');
  assert.equal(r.ambiguous, false, 'must not need the rate-limited database');
});

test('…and in the other order too', () => {
  const r = splitTitleAuthor(['Lisa Ridzen, Kiedy żurawie odlatują na południe']);
  assert.equal(r.title, 'Kiedy żurawie odlatują na południe');
  assert.equal(r.author, 'Lisa Ridzen');
});

test('two capitalised sides stay ambiguous rather than guess', () => {
  // "Zielona Mila" is as name-shaped as "King" is; guessing would publish a
  // wrong title, so this must fall through to the database.
  assert.equal(splitTitleAuthor(['Zielona Mila, King']).ambiguous, true);
  assert.equal(splitTitleAuthor(['Wyznania, Kanae Minato']).ambiguous, true);
});

test('ambiguous headers still offer both readings', () => {
  const c = cand(['Wyznania, Kanae Minato']);
  assert.equal(c[0], 'Wyznania|Kanae Minato');
  assert.ok(c.includes('Kanae Minato|Wyznania'));
});

test('the whole header as a title is always the last resort', () => {
  const c = cand(['Wyznania, Kanae Minato']);
  assert.equal(c.at(-1), 'Wyznania, Kanae Minato|');
});

test('a comma-bearing title with no author can still resolve to itself', () => {
  // Two commas: the fallback is what rescues this one.
  const c = cand(['Dziki, mroczny brzeg']);
  assert.ok(c.includes('Dziki, mroczny brzeg|'), 'whole header must be a candidate');
});

test('later commas are tried after the last one', () => {
  const c = cand(['Alfa, Beta, Gamma']);
  assert.equal(c[0], 'Alfa, Beta|Gamma'); // last comma first
  assert.ok(c.includes('Alfa|Beta, Gamma')); // earlier comma still offered
});

test('single-letter fragments are not offered as titles', () => {
  // WORD_RE rejects OCR debris, so "X, Kowalski" yields no "X|…" reading.
  assert.ok(!cand(['X, Kowalski']).some((c) => c.startsWith('X|')));
});

test('candidates are deduped', () => {
  const c = cand(['Wyznania, Kanae Minato']);
  assert.equal(new Set(c).size, c.length);
});

test('applying a resolution re-slugs and retracts only the ambiguity note', () => {
  const p = {
    entry: { title: 'A, B', author: null, scores: {} },
    slug: 'a-b',
    notes: ['ambiguity note', 'unrelated note'],
    blocking: ['ambiguity note', 'unrelated note'],
    headerNotes: ['ambiguity note'],
    ambiguous: true,
  };
  applyHeaderResolution(p, { title: 'Real Title', author: 'Real Author' });
  assert.equal(p.entry.title, 'Real Title');
  assert.equal(p.entry.author, 'Real Author');
  assert.equal(p.slug, 'real-title', 'slug drives the duplicate check');
  assert.deepEqual(p.blocking, ['unrelated note'], 'unrelated blockers survive');
  assert.equal(p.ambiguous, false);
});
