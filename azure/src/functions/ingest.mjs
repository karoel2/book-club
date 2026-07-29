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
import { parseBlocks, finalizeBook, buildRoster, slugify, serializeBooks } from '../shared/parse.mjs';
import { fetchMetadata, pickBestCover } from '../shared/metadata.mjs';
import { ocrImage } from '../ocr.mjs';
import { loadBooksJson, commitChanges } from '../github.mjs';

// Outlook/Gmail send "from" as a plain address or an object — normalise it.
function extractFrom(from) {
  if (!from) return '';
  if (typeof from === 'string') return from;
  return from.emailAddress?.address || from.address || from.email || JSON.stringify(from);
}

function allowedSender(from) {
  const allow = (process.env.ALLOWED_SENDERS || '')
    .toLowerCase()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allow.length) return true; // no allowlist configured
  const addr = String(from || '').toLowerCase();
  return allow.some((a) => addr.includes(a));
}

app.http('ingest', {
  methods: ['POST'],
  authLevel: 'function',
  handler: async (request, context) => {
    const secret = process.env.INGEST_SECRET;
    if (secret && request.headers.get('x-ingest-secret') !== secret) {
      return { status: 401, jsonBody: { error: 'unauthorized' } };
    }

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

      if (p.entry.author) {
        try {
          const meta = await fetchMetadata(p.entry.title, p.entry.author);
          if (meta) {
            if (meta.description) p.entry.description = meta.description;
            if (meta.categories?.length) p.entry.categories = meta.categories;
            if (meta.coverUrls?.length) {
              const cover = await pickBestCover(meta.coverUrls);
              if (cover) coverFiles.push({ path: `src/assets/covers/${p.slug}.${cover.ext}`, buf: cover.buf });
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
    return { status: 200, jsonBody: { added, review, skipped, commit } };
  },
});
