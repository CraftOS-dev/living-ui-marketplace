/// <reference path="../pb_data/types.d.ts" />
/**
 * AGENT HOOKS — custom verbs beyond CRUD live here (spec B3/D4).
 * Every route here must have a matching entry in operations.json (the gate
 * enforces it) so any agent can discover it via GET /api/_ops.
 *
 * NOTE: routerAdd handlers run in ISOLATED contexts — helpers must be
 * defined inside the handler (or require()d), never top-level.
 */

// READING A REQUEST BODY — the ONLY correct way in PB hooks:
//   const data = e.requestInfo().body;   // pre-parsed object
// NEVER use e.request.body / toString(e.request.body): that is a Go stream
// and reads as EMPTY, so your param checks will 400 on every request.

// emails.send — send an email through the CraftBot Gmail integration when
// available; otherwise log it locally (status 'logged'). Always writes an
// emails row so the record's Emails tab is the source of truth.
routerAdd('POST', '/api/ops/emails/send', (e) => {
  const bridge = require(`${__hooks}/_craftbot_bridge.js`);
  const body = e.requestInfo().body || {};
  const to = String(body.to || '').trim();
  const subject = String(body.subject || '').trim();
  const text = String(body.body || '');
  const personId = String(body.person_id || '');
  if (to === '' || subject === '') {
    return e.json(400, { error: 'to and subject are required' });
  }

  // Minimal base64url encoder (Goja has no btoa/Buffer).
  const b64url = (input) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const bytes = [];
    for (let i = 0; i < input.length; i++) {
      const code = input.charCodeAt(i);
      if (code < 128) bytes.push(code);
      else if (code < 2048) bytes.push(192 | (code >> 6), 128 | (code & 63));
      else bytes.push(224 | (code >> 12), 128 | ((code >> 6) & 63), 128 | (code & 63));
    }
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const [a, b, c] = [bytes[i], bytes[i + 1], bytes[i + 2]];
      out += chars[a >> 2] + chars[((a & 3) << 4) | ((b || 0) >> 4)];
      out += b === undefined ? '=' : chars[((b & 15) << 2) | ((c || 0) >> 6)];
      out += c === undefined ? '=' : chars[c & 63];
    }
    return out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  const mime =
    'To: ' + to + '\r\nSubject: ' + subject +
    '\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n' + text;
  let status = 'logged';
  let detail = 'CraftBot Gmail integration unavailable — recorded locally';
  try {
    const res = bridge.callIntegration(
      'gmail',
      'POST',
      '/gmail/v1/users/me/messages/send',
      { raw: b64url(mime) },
    );
    if (res && res.status >= 200 && res.status < 300) {
      status = 'sent';
      detail = '';
    } else if (res && res.error) {
      detail = String(res.error).slice(0, 400);
    }
  } catch (err) {
    detail = String(err).slice(0, 400);
  }

  const collection = e.app.findCollectionByNameOrId('emails');
  const record = new Record(collection);
  record.set('to', to);
  record.set('subject', subject);
  record.set('body', text);
  record.set('status', status);
  record.set('detail', detail);
  if (personId !== '') record.set('person', personId);
  e.app.save(record);
  return e.json(200, { status: status, detail: detail });
});

