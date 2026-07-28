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

const SCORE_RE = /^(.+?)\s*[-–—:]\s*(\d{1,2})$/;
const NOSCORE_RE = /^(.+?)\s*[-–—:]\s*$/;
const AVG_RE = /^(\d{1,2})(?:[.,]\d+)?$/;
const PAGE_RE = /^\d+\s*\/\s*\d+$/;
const AUTHOR_INITIAL = /(^|\s)[A-ZŻŹĆŁŚĘÓŃ]\.\s*[A-ZŻŹĆŁŚĘÓŃ]?/;

export function parseBlocks(text) {
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

export function splitTitleAuthor(header) {
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

export function finalizeBook(block, roster, strict = false) {
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
    blocking: strict ? notes : blocking,
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
