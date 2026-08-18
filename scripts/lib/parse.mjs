/**
 * Portable OCR-text parsing shared by the local CLI (scripts/ingest.mjs) and the
 * serverless ingest function (azure/). Pure functions — no filesystem, no network.
 *
 * Turns OCR text into book entries ({ title, author, scores }) plus warnings,
 * canonicalises member names against the existing roster (fixing the OCR
 * "ł -> t" glitch), and cross-checks scores against the on-screen average.
 */

const PL_DIACRITICS = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };

export function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (ch) => PL_DIACRITICS[ch] ?? ch)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Fold a name so the OCR artifact (t vs ł) matches the roster spelling.
export function memberKey(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/t/g, 'l')
    .replace(/[^a-z]/g, '');
}

// An ordinary word: 3+ letters in Title/lower case. Every book title has one;
// phone UI chrome ("V IsN •", "SG R", "+", "111") never does.
const WORD_RE = /\p{Lu}?\p{Ll}{2,}/u;

// "Karol - 6", "Zosia -" (took part, left no number), and the legacy "Zosia - 8F".
// The F marked someone who came via the film; the number is still their score,
// so only the letter is dropped. The club has stopped writing it — recognising
// it is what keeps the older screenshots parsing correctly.
const SCORE_RE = /^(.+?)\s*[-–—:]\s*(\d{1,2})\s*F?$/i;
const NOSCORE_RE = /^(.+?)\s*[-–—:]\s*$/;
// "Karol 7" — the notes-app list writes no separator at all. With nothing but a
// space to go on, a sequel title ("Diuna 2") is indistinguishable from a score,
// so this form counts only for names already on the roster; anything else stays
// part of the title. Tried after the dashed forms.
const SCORE_SPACE_RE = /^([^\d]{2,30}?)\s+(\d{1,2})$/;
// The average printed under a block: "6,4", "8", or the two-figure legacy form
// "6,18 F / 5,71" — everyone / excluding the F scores. We count every score, so
// the first figure is the one that should match.
const AVG_RE = /^(\d{1,2}(?:[.,]\d+)?)(?:\s*F)?(?:\s*\/\s*(\d{1,2}(?:[.,]\d+)?)(?:\s*F)?)?$/i;
const PAGE_RE = /^\d+\s*\/\s*\d+$/;
const AUTHOR_INITIAL = /(^|\s)[A-ZŻŹĆŁŚĘÓŃ]\.\s*[A-ZŻŹĆŁŚĘÓŃ]?/;

const hasLetter = (s) => /\p{L}/u.test(s);
const toNum = (s) => parseFloat(s.replace(',', '.'));

/**
 * Phone/app furniture the screenshot caught around the list. Only consulted
 * after score / average / page-marker lines have been claimed, so a bare
 * average like "8" is never mistaken for chrome.
 */
export function isChrome(line) {
  if (/^\d{1,2}[:.]\d{2}\b/.test(line)) return true; // status-bar clock: "14:37 C @"
  if (/^[<>‹›«»]/.test(line)) return true; // back arrow / nav: "< Tytuł", "<"
  if (/^\d{3,}$/.test(line)) return true; // badges & counters: "286", "111"
  return !WORD_RE.test(line); // "+", ":", "V•", "SG R"
}

export function parseBlocks(text, roster = null) {
  const onRoster = (name) => {
    if (!roster) return false;
    const key = memberKey(name.trim());
    return [...roster].some((r) => memberKey(r) === key);
  };
  const lines = text.split('\n').map((l) => l.trim());
  const blocks = [];
  let cur = null;
  const start = () => (cur ??= { header: [], scores: [], avg: null, avgAlt: null });
  const flush = () => {
    if (cur && cur.scores.length) blocks.push(cur);
    cur = null;
  };

  for (const line of lines) {
    if (!line) { flush(); continue; }
    if (PAGE_RE.test(line)) continue;

    // A member name always has a letter — that keeps the status-bar clock
    // ("14:34") from being read as "member 14 scored 34".
    const spaceM = line.match(SCORE_SPACE_RE);
    const scoreM = line.match(SCORE_RE) || (spaceM && onRoster(spaceM[1]) ? spaceM : null);
    const noScoreM = scoreM ? null : line.match(NOSCORE_RE);
    const nameM = scoreM || noScoreM;
    if (nameM && hasLetter(nameM[1])) {
      start().scores.push({
        name: nameM[1].trim(),
        score: scoreM ? parseInt(scoreM[2], 10) : null,
      });
      continue;
    }

    const avgM = line.match(AVG_RE);
    if (avgM && cur && cur.scores.length) {
      cur.avg = toNum(avgM[1]);
      cur.avgAlt = avgM[2] ? toNum(avgM[2]) : null;
      flush();
      continue;
    }

    if (isChrome(line)) continue; // never part of a title

    if (cur && cur.scores.length) flush();
    start().header.push(line);
  }
  flush();
  return blocks;
}

