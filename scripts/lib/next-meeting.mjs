/**
 * The "next meeting" card: which book the club is reading now, when it meets,
 * and where the book can be got. Pure functions — no filesystem, no network —
 * so the CLI (scripts/next-book.mjs) and the serverless function (azure/, via
 * `npm run sync`) share one definition of the format.
 *
 * The data lives in src/data/next-meeting.json and is set by emailing a single
 * line to the ingest mailbox:
 *
 *   Problem trzech ciał, Cixin Liu
 *   Problem trzech ciał, Cixin Liu, 25/08/26 18:00
 *
 * Splitting that line is the same problem the screenshot parser already solves
 * ("Dziki, mroczny brzeg" is one title, not a title and an author), so the
 * comma logic is reused from ./parse.mjs rather than re-guessed here.
 */

import { splitTitleAuthor, slugify } from './parse.mjs';

/** Provider ids, in the order the site shows them. Mirrors availability.mjs. */
export const PROVIDER_IDS = ['storytel', 'bookbeat', 'audioteka', 'legimi', 'biblioteka_raczynskich'];

const DEFAULT_TIME = '18:00';
const FIRST_MEETING_DATE = '25/08/26';
/** The club meets on Tuesdays. 2 = Tuesday in JS's 0=Sunday numbering. */
const MEETING_WEEKDAY = 2;

/* ------------------------------- dates -------------------------------- */

const pad = (n) => String(n).padStart(2, '0');

/**
 * Today in Warsaw, as a UTC-midnight Date.
 *
 * The function runs on a UTC host and the club does not, so "today" has to be
 * asked for in the club's timezone or a mail sent late in the evening books the
 * meeting a day early. Anchoring the result at UTC midnight keeps the later
 * day arithmetic free of DST surprises.
 */
export function todayInWarsaw(now = new Date()) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(now)
    .split('-')
    .map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** "25/08/26" — the format the card has always used (dd/mm/yy). */
