#!/usr/bin/env node
/**
 * Ingest a book-club screenshot into the website, with metadata enrichment.
 *
 *   1. OCR the image with the on-device Apple Vision engine (../ocr.swift)
 *   2. Parse it into one or more books: title/author + { member: score }
 *   3. Canonicalise member names against the roster (fixes OCR "ł -> t",
 *      e.g. Michat -> Michał, Pawet -> Paweł)
 *   4. Cross-check parsed scores against the average printed on the screenshot
 *   5. Enrich each new book with a description, categories and a cover image
 *      (Google Books + Open Library) — best effort, never blocks the add
 *   6. Append clean entries to src/data/books.json; anything uncertain is
 *      copied to inbox/review/ and is NOT published
 *   7. Optionally commit & push (which triggers the host to rebuild)
 *
 * Shared parsing lives in ./lib/parse.mjs (also used by the serverless function
 * in ../azure/). This file holds only the CLI/local-filesystem behaviour.
 *
 * Usage:
 *   node scripts/ingest.mjs [images...]   process given images (or scan inbox/)
 *   node scripts/ingest.mjs --dry-run img parse + preview metadata, change nothing
 *   node scripts/ingest.mjs --push        add + git commit + git push
 *   node scripts/ingest.mjs --backfill        enrich existing books that lack metadata
 *   node scripts/ingest.mjs --backfill "wied" enrich only books whose title matches
 *   node scripts/ingest.mjs --backfill --force  re-fetch even if data already present
 *   node scripts/ingest.mjs --no-enrich       skip the description/category/cover lookup
 *   node scripts/ingest.mjs --strict          send even advisory-flagged books to review/
 */

import {
  readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, renameSync, existsSync, unlinkSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename, extname } from 'node:path';
import { fetchMetadata, downloadBestCover, resolveHeader } from './metadata.mjs';
import { slugify, parseBlocks, finalizeBooks, buildRoster, serializeBooks, applyHeaderResolution } from './lib/parse.mjs';
import { fetchMetadataWithFallback } from './metadata.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATA = join(ROOT, 'src', 'data', 'books.json');
const OCR_SWIFT = join(ROOT, 'ocr.swift');
const INBOX = join(ROOT, 'inbox');
const PROCESSED = join(INBOX, 'processed');
const REVIEW = join(INBOX, 'review');
const COVERS = join(ROOT, 'src', 'assets', 'covers');
const COVER_EXT = ['jpg', 'jpeg', 'png', 'webp', 'avif'];
const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.heic', '.webp', '.tiff', '.gif']);

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const PUSH = args.includes('--push');
const STRICT = args.includes('--strict');
const BACKFILL = args.includes('--backfill');
const ENRICH = !args.includes('--no-enrich');
const explicit = args.filter((a) => !a.startsWith('--'));

/* ----------------------------- helpers ----------------------------- */

function log(...m) { console.log(...m); }
function hasCover(slug) { return COVER_EXT.some((e) => existsSync(join(COVERS, `${slug}.${e}`))); }
function removeCover(slug) {
  for (const e of COVER_EXT) { const p = join(COVERS, `${slug}.${e}`); if (existsSync(p)) try { unlinkSync(p); } catch { /* ignore */ } }
}

