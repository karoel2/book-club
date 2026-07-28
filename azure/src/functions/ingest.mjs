// HTTP-triggered serverless ingest. A Logic App (Gmail trigger) POSTs an email
// attachment here; we OCR it, parse scores, enrich metadata, and commit the
// result to GitHub — which fires the existing Pages build.
//
// Body: { contentBase64: string, filename?: string, from?: string }
// Auth: function key (?code=) + a shared secret header + optional sender allowlist.
import { app } from '@azure/functions';
import { parseBlocks, finalizeBook, buildRoster, slugify, serializeBooks } from '../shared/parse.mjs';
import { fetchMetadata, pickBestCover } from '../shared/metadata.mjs';
import { ocrImage } from '../ocr.mjs';
import { loadBooksJson, commitChanges } from '../github.mjs';

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
    const { contentBase64, filename = 'screenshot.jpg', from = '' } = body;
    if (!allowedSender(from)) return { status: 403, jsonBody: { error: 'sender not allowed', from } };
    if (!contentBase64) return { status: 400, jsonBody: { error: 'missing contentBase64' } };

    const imageBytes = Buffer.from(contentBase64, 'base64');

    let text;
    try {
      text = await ocrImage(imageBytes);
    } catch (e) {
      context.error(`OCR failed: ${e.message}`);
      return { status: 502, jsonBody: { error: 'ocr_failed', detail: e.message } };
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

    context.log(`ingest ${filename} from ${from}: added=${added.length} review=${review.length} skipped=${skipped.length}`);
    return { status: 200, jsonBody: { added, review, skipped, commit } };
  },
});
