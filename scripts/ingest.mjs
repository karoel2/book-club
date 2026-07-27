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
 * Usage:
 *   node scripts/ingest.mjs [images...]   process given images (or scan inbox/)
 *   node scripts/ingest.mjs --dry-run img parse + preview metadata, change nothing
 *   node scripts/ingest.mjs --push        add + git commit + git push
 *   node scripts/ingest.mjs --backfill    enrich existing books that lack metadata
 *   node scripts/ingest.mjs --no-enrich   skip the description/category/cover lookup
 *   node scripts/ingest.mjs --strict      send even advisory-flagged books to review/
 */

import {
  readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, renameSync, existsSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename, extname } from 'node:path';
import { fetchMetadata, downloadBestCover } from './metadata.mjs';

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

const PL_DIACRITICS = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };

function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (ch) => PL_DIACRITICS[ch] ?? ch)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Fold a name so the OCR artifact (t vs ł) matches the roster spelling.
function memberKey(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/t/g, 'l')
    .replace(/[^a-z]/g, '');
}

function log(...m) { console.log(...m); }
function hasCover(slug) { return COVER_EXT.some((e) => existsSync(join(COVERS, `${slug}.${e}`))); }

function runOcr(imgPath) {
  const out = execFileSync('swift', [OCR_SWIFT, imgPath], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return out.split('\n').filter((l) => !/^===\s.*\s===$/.test(l.trim())).join('\n');
}

/* ----------------------------- parsing ----------------------------- */

const SCORE_RE = /^(.+?)\s*[-–—:]\s*(\d{1,2})$/;
const NOSCORE_RE = /^(.+?)\s*[-–—:]\s*$/;
const AVG_RE = /^(\d{1,2})(?:[.,]\d+)?$/;
const PAGE_RE = /^\d+\s*\/\s*\d+$/;
const AUTHOR_INITIAL = /(^|\s)[A-ZŻŹĆŁŚĘÓŃ]\.\s*[A-ZŻŹĆŁŚĘÓŃ]?/;

function parseBlocks(text) {
  const lines = text.split('\n').map((l) => l.trim());
  const blocks = [];
  let cur = null;
  const flush = () => {
    if (cur && cur.scores.length) blocks.push(cur);
    cur = null;
  };

  for (const line of lines) {
    if (!line) { flush(); continue; }
    if (PAGE_RE.test(line)) continue;

    const scoreM = line.match(SCORE_RE);
    const noScoreM = scoreM ? null : line.match(NOSCORE_RE);
    if (scoreM || noScoreM) {
      if (!cur) cur = { header: [], scores: [], avg: null };
      cur.scores.push({
        name: (scoreM ? scoreM[1] : noScoreM[1]).trim(),
        score: scoreM ? parseInt(scoreM[2], 10) : null,
      });
      continue;
    }
    if (AVG_RE.test(line) && cur && cur.scores.length) {
      cur.avg = parseFloat(line.replace(',', '.'));
      flush();
      continue;
    }
    if (cur && cur.scores.length) flush();
    if (!cur) cur = { header: [], scores: [], avg: null };
    cur.header.push(line);
  }
  flush();
  return blocks;
}

function splitTitleAuthor(header) {
  const text = header.join(' ').replace(/\s+/g, ' ').trim();
  if (!text.includes(',')) return { title: text, author: null, warnings: [] };
  const idx = text.lastIndexOf(',');
  const left = text.slice(0, idx).trim();
  const right = text.slice(idx + 1).trim();
  const leftAuthor = AUTHOR_INITIAL.test(left);
  const rightAuthor = AUTHOR_INITIAL.test(right);
  if (rightAuthor && !leftAuthor) return { title: left, author: right, warnings: [] };
  if (leftAuthor && !rightAuthor) return { title: right, author: left, warnings: [] };
  return {
    title: text,
    author: null,
    warnings: ['Nie rozpoznano autora — sprawdź podział tytuł/autor w books.json'],
  };
}

function finalizeBook(block, roster) {
  const { title, author, warnings } = splitTitleAuthor(block.header);
  const notes = [...warnings];

  const scores = {};
  for (const { name, score } of block.scores) {
    const key = memberKey(name);
    const canonical = [...roster].find((r) => memberKey(r) === key);
    if (canonical) {
      scores[canonical] = score;
    } else {
      scores[name] = score;
      notes.push(`Niepewny/nowy członek: „${name}" (brak w dotychczasowej liście — sprawdź pisownię)`);
    }
  }

  const nums = Object.values(scores).filter((s) => typeof s === 'number');
  const computed = nums.length ? nums.reduce((a, c) => a + c, 0) / nums.length : null;
  if (block.avg != null && computed != null && Math.abs(computed - block.avg) > 0.06) {
    notes.push(`Średnia z ekranu (${block.avg}) ≠ policzona (${computed.toFixed(2)}) — możliwe błędne odczytanie ocen`);
  }
  if (block.avg == null) notes.push('Brak średniej na ekranie — nie udało się zweryfikować ocen');
  if (!title) notes.push('Nie rozpoznano tytułu');

  const blocking = notes.filter(
    (n) => n.includes('Średnia z ekranu') || n.includes('Niepewny/nowy członek') || n.includes('Nie rozpoznano tytułu'),
  );

  return {
    entry: { title, author, scores },
    slug: slugify(title || ''),
    ocrAverage: block.avg,
    computedAverage: computed,
    notes,
    blocking: STRICT ? notes : blocking,
  };
}

/* ------------------------------ books ------------------------------ */

function loadBooks() { return JSON.parse(readFileSync(DATA, 'utf8')); }

function buildRoster(books) {
  const roster = new Set();
  for (const b of books) for (const name of Object.keys(b.scores ?? {})) roster.add(name);
  return roster;
}

// Serialise in the same compact style as the hand-written books.json.
function serializeBooks(books) {
  const items = books.map((b) => {
    const scores = Object.entries(b.scores)
      .map(([k, v]) => `${JSON.stringify(k)}: ${v === null ? 'null' : v}`)
      .join(', ');
    const lines = [
      `    "title": ${JSON.stringify(b.title)}`,
      `    "author": ${b.author == null ? 'null' : JSON.stringify(b.author)}`,
      `    "scores": { ${scores} }`,
    ];
    if (b.categories && b.categories.length) lines.push(`    "categories": ${JSON.stringify(b.categories)}`);
    if (b.description) lines.push(`    "description": ${JSON.stringify(b.description)}`);
    return `  {\n${lines.join(',\n')}\n  }`;
  });
  return `[\n${items.join(',\n')}\n]\n`;
}

/* --------------------------- side effects -------------------------- */

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
async function enrich(entry, slug) {
  let meta;
  try {
    meta = await fetchMetadata(entry.title, entry.author);
  } catch (e) {
    log(`      · wzbogacanie nie powiodło się: ${e.message}`);
    return;
  }
  if (!meta) { log('      · brak metadanych (nie znaleziono książki)'); return; }

  if (meta.description && !entry.description) entry.description = meta.description;
  if (meta.categories?.length && !(entry.categories && entry.categories.length)) entry.categories = meta.categories;

  let coverMsg = 'brak okładki';
  if (hasCover(slug)) {
    coverMsg = 'okładka już jest (pomijam)';
  } else if (meta.coverUrls.length && !DRY) {
    const dest = await downloadBestCover(meta.coverUrls, join(COVERS, slug));
    coverMsg = dest ? `okładka -> ${basename(dest)}` : 'nie udało się pobrać okładki';
  } else if (meta.coverUrls.length && DRY) {
    coverMsg = `${meta.coverUrls.length} kandydatów na okładkę`;
  }

  const src = meta.sources.join(' + ') || '—';
  log(`      + opis: ${entry.description ? 'tak' : 'nie'} · kategorie: ${(entry.categories || []).join(', ') || '—'} · ${coverMsg}  [${src}]`);
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
  let changed = 0;
  for (const b of books) {
    const slug = slugify(b.title);
    const needs = !b.description || !(b.categories && b.categories.length) || !hasCover(slug);
    if (!needs) continue;
    log(`▶ ${b.title}`);
    if (!b.categories) b.categories = [];
    if (ENRICH) await enrich(b, slug);
    changed += 1;
  }
  if (changed && !DRY) {
    writeFileSync(DATA, serializeBooks(books));
    log(`\n✓ Uzupełniono metadane dla ${changed} książki/ek.`);
    if (PUSH) gitPush(`Uzupełniono metadane (${changed})`);
    else log('  (uruchom z --push, aby zatwierdzić i wypchnąć)');
  } else if (!changed) {
    log('\nWszystkie książki mają już komplet metadanych.');
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

    const parsed = parseBlocks(text).map((blk) => finalizeBook(blk, roster));
    if (!parsed.length) {
      log('  ✗ Nie znaleziono żadnych ocen. -> review/');
      moveTo(REVIEW, img, `Nie udało się sparsować.\n\n--- surowy OCR ---\n${text}\n`);
      continue;
    }

    const needsReview = parsed.filter((p) => p.blocking.length);
    const ready = parsed.filter((p) => !p.blocking.length && !existingSlugs.has(p.slug));

    for (const p of parsed) {
      const tag = existingSlugs.has(p.slug) ? 'JUŻ ISTNIEJE' : p.blocking.length ? 'DO PRZEGLĄDU' : 'OK';
      log(`  • [${tag}] „${p.entry.title}" — ${Object.keys(p.entry.scores).length} ocen, śr. ${p.computedAverage?.toFixed(2) ?? '—'}`);
      for (const n of p.notes) log(`      ⚠ ${n}`);
    }

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