function runOcr(imgPath) {
  const out = execFileSync('swift', [OCR_SWIFT, imgPath], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return out.split('\n').filter((l) => !/^===\s.*\s===$/.test(l.trim())).join('\n');
}

function loadBooks() { return JSON.parse(readFileSync(DATA, 'utf8')); }

function ensureDirs() {
  for (const d of [INBOX, PROCESSED, REVIEW, COVERS]) if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function collectImages() {
  if (explicit.length) return explicit.map((p) => resolve(p));
  if (!existsSync(INBOX)) return [];
  return readdirSync(INBOX)
    .filter((f) => IMG_EXT.has(extname(f).toLowerCase()))
    .map((f) => join(INBOX, f));
}

function moveTo(dir, imgPath, sidecar) {
  if (DRY) return;
  const dest = join(dir, basename(imgPath));
  try { renameSync(imgPath, dest); } catch { copyFileSync(imgPath, dest); }
  if (sidecar) writeFileSync(dest.replace(/\.[^.]+$/, '') + '.review.txt', sidecar);
}

// Fill in description / categories / cover for one entry (mutates it). Best-effort.
// With force=true, overwrites existing fields and re-downloads the cover.
async function enrich(entry, slug, force = false) {
  // Without an author, titles like "Droga do szczęścia" are ambiguous (several
  // different books share them), so we don't guess. Add the author and re-run.
  if (!entry.author) {
    log('      · pomijam (brak autora) — dodaj autora w books.json, potem: npm run ingest -- --backfill --force "<fragment tytułu>"');
    return;
  }
  let meta;
  try {
    meta = await fetchMetadataWithFallback(entry.title, entry.author, entry.originalTitle, { hasUsableCover: hasCover(slug) });
  } catch (e) {
    log(`      · wzbogacanie nie powiodło się: ${e.message}`);
    return;
  }
  if (!meta) {
    log('      · nie znaleziono — popraw tytuł/autora w books.json, potem: npm run ingest -- --backfill "<fragment tytułu>"');
    return;
  }

  if (meta.description && (force || !entry.description)) entry.description = meta.description;
  if (meta.categories?.length && (force || !(entry.categories && entry.categories.length))) entry.categories = meta.categories;

  let coverMsg = 'brak okładki';
  const coverExists = hasCover(slug);
  if (meta.coverUrls.length && !DRY && (force || !coverExists)) {
    if (force && coverExists) removeCover(slug);
    const dest = await downloadBestCover(meta.coverUrls, join(COVERS, slug));
    coverMsg = dest ? `okładka -> ${basename(dest)}` : 'nie udało się pobrać okładki';
  } else if (coverExists) {
    coverMsg = 'okładka już jest (pomijam)';
  } else if (meta.coverUrls.length && DRY) {
    coverMsg = `${meta.coverUrls.length} kandydatów na okładkę`;
  }

  const src = meta.sources.join(' + ') || '—';
  const fallbackMsg = meta.fallbackUsed
    ? ` · oryginalny tytuł „${meta.fallbackOriginalTitle}” — ${meta.fallbackOutcome === 'success' ? 'zapożyczono dane' : meta.fallbackOutcome === 'empty' ? 'nie znaleziono danych' : `błąd: ${meta.fallbackError}`}`
    : '';
  log(`      + opis: ${entry.description ? 'tak' : 'nie'} · kategorie: ${(entry.categories || []).join(', ') || '—'} · ${coverMsg}  [${src}]${fallbackMsg}`);
  if (DRY && entry.description) log(`        opis: ${entry.description.slice(0, 160)}${entry.description.length > 160 ? '…' : ''}`);
}

function gitPush(subject) {
  const git = (as) => execFileSync('git', as, { cwd: ROOT, encoding: 'utf8' });
  const paths = ['src/data/books.json', 'src/assets/covers'];
  try {
    const status = git(['status', '--porcelain', '--', ...paths]).trim();
    if (status) {
      git(['add', '--', ...paths]);
      git(['commit', '-m', subject, '--', ...paths]);
      log(`✓ ${subject}`);
    }
    git(['push']); // also flushes any commit left unpushed by an earlier failure
    log('↑ Wypchnięto do repo — GitHub Pages przebuduje stronę.');
  } catch (e) {
    log(`✗ git push nie powiódł się: ${(e.message || '').split('\n')[0]}`);
    log('  Zmiany są zapisane i zacommitowane lokalnie. Sprawdź remote/uprawnienia (SSH lub token).');
  }
}

/* ------------------------------ main ------------------------------- */

async function backfill(books) {
  const force = args.includes('--force');
  const targets = explicit.map((s) => s.toLowerCase()); // optional title fragments
  let changed = 0;
  for (const b of books) {
    if (targets.length && !targets.some((t) => b.title.toLowerCase().includes(t))) continue;
    const slug = slugify(b.title);
    const missing = !b.description || !(b.categories && b.categories.length) || !hasCover(slug);
    if (!force && !missing) continue;
    log(`▶ ${b.title}`);
    if (!b.categories) b.categories = [];
    if (ENRICH) await enrich(b, slug, force);
    changed += 1;
  }
  if (changed && !DRY) {
    writeFileSync(DATA, serializeBooks(books));
    log(`\n✓ Zaktualizowano ${changed} książkę/ek.`);
    if (PUSH) gitPush(`Metadane książek (${changed})`);
    else log('  (uruchom z --push, aby zatwierdzić i wypchnąć)');
  } else if (!changed) {
    log(targets.length
      ? '\nNie znaleziono pasujących książek (lub mają już komplet danych — użyj --force, aby odświeżyć).'
      : '\nWszystkie książki mają już komplet metadanych (użyj --force, aby odświeżyć).');
  } else {
    log('\n[dry-run] Nic nie zapisano.');
  }
}

async function main() {
  if (!existsSync(OCR_SWIFT)) { console.error(`Brak ${OCR_SWIFT}`); process.exit(1); }
  ensureDirs();
  const books = loadBooks();

  if (BACKFILL) { await backfill(books); return; }

  const images = collectImages();
  if (!images.length) { log('Brak obrazów do przetworzenia (dołóż pliki do inbox/).'); return; }

  const roster = buildRoster(books);
  const existingSlugs = new Set(books.map((b) => slugify(b.title)));
  const added = [];

  for (const img of images) {
    log(`\n▶ ${basename(img)}`);
    let text;
    try {
      text = runOcr(img);
    } catch (e) {
      log(`  ✗ OCR nie powiódł się: ${e.message}`);
      moveTo(REVIEW, img, `Błąd OCR:\n${e.message}\n`);
      continue;
    }

    const all = finalizeBooks(parseBlocks(text, roster), roster, STRICT);
    // An ambiguous "A, B" header goes to the book databases before it goes to a
    // human: whichever reading actually exists wins, and a title that merely
    // contains a comma resolves to itself.
    for (const p of all) {
      if (!p.ambiguous || !p.blocking.length) continue;
      let hit = null;
      try {
        hit = await resolveHeader(p.candidates);
      } catch (e) {
        // The only throw resolveHeader makes: Google Books hit its daily quota
        // and Open Library matched nothing, so no reading was really checked.
        // The header stays ambiguous and goes to review, the way it did before
        // we asked at all — one unchecked header must not abort the whole batch.
        log(`      ⚠ Nie udało się sprawdzić nagłówka w bazach: ${e.message}`);
      }
      if (!hit) continue;
      applyHeaderResolution(p, hit);
      log(`      · rozpoznano w bazie: „${hit.title}" — ${hit.author || 'bez autora'}`);
    }
    // Edge-cut fragments are noise, not candidates: they neither publish nor
    // send the image to review.
    const parsed = all.filter((p) => !p.fragment);

    for (const p of all) {
      const tag = p.fragment ? 'FRAGMENT' : existingSlugs.has(p.slug) ? 'JUŻ ISTNIEJE' : p.blocking.length ? 'DO PRZEGLĄDU' : 'OK';
      log(`  • [${tag}] „${p.entry.title}" — ${Object.keys(p.entry.scores).length} ocen, śr. ${p.computedAverage?.toFixed(2) ?? '—'}`);
      for (const n of p.notes) log(`      ⚠ ${n}`);
    }

    if (!parsed.length) {
      log('  ✗ Nie znaleziono żadnych ocen. -> review/');
      moveTo(REVIEW, img, `Nie udało się sparsować.\n\n--- surowy OCR ---\n${text}\n`);
      continue;
    }

    // Books already on the site are skipped either way, so their warnings must
    // not drag the image to review.
    const candidates = parsed.filter((p) => !existingSlugs.has(p.slug));
    const needsReview = candidates.filter((p) => p.blocking.length);
    const ready = candidates.filter((p) => !p.blocking.length);

    if (needsReview.length) {
      const sidecar =
        `Wykryto ${parsed.length} książkę/i; ${needsReview.length} wymaga(ją) sprawdzenia.\n\n` +
        parsed.map((p) => `${p.entry.title}\n  ${JSON.stringify(p.entry)}\n  uwagi: ${p.notes.join('; ') || 'brak'}`).join('\n\n') +
        `\n\n--- surowy OCR ---\n${text}\n`;
      log('  → obraz przeniesiony do review/ (nic nie dodano z tego obrazu)');
      moveTo(REVIEW, img, sidecar);
      continue;
    }

    for (const p of ready) {
      if (ENRICH) await enrich(p.entry, p.slug);
      books.push(p.entry);
      existingSlugs.add(p.slug);
      added.push(p.entry.title);
    }
    moveTo(PROCESSED, img);
  }

  if (added.length && !DRY) {
    writeFileSync(DATA, serializeBooks(books));
    log(`\n✓ Dodano ${added.length} książkę/i do books.json: ${added.join(', ')}`);
    if (PUSH) gitPush(`Dodano: ${added.join(', ')} (ingest)`);
    else log('  (uruchom z --push, aby zatwierdzić i wypchnąć do repo)');
  } else if (!added.length) {
    log('\nNie dodano nowych książek.');
  } else {
    log('\n[dry-run] Nic nie zapisano.');
  }
}

await main();
