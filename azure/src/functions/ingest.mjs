// HTTP-triggered serverless ingest. A Logic App (email trigger) POSTs an email
// attachment here; we OCR it, parse scores, enrich metadata, and commit the
// result to GitHub — which fires the existing Pages build.
//
// Body: { contentBase64: string, filename?: string, from?: string|object,
//         dryRun?: boolean, text?: string }
//   - dryRun (or ?dry=1): OCR + parse only, return the result, commit nothing.
//   - text: skip OCR and parse this text directly (test parsing without Vision).
// Auth: function key (?code=) + a shared secret header + optional sender allowlist.
import { app } from '@azure/functions';
import { parseBlocks, finalizeBook, buildRoster, slugify, serializeBooks, applyHeaderResolution } from '../shared/parse.mjs';
import { fetchMetadata, pickBestCover, resolveHeader } from '../shared/metadata.mjs';
import { fetchMetadataWithFallback } from '../shared/metadata.mjs';
import { ocrImage } from '../ocr.mjs';
import { loadBooksJson, commitChanges } from '../github.mjs';
import { extractFrom, allowedSender, unauthorized } from '../mail.mjs';

// A human-readable outcome for the confirmation email. Built here rather than in
// Logic App expressions, which have no good way to format a list of notes.
function buildSummary({ added, review, skipped, commit, filename }) {
  const lines = [];
  if (added.length) lines.push(`✅ Dodano: ${added.join(', ')}`);
  for (const r of review) lines.push(`⚠️ Do przeglądu: „${r.title}" — ${r.notes.join('; ')}`);
  if (skipped.length) lines.push(`↩️ Już na stronie: ${skipped.join(', ')}`);
  if (!lines.length) lines.push('Nie rozpoznano żadnych ocen na tym zrzucie.');
  if (commit) lines.push('', `Commit: ${String(commit).slice(0, 7)}`);
  lines.push('', `(${filename})`);
  return lines.join('\n');
}

app.http('ingest', {
  methods: ['POST'],
  authLevel: 'function',
  handler: async (request, context) => {
    const denied = unauthorized(request);
    if (denied) return denied;

    const body = await request.json().catch(() => ({}));
    const dryRun = body.dryRun === true || request.query.get('dry') === '1';
    const from = extractFrom(body.from);
    const filename = body.filename || 'screenshot.jpg';

    if (!allowedSender(from)) return { status: 403, jsonBody: { error: 'sender not allowed', from } };

    // OCR the image, or use provided text to test parsing without a Vision key.
    let text;
    if (typeof body.text === 'string' && body.text.trim()) {
      text = body.text;
    } else {
      if (!body.contentBase64) return { status: 400, jsonBody: { error: 'missing contentBase64' } };
      try {
        text = await ocrImage(Buffer.from(body.contentBase64, 'base64'));
      } catch (e) {
        context.error(`OCR failed: ${e.message}`);
        return { status: 502, jsonBody: { error: 'ocr_failed', detail: e.message } };
      }
    }

    let books;
    try {
      books = await loadBooksJson();
    } catch (e) {
      context.error(`GitHub read failed: ${e.message}`);
      return { status: 502, jsonBody: { error: 'github_read_failed', detail: e.message } };
    }

    const roster = buildRoster(books);
    const existing = new Set(books.map((b) => slugify(b.title)));
    const parsed = parseBlocks(text).map((b) => finalizeBook(b, roster, false));
    context.log(`ingest ${filename} from "${from}": ocrChars=${text.length} blocks=${parsed.length} dryRun=${dryRun}`);

    // An ambiguous "A, B" header used to go straight to review. Instead, ask the
    // book databases which reading actually exists — a title that merely contains
    // a comma resolves to itself, so it no longer costs a human's attention.
    for (const p of parsed) {
      if (!p.ambiguous || !p.blocking.length) continue;
      let hit = null;
      try {
        hit = await resolveHeader(p.candidates);
      } catch (e) {
        // Google Books over its daily quota with nothing from Open Library is
        // the one failure resolveHeader reports: no reading was really checked.
        // The header stays ambiguous and goes to review, the way it did before
        // we asked at all — one unchecked header must not fail the whole mail.
        // Anything else is a bug in the lookup, and silently sending every book
        // to review would hide it.
        if (!e?.quota) throw e;
        context.warn(`ingest: header lookup hit the Google Books quota: ${e.message}`);
      }
      if (!hit) continue;
      applyHeaderResolution(p, hit);
      p.resolvedMeta = hit.meta; // reuse below; don't fetch the same book twice
      context.log(`resolved header → title="${hit.title}" author="${hit.author || '—'}"`);
    }

    if (dryRun) {
      return {
        status: 200,
        jsonBody: {
          dryRun: true,
          from,
          ocrText: text,
          blockCount: parsed.length,
          parsed: parsed.map((p) => ({
            title: p.entry.title,
            author: p.entry.author,
            scores: p.entry.scores,
            slug: p.slug,
            exists: existing.has(p.slug),
            resolved: !!p.resolvedMeta,
            ocrAverage: p.ocrAverage,
            computedAverage: p.computedAverage,
            blocking: p.blocking,
            notes: p.notes,
          })),
        },
      };
    }

    const added = [];
    const review = [];
    const skipped = [];
    const coverFiles = [];

    for (const p of parsed) {
      if (existing.has(p.slug)) { skipped.push(p.entry.title); continue; }
      if (p.blocking.length) { review.push({ title: p.entry.title, notes: p.notes }); continue; }

      if (p.resolvedMeta || p.entry.author) {
        try {
          const meta = p.resolvedMeta || (await fetchMetadataWithFallback(p.entry.title, p.entry.author, p.entry.originalTitle));
          if (meta) {
            if (meta.description) p.entry.description = meta.description;
            if (meta.categories?.length) p.entry.categories = meta.categories;
            if (meta.coverUrls?.length) {
              const cover = await pickBestCover(meta.coverUrls);
              if (cover) coverFiles.push({ path: `src/assets/covers/${p.slug}.${cover.ext}`, buf: cover.buf });
            }
            if (meta.fallbackUsed) {
              context.log(`fallback dla „${p.entry.title}”: oryginalny tytuł „${meta.fallbackOriginalTitle}”, wynik ${meta.fallbackOutcome}`);
            }
          }
        } catch (e) {
          context.warn(`enrich failed for "${p.entry.title}": ${e.message}`);
        }
      }

      books.push(p.entry);
      existing.add(p.slug);
      added.push(p.entry.title);
    }

    let commit = null;
    if (added.length) {
      const files = [{ path: 'src/data/books.json', content: serializeBooks(books) }];
      for (const c of coverFiles) files.push({ path: c.path, buf: c.buf });
      try {
        commit = await commitChanges(files, `Dodano: ${added.join(', ')} (email ingest)`);
      } catch (e) {
        context.error(`GitHub commit failed: ${e.message}`);
        return { status: 502, jsonBody: { error: 'github_commit_failed', detail: e.message, added } };
      }
    }

    context.log(`ingest result: added=${added.length} review=${review.length} skipped=${skipped.length}`);
    const summary = buildSummary({ added, review, skipped, commit, filename });
    return {
      status: 200,
      // summaryHtml so the Logic App can drop it straight into the mail body —
      // the Outlook connector renders Body as HTML and would eat the newlines.
      jsonBody: { added, review, skipped, commit, summary, summaryHtml: summary.replace(/\n/g, '<br>') },
    };
  },
});
