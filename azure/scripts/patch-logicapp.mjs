// Relax the Outlook mail trigger so ordinary phone mail actually fires it.
// Reads the live workflow JSON on stdin, writes the PUT body on stdout.
//
//   az rest --method get --uri "$API?api-version=2019-05-01" \
//     | node scripts/patch-logicapp.mjs > /tmp/body.json
//
// Idempotent: re-running on an already-patched workflow is a no-op.
import { readFileSync } from 'node:fs';

const wf = JSON.parse(readFileSync(0, 'utf8'));
const def = wf.properties.definition;

const triggerName = Object.keys(def.triggers).find((n) => /new_email_arrives/i.test(n));
if (!triggerName) throw new Error(`no mail trigger in: ${Object.keys(def.triggers).join(', ')}`);
const inputs = def.triggers[triggerName].inputs;

// `fetch` and `subscribe` must agree on every shared property name, or the
// workflow fails validation with WorkflowTriggerInputsPropertyInvalid.
for (const section of ['fetch', 'subscribe']) {
  const q = inputs[section]?.queries;
  if (!q) continue;
  delete q.subjectFilter;            // a subject filter silently skips every other mail
  q.fetchOnlyWithAttachment = false; // phones often embed the screenshot inline
}

// Inside a Foreach, @item() is the whole attachment object — the name lives on ?['Name'].
for (const action of Object.values(def.actions)) {
  if (action.type !== 'Foreach') continue;
  const each = Object.keys(def.actions).find((k) => def.actions[k] === action);
  for (const inner of Object.values(action.actions || {})) {
    const body = inner.inputs?.body;
    if (body && 'filename' in body) body.filename = `@items('${each}')?['Name']`;
  }
}

process.stdout.write(JSON.stringify({
  location: wf.location,
  properties: { state: wf.properties.state, definition: def, parameters: wf.properties.parameters },
}));