export function formatMeetingDate(date) {
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCFullYear() % 100)}`;
}

/**
 * When the email leaves the date out, start at the first scheduled meeting and
 * advance from the previous meeting. This keeps the schedule independent of
 * when the email happens to arrive.
 */
export function defaultMeetingDate(previous = {}) {
  const match = String(previous.date || '').match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (!match) return FIRST_MEETING_DATE;

  const d = new Date(Date.UTC(2000 + Number(match[3]), Number(match[2]) - 1, Number(match[1])));
  if (d.getUTCDay() !== MEETING_WEEKDAY) return FIRST_MEETING_DATE;
  d.setUTCDate(d.getUTCDate() + 14);
  return formatMeetingDate(d);
}

// 25/08/26 · 25.08.2026 · 25-08-2026 · 2026-08-25
const DATE_RE = /^(?:(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})[./-](\d{1,2})[./-](\d{2,4}))$/;
const TIME_RE = /^(\d{1,2})[:.](\d{2})$/;

/**
 * Read a trailing "25/08/26 18:00" (either part optional, either order) and
 * return it normalised, or null if the chunk is not a date/time at all — which
 * is how a two-part "Title, Author" line is told apart from a three-part one.
 */
export function parseWhen(chunk) {
  const tokens = String(chunk || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;

  let date = null;
  let time = null;
  for (const token of tokens) {
    const d = token.match(DATE_RE);
    if (d && !date) {
      const [year, month, day] = d[1] ? [d[1], d[2], d[3]] : [d[6], d[5], d[4]];
      const yy = year.length === 4 ? Number(year) % 100 : Number(year);
      if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return null;
      date = `${pad(Number(day))}/${pad(Number(month))}/${pad(yy)}`;
      continue;
    }
    const t = token.match(TIME_RE);
    if (t && !time) {
      if (Number(t[1]) > 23 || Number(t[2]) > 59) return null;
      time = `${pad(Number(t[1]))}:${t[2]}`;
      continue;
    }
    return null; // a word that is neither: this chunk is part of the author
  }
  return { date, time };
}

/* ---------------------------- email parsing ---------------------------- */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/** Outlook hands us an HTML body; we only ever want its first line of text. */
export function htmlToText(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .join('\n');
}

// Where a mail client starts quoting the message being replied to. Everything
// from here down is somebody else's text, not an instruction.
const QUOTE_START =
  /^(>|-{2,}\s*$|_{5,}|-----\s*(Original Message|Wiadomość oryginalna)|(On|W dniu)\b.*\b(wrote|napisał|pisze):?$|(From|Od|Sent|Wysłano|To|Do|Subject|Temat):\s)/i;

/** The first line of the message the sender actually typed. */
export function firstBodyLine(text) {
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (QUOTE_START.test(trimmed)) return '';
    return trimmed;
  }
  return '';
}

/**
 * Could this line be "Title, Author"? A cheap pre-filter, not the real gate:
 * "dobra robota" passes this and is obviously not a book. What actually keeps a
 * stray mail off the front page is the caller confirming the title against the
 * book databases before committing (see resolveHeader in ../metadata.mjs).
 * This just avoids spending API calls on links, prose and mail furniture.
 *
 * Note what is *not* tested: sentence-shaped text. "Wiedźmin. Ostatnie
 * życzenie, A. Sapkowski" is exactly the club's house style, dots and all.
 */
function looksLikeBookLine(line) {
  if (!line || line.length > 100) return false;
  if (!/\p{L}/u.test(line)) return false;
  if (/https?:\/\/|www\.|@\S+\./i.test(line)) return false;
  if (/[!?]/.test(line)) return false; // a question or an exclamation is a message, not a title
  return line.split(/\s+/).length <= 12; // the club's longest title + author is seven words
}

/**
 * Turn an email body into the next-meeting fields, or null when the mail isn't
 * one of these at all (empty, a link, a paragraph of prose).
 *
 * Returns `{ title, author, date, time, ambiguous, candidates, warnings }`.
 * `date`/`time` are null unless the line carried them; `candidates` are the
 * readings for the caller to confirm against a book database when the comma
 * split is a coin toss (see resolveHeader in ../metadata.mjs).
 */
export function parseNextBookEmail(body) {
  const line = firstBodyLine(htmlToText(body));
  if (!looksLikeBookLine(line)) return null;

  // A trailing "…, 25/08/26 18:00" is meeting metadata; anything else on the
  // far side of the last comma is part of the author.
  let rest = line;
  let when = null;
  const lastComma = line.lastIndexOf(',');
  if (lastComma > 0) {
    const parsed = parseWhen(line.slice(lastComma + 1));
    if (parsed) {
      when = parsed;
      rest = line.slice(0, lastComma).trim();
    }
  }
  if (!rest) return null;

  const split = splitTitleAuthor([rest]);
  if (!split.title) return null;

  return {
    title: split.title,
    author: split.author,
    date: when?.date ?? null,
    time: when?.time ?? null,
    ambiguous: !!split.ambiguous,
    candidates: split.candidates || [],
    warnings: split.warnings || [],
  };
}

/**
 * Every reading of the line worth asking a book database about, best first: the
 * split we settled on, then the alternatives the comma logic ranked.
 *
 * Confirming one of these is what actually authorises the change — an email
 * saying "dobra robota" parses into a perfectly well-formed title, and only the
 * database can tell us it isn't a book.
 */
export function readingsFor(parsed) {
  const out = [];
  // The title on its own goes last: Google Books is rate-limited without a key,
  // and Open Library — the fallback — often knows a Polish edition by title
  // while filing it under a differently-spelled author. Asking author-first
  // keeps the precise answer preferred, and this rescues the rest.
  const readings = [
    { title: parsed.title, author: parsed.author },
    ...(parsed.candidates || []),
    { title: parsed.title, author: null },
  ];
  for (const c of readings) {
    if (!c.title) continue;
    if (out.some((o) => o.title === c.title && o.author === (c.author || null))) continue;
    out.push({ title: c.title, author: c.author || null });
  }
  return out;
}

/**
 * Must a book database confirm this line before it may change the site?
 *
 * Yes when the line names only one thing ("dobra robota" is a well-formed title
 * and not a book) or when the comma split was a coin toss. No when the sender
 * clearly wrote a title *and* an author: that is already a deliberate act, and
 * refusing it would mean an unlucky rate-limit day silently swallows the mail.
 */
export function requiresConfirmation(parsed) {
  return !parsed.author || parsed.ambiguous;
}

/* ------------------------------ the record ----------------------------- */

/**
 * Merge a parsed email into the stored card. Fields the mail didn't mention
 * keep sensible values rather than being blanked: the time carries over from
 * the previous meeting, and the date advances from the scheduled date.
 */
export function buildNextMeeting({ title, author, date, time, availability, cover }, previous = {}, now = new Date()) {
  return {
    title,
    author: author || null,
    cover: cover || slugify(title),
    date: date || defaultMeetingDate(previous),
    time: time || previous.time || DEFAULT_TIME,
    checkedAt: availability ? todayInWarsaw(now).toISOString().slice(0, 10) : (previous.checkedAt ?? null),
    availability: availability || previous.availability || {},
  };
}

/** Same compact, hand-editable style as books.json. */
export function serializeNextMeeting(entry) {
  const providers = PROVIDER_IDS.filter((id) => entry.availability?.[id]).map((id) => {
    const { available, url } = entry.availability[id];
    return `    ${JSON.stringify(id)}: { "available": ${available === null ? 'null' : available}, "url": ${JSON.stringify(url || null)} }`;
  });

  return (
    [
      '{',
      `  "title": ${JSON.stringify(entry.title)},`,
      `  "author": ${entry.author == null ? 'null' : JSON.stringify(entry.author)},`,
      `  "cover": ${JSON.stringify(entry.cover)},`,
      `  "date": ${JSON.stringify(entry.date)},`,
      `  "time": ${JSON.stringify(entry.time)},`,
      `  "checkedAt": ${entry.checkedAt == null ? 'null' : JSON.stringify(entry.checkedAt)},`,
      '  "availability": {',
      providers.join(',\n'),
      '  }',
      '}',
    ].join('\n') + '\n'
  );
}
