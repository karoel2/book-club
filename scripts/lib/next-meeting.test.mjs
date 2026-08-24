import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNextBookEmail,
  parseWhen,
  defaultMeetingDate,
  firstBodyLine,
  htmlToText,
  buildNextMeeting,
  serializeNextMeeting,
} from './next-meeting.mjs';

/* ----------------------------- the book line ---------------------------- */

test('splits "Tytuł, Autor"', () => {
  const r = parseNextBookEmail('Problem trzech ciał, Cixin Liu');
  assert.equal(r.title, 'Problem trzech ciał');
  assert.equal(r.author, 'Cixin Liu');
  assert.equal(r.date, null);
  assert.equal(r.time, null);
});

test('an initial marks the author whichever side it is on', () => {
  assert.deepEqual(
    (({ title, author }) => ({ title, author }))(parseNextBookEmail('Worek Kości, S. King')),
    { title: 'Worek Kości', author: 'S. King' },
  );
  assert.deepEqual(
    (({ title, author }) => ({ title, author }))(parseNextBookEmail('S. King, Worek Kości')),
    { title: 'Worek Kości', author: 'S. King' },
  );
});

test('a comma inside the title does not become an author', () => {
  const r = parseNextBookEmail('Dziki, mroczny brzeg, C. McConaghy');
  assert.equal(r.title, 'Dziki, mroczny brzeg');
  assert.equal(r.author, 'C. McConaghy');
});

test('an undecidable split is flagged, not guessed', () => {
  const r = parseNextBookEmail('Wyznania, Kanae Minato');
  assert.equal(r.ambiguous, true);
  assert.ok(r.candidates.some((c) => c.title === 'Wyznania' && c.author === 'Kanae Minato'));
});

test('a title alone is accepted', () => {
  const r = parseNextBookEmail('Achaja');
  assert.equal(r.title, 'Achaja');
  assert.equal(r.author, null);
});

test('a dotted title survives — the club writes them that way', () => {
  const r = parseNextBookEmail('Wiedźmin. Ostatnie życzenie, A. Sapkowski');
  assert.equal(r.title, 'Wiedźmin. Ostatnie życzenie');
  assert.equal(r.author, 'A. Sapkowski');
});

/* --------------------------- what to ignore ----------------------------- */

test('mail that is not a book line is ignored', () => {
  for (const body of [
    '',
    '   ',
    'Cześć, jak leci?',
    'https://www.storytel.com/pl/books/12416128',
    'Wysyłam wam zdjęcia z ostatniego spotkania, dajcie znać co myślicie o tej książce i kiedy',
  ]) {
    assert.equal(parseNextBookEmail(body), null, `should ignore: ${body}`);
  }
});

test('a quoted reply contributes nothing', () => {
  assert.equal(parseNextBookEmail('> Problem trzech ciał, Cixin Liu'), null);
  assert.equal(firstBodyLine('W dniu 2026-08-19 Karol napisał:\nProblem trzech ciał, Cixin Liu'), '');
});

/* ------------------------------ date & time ----------------------------- */

test('reads an optional trailing date and time', () => {
  const r = parseNextBookEmail('Problem trzech ciał, Cixin Liu, 25/08/26 18:00');
  assert.equal(r.title, 'Problem trzech ciał');
  assert.equal(r.author, 'Cixin Liu');
  assert.equal(r.date, '25/08/26');
  assert.equal(r.time, '18:00');
});

test('accepts the usual date spellings, and a bare time', () => {
  assert.deepEqual(parseWhen('2026-08-25'), { date: '25/08/26', time: null });
  assert.deepEqual(parseWhen('25.08.2026'), { date: '25/08/26', time: null });
  assert.deepEqual(parseWhen('19:30'), { date: null, time: '19:30' });
  assert.deepEqual(parseWhen('18:00 25/08/26'), { date: '25/08/26', time: '18:00' });
});

test('a two-word author is not mistaken for a date', () => {
  assert.equal(parseWhen('Cixin Liu'), null);
  assert.equal(parseWhen('32/13/26'), null);
  const r = parseNextBookEmail('Problem trzech ciał, Cixin Liu');
  assert.equal(r.author, 'Cixin Liu');
});

test('no date given: first meeting is fixed, then advances two Tuesdays', () => {
  assert.equal(defaultMeetingDate(), '25/08/26');
  assert.equal(defaultMeetingDate({ date: '25/08/26' }), '08/09/26');
  assert.equal(defaultMeetingDate({ date: '08/09/26' }), '22/09/26');
  assert.equal(defaultMeetingDate({ date: 'not-a-date' }), '25/08/26');
});

/* ------------------------------ the record ------------------------------ */

test('the html Outlook sends collapses to its first typed line', () => {
  const html = '<html><head><style>p{color:red}</style></head><body><p>Problem trzech cia&#x142;, Cixin Liu</p><p>dzi&#x119;ki!</p></body></html>';
  assert.equal(firstBodyLine(htmlToText(html)), 'Problem trzech ciał, Cixin Liu');
});

test('fields the mail left out keep their previous values', () => {
  const previous = { time: '19:00', checkedAt: '2026-01-01', availability: { storytel: { available: true, url: 'x' } } };
  const entry = buildNextMeeting({ title: 'Achaja', author: 'Ziemiański' }, previous, new Date('2026-08-19T09:00:00Z'));
  assert.equal(entry.time, '19:00');
  assert.equal(entry.date, '25/08/26');
  assert.equal(entry.cover, 'achaja');
  assert.deepEqual(entry.availability, previous.availability);
});

test('serialises to valid, re-readable JSON', () => {
  const entry = buildNextMeeting(
    {
      title: 'Problem trzech ciał',
      author: 'Cixin Liu',
      date: '25/08/26',
      time: '18:00',
      availability: {
        storytel: { available: true, url: 'https://example.test/1' },
        legimi: { available: null, url: 'https://example.test/2' },
      },
    },
    {},
    new Date('2026-08-19T09:00:00Z'),
  );
  const round = JSON.parse(serializeNextMeeting(entry));
  assert.equal(round.title, 'Problem trzech ciał');
  assert.equal(round.checkedAt, '2026-08-19');
  assert.equal(round.availability.storytel.available, true);
  assert.equal(round.availability.legimi.available, null);
});
