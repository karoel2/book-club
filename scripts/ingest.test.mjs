import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const ingestSource = await readFile(new URL('./ingest.mjs', import.meta.url), 'utf8');

test('protects existing categories and covers unless force is enabled', () => {
  assert.match(ingestSource, /force \|\| !\(entry\.categories && entry\.categories\.length\)/);
  assert.match(ingestSource, /force \|\| !coverExists/);
  assert.match(ingestSource, /if \(force && coverExists\) removeCover\(slug\)/);
});

test('reports fallback title and outcome in Polish', () => {
  assert.match(ingestSource, /oryginalny tytuł/);
  assert.match(ingestSource, /zapożyczono dane/);
  assert.match(ingestSource, /nie znaleziono danych/);
});

test('never assigns fallback metadata description directly', () => {
  assert.doesNotMatch(ingestSource, /fallbackResult\.description/);
  assert.match(ingestSource, /fetchMetadataWithFallback\(entry\.title, entry\.author, entry\.originalTitle/);
});