// A personal name is one to three capitalised tokens and nothing else ("Lisa
// Ridzen", "Kanae Minato"). Two-token minimum: a lone capitalised word is just
// as likely to be a title ("Achaja", "Wyznania").
function looksLikePerson(s) {
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 3) return false;
  return tokens.every((t) => /^\p{Lu}/u.test(t));
}

// A Polish title nearly always carries a lowercase word — a verb, preposition or
// adjective ("Kiedy żurawie odlatują na południe"). Personal names never do.
function hasLowercaseWord(s) {
  return s.split(/\s+/).filter(Boolean).some((t) => /^\p{Ll}/u.test(t));
}

/**
 * Every plausible reading of a header, best guess first. Only consulted when the
 * comma split is a coin toss: the caller confirms one against a book database
 * rather than the parser guessing (see resolveHeader in ../metadata.mjs).
 *
 * Splits on *every* comma, not just the last, so an author survives a title that
 * contains one ("Dziki, mroczny brzeg, C. McConaghy"). The final candidate is
 * always the whole header as a title with no author, which is what rescues a
 * comma'd title that has no author on the line at all.
 */
function headerCandidates(text, header) {
  const out = [];
  const push = (title, author) => {
    const t = (title || '').trim();
    const a = (author || '').trim() || null;
    if (!t || !WORD_RE.test(t)) return;
    if (out.some((c) => c.title === t && c.author === a)) return;
    out.push({ title: t, author: a });
  };

  // Last comma first: "Title, Author" is the common form, and an earlier comma
  // is far more likely to belong inside the title than to separate the author.
  const commas = [];
  for (let i = 0; i < text.length; i++) if (text[i] === ',') commas.push(i);
  for (const i of commas.reverse()) {
    const left = text.slice(0, i).trim();
    const right = text.slice(i + 1).trim();
    if (!left || !right) continue;
    push(left, right);
    push(right, left);
  }

  // Notes format: two lines, either way round.
  if (header.length === 2 && header.every((l) => l.trim())) {
    push(header[0], header[1]);
    push(header[1], header[0]);
  }

  push(text, null); // the comma was part of the title
  return out;
}

/**
 * The club writes a header either way round ("Wiedźmin, A. Sapkowski" but also
 * "S. King, Worek Kości"), so the side carrying an initial is the author. When
 * neither side has one ("Wyznania, Kanae Minato") the split is a coin toss —
 * don't guess, hand back ranked `candidates` for the caller to verify against a
 * book database, and only block if none of them can be confirmed.
 */
export function splitTitleAuthor(header) {
  const text = header.join(' ').replace(/\s+/g, ' ').trim();
  const idx = text.lastIndexOf(',');
  const candidates = headerCandidates(text, header);
  const plain = { title: text, author: null, warnings: [], ambiguous: false, candidates };

  // The notes-app format puts the title and the author on their own lines with
  // no comma anywhere ("Dungeon Crawler Carl" / "Matt Dinniman"). Both look
  // alike, so go by position — title first — and say so, since a wrapped long
  // title would land here too.
  if (idx < 0 && header.length === 2 && header.every((l) => l.trim())) {
    return {
      title: header[0].trim(),
      author: header[1].trim(),
      ambiguous: false,
      candidates,
      warnings: [`Tytuł i autor wzięte z dwóch linii: „${header[0].trim()}" / „${header[1].trim()}" — sprawdź podział`],
    };
  }
  if (idx < 0) return plain;

  const left = text.slice(0, idx).trim();
  const right = text.slice(idx + 1).trim();
  if (!left || !right) return { ...plain, title: left || right }; // trailing comma: "Śnieg przykryje,"

  const leftAuthor = AUTHOR_INITIAL.test(left);
  const rightAuthor = AUTHOR_INITIAL.test(right);
  if (rightAuthor && !leftAuthor) return { title: left, author: right, warnings: [], ambiguous: false, candidates };
  if (leftAuthor && !rightAuthor) return { title: right, author: left, warnings: [], ambiguous: false, candidates };

  // No initial anywhere. Shape still decides it when one side is a bare personal
  // name and the other unmistakably prose — and unlike the database lookup this
  // costs nothing and can't be rate-limited. Both conditions are required: with
  // "Zielona Mila, King" neither side has a lowercase word, so we stay unsure.
  if (looksLikePerson(right) && hasLowercaseWord(left)) {
    return { title: left, author: right, warnings: [], ambiguous: false, candidates };
  }
  if (looksLikePerson(left) && hasLowercaseWord(right)) {
    return { title: right, author: left, warnings: [], ambiguous: false, candidates };
  }

  return {
    title: text,
    author: null,
    ambiguous: true,
    candidates,
    warnings: [`Nie wiadomo, co jest tytułem, a co autorem: „${left}" / „${right}" — sprawdzam w bazie książek`],
  };
}

