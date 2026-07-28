// OCR via Azure AI Vision "Image Analysis 4.0" READ feature (synchronous).
// Returns the recognised text as newline-joined lines — the same shape the
// local ocr.swift produces — so it feeds straight into parseBlocks().
//
// Docs: POST {endpoint}/computervision/imageanalysis:analyze?features=read
// No language code is sent; the universal model auto-detects (handles Polish).

export async function ocrImage(imageBytes) {
  const endpoint = (process.env.VISION_ENDPOINT || '').replace(/\/$/, '');
  const key = process.env.VISION_KEY;
  if (!endpoint || !key) throw new Error('VISION_ENDPOINT / VISION_KEY not configured');

  const url = `${endpoint}/computervision/imageanalysis:analyze?api-version=2024-02-01&features=read`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': 'application/octet-stream',
    },
    body: imageBytes,
  });
  if (!r.ok) throw new Error(`Vision HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);

  const data = await r.json();
  const blocks = data.readResult?.blocks || [];
  const lines = [];
  for (const b of blocks) for (const l of b.lines || []) lines.push(l.text);
  return lines.join('\n');
}
