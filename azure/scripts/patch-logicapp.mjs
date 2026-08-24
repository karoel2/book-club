// Converge the live Outlook workflow onto the shape in ../logicapp.template.json:
// relax the mail trigger so ordinary phone mail fires it, and make sure the
// body of every mail also reaches the next-book function.
// Reads the live workflow JSON on stdin, writes the PUT body on stdout.
//
//   az rest --method get --uri "$API?api-version=2019-05-01" \
//     | node scripts/patch-logicapp.mjs > /tmp/body.json
//
// Idempotent: re-running on an already-patched workflow is a no-op.
import { readFileSync } from 'node:fs';

const wf = JSON.parse(readFileSync(0, 'utf8'));
const def = wf.properties.definition;
const note = (m) => process.stderr.write(`  ${m}\n`);

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
if (inputs.queries) {
  delete inputs.queries.subjectFilter;
  inputs.queries.fetchOnlyWithAttachment = false;
}

// splitOn is not optional. /v2/Mail/OnNewEmail answers {value:[…messages]}, so
// without it triggerBody()?['Attachments'] and ?['From'] are both null and every
// run fails on an empty foreach and an empty To. Editing the workflow in the
// Designer drops it silently — which is how it went missing here.
const trigger = def.triggers[triggerName];
if (!trigger.splitOn && /OnNewEmail/i.test(inputs.path || '')) {
  trigger.splitOn = "@triggerBody()?['value']";
  note('restored splitOn on the mail trigger');
}

// Inside a Foreach, @item() is the whole attachment object — the name lives on ?['Name'].
for (const action of Object.values(def.actions)) {
  if (action.type !== 'Foreach') continue;
  const each = Object.keys(def.actions).find((k) => def.actions[k] === action);
  // A mail with no attachment yields null, and Foreach over null is a run
  // failure — which is every next-book mail, since those carry no attachment.
  if (!/coalesce/.test(action.foreach || '')) {
    action.foreach = "@coalesce(triggerBody()?['Attachments'], json('[]'))";
  }
  for (const inner of Object.values(action.actions || {})) {
    const body = inner.inputs?.body;
    if (body && 'filename' in body) body.filename = `@items('${each}')?['Name']`;
  }
}

/* ------------------------- the next-book branch ------------------------- */

// A workflow deployed before next-book existed only knows about attachments.
// Graft the second job on rather than making anyone rebuild from the template.
const foreachName = Object.keys(def.actions).find((k) => def.actions[k].type === 'Foreach');
const ingestCall = foreachName
  ? Object.values(def.actions[foreachName].actions || {}).find(
      (a) => a.type === 'Function' && /\/functions\/ingest$/i.test(a.inputs?.function?.id || ''),
    )
  : null;