/**
 * Rewrite a finalized book once a candidate has been confirmed against a book
 * database. Clears the ambiguity blocker (leaving any unrelated ones) and — the
 * easy thing to forget — re-slugs, since the slug drives the duplicate check.
 */
export function applyHeaderResolution(p, { title, author }) {
  p.entry.title = title;
  p.entry.author = author || null;
  p.slug = slugify(title || '');
  const drop = new Set(p.headerNotes || []);
  p.notes = p.notes.filter((n) => !drop.has(n));
  p.blocking = p.blocking.filter((n) => !drop.has(n));
  p.ambiguous = false;
  return p;
}

// Fewer votes than this and the block is almost certainly a book sliced by the
// top or bottom edge of the screenshot, not a new one. The club's smallest real
// entry has five scores.
export const MIN_SCORES = 3;

/**
 * Finalize every block from one screenshot together, because whether a missing
 * average is alarming depends on the sheet as a whole: in the chat format each
 * book prints one, so a block without it was sliced off; the notes format never
 * prints one, and blocking those would mean nothing from it could ever publish.
 */
export function finalizeBooks(blocks, roster, strict = false) {
  const sheetHasAverages = blocks.some((b) => b.avg != null);
  return blocks.map((b) => finalizeBook(b, roster, strict, { sheetHasAverages }));
}

export function finalizeBook(block, roster, strict = false, { sheetHasAverages = true } = {}) {
  const { title, author, warnings, ambiguous, candidates } = splitTitleAuthor(block.header);
  const notes = [];
  const blockers = [];
  const warn = (t) => notes.push(t);
  const block_ = (t) => { notes.push(t); blockers.push(t); };
  for (const w of warnings) (ambiguous ? block_ : warn)(w);

  const scores = {};
  for (const { name, score } of block.scores) {
    const key = memberKey(name);
    const canonical = [...roster].find((r) => memberKey(r) === key);
    if (canonical) {
      scores[canonical] = score;
    } else {
      scores[name] = score;
      block_(`Niepewny/nowy członek: „${name}" (brak w dotychczasowej liście — sprawdź pisownię)`);
    }
  }
  // Cut-off leftovers get dropped rather than published or sent to review —
  // a partial score list is never worth a human's time.
  const fragment = block.scores.length < MIN_SCORES;

  const nums = Object.values(scores).filter((s) => typeof s === 'number');
  const computed = nums.length ? nums.reduce((a, c) => a + c, 0) / nums.length : null;
  const printed = [block.avg, block.avgAlt].filter((a) => a != null);
  if (printed.length && computed != null) {
    // With the two-figure form only one side counts every score; either match confirms the read.
    if (!printed.some((a) => Math.abs(computed - a) <= 0.06)) {
      block_(`Średnia z ekranu (${printed.join(' / ')}) ≠ policzona (${computed.toFixed(2)}) — możliwe błędne odczytanie ocen`);
    }
  } else if (!fragment) {
    // Missing among printed averages = a book the screenshot cut in half.
    // Missing everywhere = a format that just doesn't print them.
    if (sheetHasAverages) block_('Brak średniej na ekranie — nie można zweryfikować ocen');
    else warn('Ten zrzut nie podaje średnich — ocen nie da się sprawdzić, przejrzyj je wzrokowo');
  }

  // The notes format is exactly two header lines, title then author. A third
  // means a line wasn't recognised — typically a new member the roster doesn't
  // know yet, which would otherwise be glued silently onto the title.
  if (!sheetHasAverages && block.header.length > 2) {
    block_(`Nierozpoznana linia nad ocenami: „${block.header.slice(2).join(' | ')}" — nowy członek? dopisz go ręcznie`);
  }

  if (!title) block_('Nie rozpoznano tytułu');
  else if (!WORD_RE.test(title)) block_(`Tytuł wygląda na śmieci z OCR: „${title}"`);

  if (fragment) warn(`Fragment: ${block.scores.length} ocen(y) — prawdopodobnie ucięty brzeg zrzutu, pomijam`);

  return {
    entry: { title, author, scores },
    slug: slugify(title || ''),
    ocrAverage: block.avg,
    ocrAverageAlt: block.avgAlt ?? null,
    computedAverage: computed,
    fragment,
    notes,
    blocking: fragment ? [] : strict ? notes : blockers,
    // For the caller's database lookup: which readings to try, and which notes
    // to retract if one of them is confirmed.
    ambiguous,
    candidates: candidates || [],
    headerNotes: ambiguous ? warnings : [],
  };
}

export function buildRoster(books) {
  const roster = new Set();
  for (const b of books) for (const name of Object.keys(b.scores ?? {})) roster.add(name);
  return roster;
}

// Serialise in the same compact style as the hand-written books.json.
export function serializeBooks(books) {
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
