#!/usr/bin/env node
/**
 * Set the book on the "next meeting" card, or re-check where it can be got.
 *
 * The same job the email path does (azure/src/functions/next-book.mjs), run by
 * hand: parse the line, confirm the book exists, ask the five services about
 * availability, fetch a cover, write src/data/next-meeting.json.
 *
 * Usage:
 *   npm run next -- "Problem trzech ciał, Cixin Liu"
 *   npm run next -- "Problem trzech ciał, Cixin Liu, 25/08/26 18:00"
 *   npm run next -- --recheck            re-run the availability checks, same book
 *   npm run next -- --dry-run "…"        print what would change, write nothing
 *   npm run next -- --push "…"           + git commit & push (rebuilds the site)
 *   npm run next -- --no-verify "…"      skip the book-database confirmation
 *   npm run next -- --no-cover "…"       don't download a cover
 *
 * Leave the date out and the first meeting is 25/08/26; later meetings advance
 * by a fortnight from the previous scheduled Tuesday.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';
import { fetchMetadata, downloadBestCover, resolveHeader } from './metadata.mjs';
import { checkAvailability, PROVIDERS } from './lib/availability.mjs';
import {
  parseNextBookEmail,
  buildNextMeeting,
  serializeNextMeeting,
  readingsFor,
  requiresConfirmation,
} from './lib/next-meeting.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATA = join(ROOT, 'src', 'data', 'next-meeting.json');
const COVERS = join(ROOT, 'src', 'assets', 'covers');
const COVER_EXT = ['jpg', 'jpeg', 'png', 'webp', 'avif'];

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const PUSH = args.includes('--push');
const RECHECK = args.includes('--recheck');
const VERIFY = !args.includes('--no-verify');
const COVER = !args.includes('--no-cover');
const line = args.filter((a) => !a.startsWith('--')).join(' ').trim();

const log = (...m) => console.log(...m);
const hasCover = (slug) => COVER_EXT.some((e) => existsSync(join(COVERS, `${slug}.${e}`)));

function loadPrevious() {
  if (!existsSync(DATA)) return {};
  try {
    return JSON.parse(readFileSync(DATA, 'utf8')) || {};
  } catch (e) {
    log(`✗ ${basename(DATA)} nie jest poprawnym JSON-em: ${e.message}`);
    process.exit(1);
  }
}

function gitPush(subject) {
  const git = (as) => execFileSync('git', as, { cwd: ROOT, encoding: 'utf8' });
  const paths = ['src/data/next-meeting.json', 'src/assets/covers'];
  try {
    if (git(['status', '--porcelain', '--', ...paths]).trim()) {
      git(['add', '--', ...paths]);
      git(['commit', '-m', subject, '--', ...paths]);
      log(`✓ ${subject}`);
    }
    git(['push']);
    log('↑ Wypchnięto do repo — GitHub Pages przebuduje stronę.');
  } catch (e) {
    log(`✗ git push nie powiódł się: ${(e.message || '').split('\n')[0]}`);
    log('  Zmiany są zapisane lokalnie. Sprawdź remote/uprawnienia.');
  }
}

async function main() {
  const previous = loadPrevious();

  if (!line && !RECHECK) {
    log('Podaj książkę, np.:  npm run next -- "Problem trzech ciał, Cixin Liu"');
    log('albo odśwież dostępność bieżącej:  npm run next -- --recheck');
    process.exit(1);
  }

  // --recheck keeps the book and the date, and only re-asks the services.
  let title = previous.title;
  let author = previous.author ?? null;
  let date = previous.date;
  let time = previous.time;
  let meta = null;

  if (!RECHECK) {
    const parsed = parseNextBookEmail(line);
    if (!parsed) {
      log(`✗ „${line}" nie wygląda jak „Tytuł, Autor".`);
      process.exit(1);
    }
    ({ title, author, date, time } = parsed);
    for (const w of parsed.warnings) log(`  ⚠ ${w}`);

    if (VERIFY) {
      let hit = null;
      let lookupErr = null;
      try {
        hit = await resolveHeader(readingsFor(parsed));
      } catch (e) {
        // Google Books over its daily quota with nothing from Open Library is
        // the one failure resolveHeader reports, and it means "unchecked", not
        // "not a book" — don't phrase it as a rejected title. Anything else is
        // a bug in the lookup; let it surface instead of wearing this message.
        if (!e?.quota) throw e;
        lookupErr = e;
      }
      if (hit) {
        if (hit.title !== title || (hit.author || null) !== author) {
          log(`  · rozpoznano w bazie: „${hit.title}" — ${hit.author || 'bez autora'}`);
        }
        title = hit.title;
        // A title-only reading is often the one that confirms (Open Library
        // files Polish editions under a differently-spelled author). That says
        // the book is real — it doesn't mean the sender's author was wrong.
        author = hit.author || author;
        meta = hit.meta;
      } else if (requiresConfirmation(parsed)) {
        if (lookupErr) log(`✗ Nie udało się sprawdzić „${title}": ${lookupErr.message}`);
        else log(`✗ Nie znalazłem „${title}" w Google Books ani Open Library.`);
        log('  Dopisz autora („Tytuł, Autor"), popraw tytuł, albo dodaj mimo to: --no-verify');
        process.exit(1);
      } else if (lookupErr) {
        log(`  ⚠ Nie udało się sprawdzić w bazach książek (${lookupErr.message}) — zapisuję tak, jak podałeś.`);
      } else {
        log('  ⚠ Nie potwierdzono w bazach książek — zapisuję tak, jak podałeś.');
      }
    }
  }

  if (!title) {
    log('✗ Brak książki do sprawdzenia — najpierw ustaw ją: npm run next -- "Tytuł, Autor"');
    process.exit(1);
  }

  log(`\n▶ ${title}${author ? ` — ${author}` : ''}`);

  const availability = await checkAvailability(title, author);
  for (const { id, label } of PROVIDERS) {
    const r = availability[id];
    const mark = r.available === true ? '✓' : r.available === false ? '✗' : '?';
    const why = r.error ? ` (${r.error})` : r.note ? ` (${r.note})` : r.matched ? ` — ${r.matched}` : '';
    log(`  ${mark} ${label}${why}`);
  }

  const entry = buildNextMeeting({ title, author, date, time, availability }, previous);
  log(`  📅 ${entry.date} ${entry.time}${date ? '' : '  (domyślnie: za dwa tygodnie, wtorek)'}`);

  if (COVER && !DRY && !hasCover(entry.cover)) {
    try {
      const m = meta || (author ? await fetchMetadata(title, author) : null);
      if (m?.coverUrls?.length) {
        mkdirSync(COVERS, { recursive: true });
        const dest = await downloadBestCover(m.coverUrls, join(COVERS, entry.cover));
        log(dest ? `  🖼  okładka -> ${basename(dest)}` : '  🖼  nie udało się pobrać okładki');
      } else {
        log('  🖼  brak okładki w bazach — wrzuć ją ręcznie do src/assets/covers/');
      }
    } catch (e) {
      log(`  🖼  pobieranie okładki nie powiodło się: ${e.message}`);
    }
  }

  if (DRY) {
    log(`\n[dry-run] Nic nie zapisano. Zapisałbym:\n${serializeNextMeeting(entry)}`);
    return;
  }

  writeFileSync(DATA, serializeNextMeeting(entry));
  log(`\n✓ Zapisano ${basename(DATA)}`);
  if (PUSH) gitPush(`Następne spotkanie: ${title}`);
  else log('  (uruchom z --push, aby zatwierdzić i wypchnąć)');
}

await main();