// ai.chat — CRM assistant chat turn via the LLM bridge. The client keeps
// the conversation; each call sends recent history plus live CRM context.
routerAdd('POST', '/api/ops/ai/chat', (e) => {
  const bridge = require(`${__hooks}/_craftbot_bridge.js`);
  const body = e.requestInfo().body || {};
  const message = String(body.message || '').trim();
  const history = Array.isArray(body.history) ? body.history.slice(-10) : [];
  if (message === '') return e.json(400, { error: 'message is required' });

  const stages = e.app.findRecordsByFilter('stages', "id != ''", 'order', 0, 0);
  const deals = e.app.findRecordsByFilter('deals', "id != ''", '', 0, 0);
  const context = stages
    .map((stage) => {
      const inStage = deals.filter((d) => d.get('stage') === stage.id);
      let total = 0;
      for (const d of inStage) total += Number(d.get('value') || 0);
      return stage.get('name') + ': ' + inStage.length + ' deals, $' + total;
    })
    .join('; ');
  const people = e.app.findRecordsByFilter('people', "id != ''", '', 0, 0);
  const tasks = e.app.findRecordsByFilter('tasks', 'done = false', '', 0, 0);

  const transcript = history
    .map((turn) => (turn.role === 'user' ? 'User: ' : 'Assistant: ') + String(turn.content))
    .join('\n');
  const reply = bridge.callLLM(
    'CRM snapshot — pipeline: ' + context +
      '. Contacts: ' + people.length + '. Open tasks: ' + tasks.length + '.\n\n' +
      (transcript !== '' ? transcript + '\n' : '') + 'User: ' + message,
    'You are the CRM assistant. Answer using the snapshot; be brief and actionable.',
  );
  if (!reply) {
    return e.json(503, { error: 'AI is unavailable (app not running inside CraftBot)' });
  }
  return e.json(200, { reply: reply });
});

// records.summarize — AI summary of a person/company/deal with its notes,
// tasks and activity (CraftBot LLM bridge; 503 outside CraftBot).
routerAdd('POST', '/api/ops/records/summarize', (e) => {
  const bridge = require(`${__hooks}/_craftbot_bridge.js`);
  const body = e.requestInfo().body || {};
  const kind = String(body.kind || '');
  const id = String(body.id || '');
  if (!['people', 'companies', 'deals'].includes(kind) || id === '') {
    return e.json(400, { error: 'kind (people|companies|deals) and id are required' });
  }
  let record;
  try {
    record = e.app.findRecordById(kind, id);
  } catch (_) {
    return e.json(404, { error: kind + ' record not found: ' + id });
  }
  const ref = kind === 'people' ? 'person' : kind === 'companies' ? 'company' : 'deal';
  const notes = e.app.findRecordsByFilter('notes', `${ref} = "${id}"`, '-created', 20, 0);
  const tasks = e.app.findRecordsByFilter('tasks', `${ref} = "${id}"`, '-created', 20, 0);
  const activities = e.app.findRecordsByFilter('activities', `${ref} = "${id}"`, '-created', 20, 0);
  const context = [
    'Record (' + kind + '): ' + JSON.stringify(record.publicExport()),
    'Notes: ' + notes.map((n) => '- ' + n.get('body')).join('\n'),
    'Tasks: ' + tasks.map((t) => '- [' + (t.get('done') ? 'x' : ' ') + '] ' + t.get('title')).join('\n'),
    'Activity: ' + activities.map((a) => '- ' + a.get('body')).join('\n'),
  ].join('\n\n');
  const summary = bridge.callLLM(
    'Summarize this CRM record for a busy account manager in 3-4 bullets: current status, ' +
      'open items, and one recommended next action.\n\n' + context,
    'You are a sharp CRM assistant. Be specific and brief.',
  );
  if (!summary) {
    return e.json(503, { error: 'AI is unavailable (app not running inside CraftBot)' });
  }
  return e.json(200, { summary: summary });
});

// pipeline.summary — deal count + total value per stage (pipeline health
// at a glance for agents and dashboards).
routerAdd('GET', '/api/ops/pipeline/summary', (e) => {
  const stages = e.app.findRecordsByFilter('stages', "id != ''", 'order', 0, 0);
  const deals = e.app.findRecordsByFilter('deals', "id != ''", '', 0, 0);
  const summary = stages.map((stage) => {
    const inStage = deals.filter((deal) => deal.get('stage') === stage.id);
    let total = 0;
    for (const deal of inStage) total += Number(deal.get('value') || 0);
    return {
      stage: stage.get('name'),
      count: inStage.length,
      total_value: total,
    };
  });
  return e.json(200, { stages: summary, deals: deals.length });
});
