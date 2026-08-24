// HTTP-triggered "what are we reading next". A Logic App (email trigger) POSTs
// the body of each incoming mail here; a mail whose first line reads
//
//     Problem trzech ciał, Cixin Liu
//     Problem trzech ciał, Cixin Liu, 25/08/26 18:00
//
// sets the next-meeting card: we confirm the book exists, ask the five services
// whether it can be listened to or borrowed, fetch a cover, and commit
// src/data/next-meeting.json — which fires the existing Pages build.
//
// Body: { body?: string, text?: string, subject?: string, from?: string|object,
//         hasAttachments?: boolean|string, dryRun?: boolean }
//   - hasAttachments: mails carrying a screenshot belong to /api/ingest, and
//     are ignored here so one mail can't do both.
//   - dryRun (or ?dry=1): parse + check, return the result, commit nothing.
// Auth: function key (?code=) + a shared secret header + optional sender allowlist.
import { app } from '@azure/functions';
import {
  parseNextBookEmail,
  buildNextMeeting,
  serializeNextMeeting,
  readingsFor,
  requiresConfirmation,
} from '../shared/next-meeting.mjs';
import { checkAvailability, formatAvailability, PROVIDERS } from '../shared/availability.mjs';
import { fetchMetadata, pickBestCover, resolveHeader } from '../shared/metadata.mjs';
import { slugify } from '../shared/parse.mjs';
import { loadJson, fileExists, commitChanges } from '../github.mjs';
import { extractFrom, allowedSender, unauthorized } from '../mail.mjs';

const DATA_PATH = 'src/data/next-meeting.json';
const COVER_EXT = ['jpg', 'jpeg', 'png', 'webp', 'avif'];

// Outlook sends hasAttachments as a real boolean, the Logic App expression
// language sometimes as the string "true".
const truthy = (v) => v === true || v === 'true' || v === 1;

/** The confirmation mail. Built here because Logic App expressions can't format a list. */
function buildSummary({ entry, warnings }) {
  const lines = [
    `📖 Następna książka: ${entry.title}${entry.author ? ` — ${entry.author}` : ''}`,
    `📅 Spotkanie: ${entry.date}, ${entry.time}`,
    `🎧 ${formatAvailability(entry.availability)}`,
  ];
  for (const w of warnings) lines.push(`⚠️ ${w}`);
  return lines.join('\n');
}

const reply = (jsonBody) => ({
  status: 200,
  // summaryHtml so the Logic App can drop it straight into the mail body — the
  // Outlook connector renders Body as HTML and would eat the newlines.
  jsonBody: { ...jsonBody, summaryHtml: (jsonBody.summary || '').replace(/\n/g, '<br>') },
});