if (!ingestCall) {
  note('no Function-type ingest call found — skipping the next-book branch (rebuild from logicapp.template.json)');
} else {
  // Each piece below is checked on its own. An earlier run may have added the
  // call without the summary chain, and a Designer edit may have removed either.
  if (def.actions.Call_next_book) {
    note('Call_next_book already present');
  } else {
    const nextBookId = ingestCall.inputs.function.id.replace(/\/functions\/ingest$/i, '/functions/next-book');

    // In sequence after the attachments, never beside them: both jobs append to
    // the one `summary` variable, and parallel branches would race it.
    def.actions.Call_next_book = {
      type: 'Function',
      runAfter: { [foreachName]: ['Succeeded', 'Failed'] },
      inputs: {
        function: { id: nextBookId },
        method: 'POST',
        headers: ingestCall.inputs.headers,
        body: {
          // Body is the HTML one; BodyPreview is the plain-text fallback for the
          // rare mail that has no HTML part at all.
          body: "@coalesce(triggerBody()?['Body'], triggerBody()?['BodyPreview'], '')",
          subject: "@triggerBody()?['Subject']",
          from: "@triggerBody()?['From']",
          hasAttachments: "@greater(length(coalesce(triggerBody()?['Attachments'], json('[]'))), 0)",
        },
      },
    };
    note(`added Call_next_book -> ${nextBookId.split('/').slice(-3).join('/')}`);
  }
  // The confirmation mail: one reply per message, covering both jobs.
  //
  // Rebuilding the workflow in the Designer drops this whole chain, so build it
  // when it is missing rather than only appending to it. Both jobs write to one
  // `summary` variable, which is why they run in sequence and not in parallel.
  const foreachActions = def.actions[foreachName].actions || {};
  let appender = Object.values(foreachActions).find((a) => a.type === 'AppendToStringVariable');
  const VAR = appender?.inputs?.name || 'summary';

  if (!appender) {
    const ingestName = Object.keys(foreachActions).find((k) => foreachActions[k] === ingestCall);
    def.actions.Init_summary = {
      type: 'InitializeVariable',
      runAfter: {},
      inputs: { variables: [{ name: VAR, type: 'String', value: '' }] },
    };
    def.actions[foreachName].runAfter = { Init_summary: ['Succeeded'] };
    foreachActions.Append_result = {
      type: 'AppendToStringVariable',
      runAfter: { [ingestName]: ['Succeeded'] },
      inputs: { name: VAR, value: `@{body('${ingestName}')?['summaryHtml']}<br><br>` },
    };
    note(`rebuilt the summary variable and the ingest append (after '${ingestName}')`);
  }

  // Most mail is not a next-book mail: the function answers with an empty
  // summary, and this must then add nothing at all rather than a blank paragraph.
  def.actions.Append_next_book = {
    type: 'AppendToStringVariable',
    runAfter: { Call_next_book: ['Succeeded', 'Failed'] },
    inputs: {
      name: VAR,
      value:
        "@{if(empty(coalesce(body('Call_next_book')?['summaryHtml'], '')), '', " +
        "concat(body('Call_next_book')?['summaryHtml'], '<br><br>'))}",
    },
  };
  let last = 'Append_next_book';

  // Send, never reply: every Reply path returns NotFound on the Outlook.com
  // connector. Runs after Failed too — a failed ingest is exactly when you want
  // telling — and reuses the trigger's own mail connection.
  const sends = Object.values(def.actions).some((a) => a.type === 'ApiConnection' && /\/Mail/i.test(a.inputs?.path || ''));
  if (!sends) {
    def.actions.Send_summary = {
      type: 'ApiConnection',
      runAfter: { Append_next_book: ['Succeeded', 'Failed'] },
      inputs: {
        host: { connection: { name: inputs.host.connection.name } },
        method: 'post',
        path: '/v2/Mail',
        body: {
          To: "@triggerBody()?['From']",
          Subject:
            "@{if(empty(trim(coalesce(triggerBody()?['Subject'], ''))), 'Klub Książki', concat('Re: ', triggerBody()?['Subject']))}",
          Body: `@{if(empty(variables('${VAR}')), 'Nie rozpoznałem nic w tej wiadomości — załącz zrzut z ocenami albo napisz „Tytuł, Autor”.', variables('${VAR}'))}`,
          Importance: 'Normal',
        },
      },
    };
    note("rebuilt Send_summary (POST /v2/Mail on the trigger's connection)");
  }

  // Whatever used to wait for the attachments (Send_summary) now waits for the
  // end of the new chain instead, or it would mail before we had an answer.
  for (const [name, action] of Object.entries(def.actions)) {
    if (['Call_next_book', 'Append_next_book', 'Send_summary', 'Init_summary'].includes(name)) continue;
    if (!action.runAfter?.[foreachName]) continue;
    delete action.runAfter[foreachName];
    action.runAfter[last] = ['Succeeded', 'Failed'];
  }
}

process.stdout.write(JSON.stringify({
  location: wf.location,
  properties: { state: wf.properties.state, definition: def, parameters: wf.properties.parameters },
}));
