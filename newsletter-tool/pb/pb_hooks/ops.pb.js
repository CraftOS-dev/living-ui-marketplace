/// <reference path="../pb_data/types.d.ts" />
/**
 * AGENT HOOKS — custom verbs beyond CRUD live here (spec B3/D4).
 * Every route here must have a matching entry in operations.json (the gate
 * enforces it) so any agent can discover it via GET /api/_ops.
 *
 * NOTE: routerAdd handlers run in ISOLATED contexts — helpers must be
 * require()d inside each handler (see send.js), never top-level.
 */

// READING A REQUEST BODY — the ONLY correct way in PB hooks:
//   const data = e.requestInfo().body;   // pre-parsed object
// NEVER use e.request.body / toString(e.request.body): that is a Go stream
// and reads as EMPTY, so your param checks will 400 on every request.

// campaigns.send — snapshot the current subscribed audience onto a draft
// campaign and mark it sent (shared with the scheduler cron).
routerAdd('POST', '/api/ops/campaigns/send', (e) => {
  const { sendCampaign } = require(`${__hooks}/send.js`);
  const body = e.requestInfo().body || {};
  const campaignId = String(body.campaign_id || '');
  const deliver = body.deliver === true || body.deliver === 'true';
  if (campaignId === '') {
    return e.json(400, { error: 'campaign_id is required' });
  }
  try {
    const result = sendCampaign(e.app, campaignId, deliver);
    return e.json(200, {
      sent: true,
      recipients: result.recipients,
      delivered: result.delivered,
      failed: result.failed,
      mode: result.mode,
    });
  } catch (err) {
    return e.json(400, { error: String(err && err.message ? err.message : err) });
  }
});

// subscribers.export — the subscribed audience as CSV text (agents can
// hand this to a real email service).
routerAdd('GET', '/api/ops/subscribers/export', (e) => {
  const records = e.app.findRecordsByFilter('subscribers', 'status = "subscribed"', 'email', 0, 0);
  const esc = (value) => '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
  const lines = ['email,name,tags'];
  for (const record of records) {
    lines.push([esc(record.get('email')), esc(record.get('name')), esc(record.get('tags'))].join(','));
  }
  return e.json(200, { count: records.length, csv: lines.join('\n') });
});

// ai.draft — draft a newsletter with the CraftBot LLM bridge
// (503 outside CraftBot).
routerAdd('POST', '/api/ops/ai/draft', (e) => {
  const bridge = require(`${__hooks}/_craftbot_bridge.js`);
  const body = e.requestInfo().body || {};
  const topic = String(body.topic || '').trim();
  const tone = String(body.tone || 'friendly and concise');
  if (topic === '') {
    return e.json(400, { error: 'topic is required' });
  }
  const raw = bridge.callLLM(
    'Draft a short email newsletter about: ' +
      topic +
      '\nTone: ' +
      tone +
      '\n\nOutput format EXACTLY:\nSUBJECT: <one line>\n\n<newsletter body, 3-6 short paragraphs, plain text>',
    'You write crisp, engaging email newsletters.',
  );
  if (!raw) {
    return e.json(503, { error: 'AI is unavailable (app not running inside CraftBot)' });
  }
  let subject = topic;
  let draft = raw.trim();
  const match = draft.match(/^SUBJECT:\s*(.+)\n+([\s\S]*)$/);
  if (match) {
    subject = match[1].trim();
    draft = match[2].trim();
  }
  return e.json(200, { subject: subject, body: draft });
});