app.http('next-book', {
  methods: ['POST'],
  authLevel: 'function',
  handler: async (request, context) => {
    const denied = unauthorized(request);
    if (denied) return denied;

    const body = await request.json().catch(() => ({}));
    const dryRun = body.dryRun === true || request.query.get('dry') === '1';
    const from = extractFrom(body.from);
    if (!allowedSender(from)) return { status: 403, jsonBody: { error: 'sender not allowed', from } };

    // A mail with a screenshot is a ratings mail; /api/ingest owns it. Without
    // this, a caption under the photo could quietly re-point the card.
    if (truthy(body.hasAttachments)) {
      return reply({ ignored: true, reason: 'attachment', summary: '' });
    }

    const parsed = parseNextBookEmail(body.body ?? body.text ?? '');
    if (!parsed) {
      // Not a book line at all (empty, a link, a paragraph). Say nothing: this
      // runs on *every* mail, and an "I didn't understand" reply to each one
      // would train everybody to ignore the confirmations that do matter.
      context.log(`next-book: ignored mail from "${from}" — not a book line`);
      return reply({ ignored: true, reason: 'not a book line', summary: '' });
    }

    const warnings = [...parsed.warnings];
    let { title, author, date, time } = parsed;
    let meta = null;

    // Ask the book databases which reading is real. For a line that named both
    // a title and an author this only corrects the split; for anything vaguer
    // it is the gate — "dobra robota" parses fine and is not a book.
    try {
      const hit = await resolveHeader(readingsFor(parsed));
      if (hit) {
        title = hit.title;
        // A title-only reading is often the one that confirms (Open Library
        // files Polish editions under a differently-spelled author). That the
        // book is real doesn't mean the sender's author was wrong.
        author = hit.author || author;
        meta = hit.meta;
      } else if (requiresConfirmation(parsed)) {
        context.log(`next-book: refused "${title}" — not found in any book database`);
        return reply({
          refused: true,
          title,
          summary:
            `⚠️ Nie rozpoznałem książki „${title}".\n` +
            'Wyślij ją jako „Tytuł, Autor" — bez autora nie mam jak sprawdzić, czy to książka.',
        });
      } else {
        warnings.push('Nie znalazłem tej książki w Google Books ani Open Library — zapisuję tak, jak w mailu.');
      }
    } catch (e) {
      context.warn(`next-book: header resolution failed: ${e.message}`);
      if (requiresConfirmation(parsed)) {
        return reply({ refused: true, title, summary: `⚠️ Nie udało się sprawdzić „${title}": ${e.message}` });
      }
    }

    let previous;
    try {
      previous = await loadJson(DATA_PATH, {});
    } catch (e) {
      context.error(`GitHub read failed: ${e.message}`);
      return { status: 502, jsonBody: { error: 'github_read_failed', detail: e.message } };
    }

    // Re-sending the same book is a no-op, the way re-sending a screenshot is —
    // the trigger polls, and a mail can be delivered twice. An explicit date or
    // time still counts as a change worth committing.
    if (slugify(previous.title || '') === slugify(title) && !date && !time) {
      context.log(`next-book: "${title}" is already the next book — nothing to do`);
      return reply({
        unchanged: true,
        title,
        summary: `↩️ „${title}" już jest następną książką (spotkanie ${previous.date}, ${previous.time}).`,
      });
    }

    const availability = await checkAvailability(title, author);
    for (const { id, label } of PROVIDERS) {
      if (availability[id]?.error) warnings.push(`${label}: nie udało się sprawdzić (${availability[id].error})`);
    }

    const entry = buildNextMeeting({ title, author, date, time, availability }, previous);
    if (!date) warnings.push('Bez daty w mailu — ustawiłem za dwa tygodnie, we wtorek.');

    context.log(
      `next-book from "${from}": "${entry.title}" ${entry.date} ${entry.time} ` +
        `avail=${PROVIDERS.map((p) => `${p.id}:${availability[p.id]?.available}`).join(',')} dryRun=${dryRun}`,
    );

    if (dryRun) {
      return reply({ dryRun: true, from, entry, warnings, summary: buildSummary({ entry, warnings }) });
    }

    // A cover the repo already has stays put — this is the same slug-based
    // lookup src/components/BookCover.astro does at build time.
    const files = [{ path: DATA_PATH, content: serializeNextMeeting(entry) }];
    try {
      const existing = await Promise.all(COVER_EXT.map((ext) => fileExists(`src/assets/covers/${entry.cover}.${ext}`)));
      if (!existing.some(Boolean)) {
        const m = meta || (author ? await fetchMetadata(title, author) : null);
        const cover = m?.coverUrls?.length ? await pickBestCover(m.coverUrls) : null;
        if (cover) files.push({ path: `src/assets/covers/${entry.cover}.${cover.ext}`, buf: cover.buf });
      }
    } catch (e) {
      context.warn(`next-book: cover lookup failed for "${title}": ${e.message}`);
    }

    let commit;
    try {
      commit = await commitChanges(files, `Następne spotkanie: ${entry.title}`);
    } catch (e) {
      context.error(`GitHub commit failed: ${e.message}`);
      return { status: 502, jsonBody: { error: 'github_commit_failed', detail: e.message } };
    }

    const summary = `${buildSummary({ entry, warnings })}\n\nCommit: ${String(commit).slice(0, 7)}`;
    return reply({ updated: true, entry, warnings, commit, summary });
  },
});
