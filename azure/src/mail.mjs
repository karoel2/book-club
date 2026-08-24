// What both mail-driven functions need to know about the message that woke
// them: who sent it, and whether we are willing to listen.
//
// The Logic App forwards every mail it sees; the sender allowlist is enforced
// here rather than in the workflow, so the rule lives in one place and can be
// changed with an app setting instead of a redeploy.

/** Outlook/Gmail send "from" as a plain address or an object — normalise it. */
export function extractFrom(from) {
  if (!from) return '';
  if (typeof from === 'string') return from;
  return from.emailAddress?.address || from.address || from.email || JSON.stringify(from);
}

/** True when ALLOWED_SENDERS is unset (no allowlist) or the sender is on it. */
export function allowedSender(from) {
  const allow = (process.env.ALLOWED_SENDERS || '')
    .toLowerCase()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allow.length) return true; // no allowlist configured
  const addr = String(from || '').toLowerCase();
  return allow.some((a) => addr.includes(a));
}

/** The shared-secret header the Logic App sends. Returns null when it checks out. */
export function unauthorized(request) {
  const secret = process.env.INGEST_SECRET;
  if (secret && request.headers.get('x-ingest-secret') !== secret) {
    return { status: 401, jsonBody: { error: 'unauthorized' } };
  }
  return null;
}
