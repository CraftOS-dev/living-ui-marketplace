/**
 * A stand-in for CraftBot's integration bridge, for scratch tests only.
 *
 *   node tools/dev/mock_bridge.mjs <port> <fixtures dir> [out dir]
 *   (tools/dev/serve.sh <app> <port> <bridge port> starts it and points the app at it)
 *
 * It answers what the real bridge answers (app/agent_app/integration_bridge.py
 * and craftos_integrations/providers/_shared.py), with the real shapes:
 *
 *   POST /api/integrations/action  { action, params, confirm_irreversible, dry_run }
 *     search_gmail                -> 200 { status: 200, data: { status: 'success', result: { messages: [{ id, threadId }], resultSizeEstimate } } }
 *     get_gmail                   -> 200 { status: 200, data: { status: 'success', result: { id, threadId, labelIds, unread, internalDate, sizeEstimate, snippet, headers, body, body_format, attachments } } }
 *     download_gmail_attachment   -> writes the fixture file to save_to; result { saved_to, size }
 *     send_gmail                  -> 400 without confirm_irreversible; records to <out>/sent.jsonl; result message 'Email sent.'
 *                                    (missing attachment paths are skipped silently, as Gmail's action does)
 *     list_google_calendar_events -> result: [Google event items] between time_min and time_max
 *     get_google_calendar_event   -> result: one event
 *     a provider failure          -> 200 { status: 200, data: { status: 'error', message } }
 *   POST /api/bridge/agent_request { request_id, trigger } -> records the fire to <out>/fires.jsonl
 *
 * Control (tests): GET /__mock/health, GET /__mock/sent, GET /__mock/fires,
 * POST /__mock/reset, POST /__mock/mode { action, mode: ok|error|offline|http_error, message }
 * (offline answers 503 like a host without the bridge; error the 200-with-error shape).
 *
 * Fixtures (<fixtures dir>):
 *   gmail/messages.json   [{ id, threadId, labels: ['Venture OS/Deals'], labelIds, internalDate | received_hours_ago,
 *                            snippet, headers: { From, To, Subject, Date, Message-ID }, body,
 *                            attachments: [{ filename, attachment_id, mimeType, file: 'decks/x.pdf' }] }]
 *   calendar/events.json  [{ id, summary, start_in_hours, duration_minutes, attendees: [...], organizer, description, location }]
 *   rules.json            { send_error_to: ['bounce@example.com'], send_error_message }
 *   decks/*.pdf, updates/*.pdf  (real text layers; make_fixtures.mjs writes them)
 */
import { createServer } from 'node:http';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.argv[2] || 3281);
const fixtures = resolve(process.argv[3] || join(dirname(fileURLToPath(import.meta.url)), 'fixtures'));
const out = resolve(process.argv[4] || fixtures);
const TOKEN = process.env.MOCK_BRIDGE_TOKEN || 'mock-bridge-token';
if (port >= 3100 && port <= 3179) {
  console.error('refusing live port ' + port);
  process.exit(2);
}
mkdirSync(out, { recursive: true });

const readJson = (p, dflt) => {
  try {
    return JSON.parse(readFileSync(join(fixtures, p), 'utf8'));
  } catch {
    return dflt;
  }
};
const messages = () => readJson('gmail/messages.json', []);
const events = () => readJson('calendar/events.json', []);
const rules = () => readJson('rules.json', {});
let modes = {};
const started = Date.now();

const ok = (result) => ({ status: 200, data: { status: 'success', result: result } });
const okMsg = (message) => ({ status: 200, data: { status: 'success', message: message } });
const providerError = (message) => ({ status: 200, data: { status: 'error', message: message } });

function internalDate(m) {
  if (m.internalDate) return String(m.internalDate);
  return String(started - Number(m.received_hours_ago || 1) * 3600000);
}

/** A tiny reading of Gmail's query syntax: label:, from:, subject:, has:attachment, newer_than:Nd, and free words. */
function matches(m, query) {
  const tokens = String(query || '').match(/(\w+:"[^"]*"|\w+:\S+|"[^"]*"|\S+)/g) || [];
  for (const t of tokens) {
    const i = t.indexOf(':');
    const key = i > 0 ? t.slice(0, i).toLowerCase() : '';
    const val = (i > 0 ? t.slice(i + 1) : t).replace(/^"|"$/g, '').toLowerCase();
    const labels = (m.labels || []).map((l) => l.toLowerCase());
    const norm = (s) => s.replace(/[\s/-]+/g, '-');
    if (key === 'label') {
      if (!labels.some((l) => l === val || norm(l) === norm(val))) return false;
    } else if (key === 'from') {
      if (String(m.headers.From || '').toLowerCase().indexOf(val) < 0) return false;
    } else if (key === 'subject') {
      if (String(m.headers.Subject || '').toLowerCase().indexOf(val) < 0) return false;
    } else if (key === 'has') {
      if (val === 'attachment' && (m.attachments || []).length === 0) return false;
    } else if (key === 'newer_than') {
      const n = parseInt(val, 10);
      const unit = val.slice(-1);
      const ms = unit === 'd' ? n * 86400000 : unit === 'h' ? n * 3600000 : n * 86400000;
      if (Number(internalDate(m)) < Date.now() - ms) return false;
    } else if (key === 'is' || key === 'in' || key === 'after' || key === 'before') {
      continue;
    } else if (key === '') {
      const hay = (String(m.headers.Subject || '') + ' ' + String(m.snippet || '') + ' ' + String(m.body || '')).toLowerCase();
      if (hay.indexOf(val) < 0) return false;
    }
  }
  return true;
}

function shapeMessage(m) {
  return {
    id: m.id,
    threadId: m.threadId || m.id,
    labelIds: m.labelIds || ['INBOX'],
    unread: (m.labelIds || []).indexOf('UNREAD') >= 0,
    internalDate: internalDate(m),
    sizeEstimate: String(m.body || '').length + 2000,
    snippet: m.snippet || String(m.body || '').slice(0, 120),
    headers: m.headers || {},
    body: m.body || '',
    body_format: 'text',
    attachments: (m.attachments || []).map((a) => ({ filename: a.filename, attachment_id: a.attachment_id, mimeType: a.mimeType || 'application/pdf', size: existsSync(join(fixtures, a.file || '')) ? statSync(join(fixtures, a.file)).size : 0 })),
  };
}

function shapeEvent(e) {
  const start = new Date(started + Number(e.start_in_hours || 0) * 3600000);
  start.setUTCMinutes(0, 0, 0);
  const end = new Date(start.getTime() + Number(e.duration_minutes || 30) * 60000);
  return {
    kind: 'calendar#event',
    id: e.id,
    status: 'confirmed',
    htmlLink: 'https://www.google.com/calendar/event?eid=' + e.id,
    summary: e.summary,
    description: e.description || '',
    location: e.location || '',
    organizer: e.organizer || {},
    start: { dateTime: start.toISOString(), timeZone: 'UTC' },
    end: { dateTime: end.toISOString(), timeZone: 'UTC' },
    attendees: e.attendees || [],
    hangoutLink: e.hangoutLink || '',
  };
}

function action(name, params, confirm) {
  const mode = modes[name];
  if (mode && mode.mode === 'offline') return { http: 503, body: { status: 503, error: 'CraftBot integration bridge is unavailable' } };
  if (mode && mode.mode === 'http_error') return { http: 502, body: { error: 'Action failed: ' + (mode.message || 'provider timeout') } };
  if (mode && mode.mode === 'error') return { http: 200, body: providerError(mode.message || 'Failed: the provider refused the request.') };
  const p = params || {};
  if (name === 'search_gmail') {
    const hits = messages().filter((m) => matches(m, p.query));
    const max = Number(p.max_results || 25);
    return { http: 200, body: ok({ messages: hits.slice(0, max).map((m) => ({ id: m.id, threadId: m.threadId || m.id })), resultSizeEstimate: hits.length }) };
  }
  if (name === 'get_gmail') {
    const m = messages().find((x) => x.id === p.message_id);
    if (!m) return { http: 200, body: providerError('Failed to get email.') };
    const shaped = shapeMessage(m);
    if (!p.full_body) {
      delete shaped.body;
      delete shaped.body_format;
      delete shaped.attachments;
    }
    return { http: 200, body: ok(shaped) };
  }
  if (name === 'download_gmail_attachment') {
    const m = messages().find((x) => x.id === p.message_id);
    const a = m && (m.attachments || []).find((x) => x.attachment_id === p.attachment_id);
    if (!a || !existsSync(join(fixtures, a.file || ''))) return { http: 200, body: providerError('Failed to download attachment.') };
    let to = resolve(String(p.save_to || ''));
    if (existsSync(to) && statSync(to).isDirectory()) to = join(to, p.filename || a.filename);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(fixtures, a.file), to);
    return { http: 200, body: ok({ saved_to: to, size: statSync(to).size }) };
  }
  if (name === 'send_gmail') {
    if (!confirm) return { http: 400, body: { error: "'send_gmail' is irreversible (it acts on the user's real account). Retry with \"confirm_irreversible\": true." } };
    const r = rules();
    const to = String(p.to || '');
    const files = Array.isArray(p.attachments) ? p.attachments : [];
    const existing = files.filter((f) => existsSync(f));
    const record = { at: new Date().toISOString(), to: to, subject: p.subject || '', body: p.body || '', attachments: files, attached: existing.map((f) => ({ path: f, size: statSync(f).size })), skipped: files.filter((f) => !existsSync(f)) };
    const bad = (r.send_error_to || []).some((x) => to.toLowerCase().indexOf(String(x).toLowerCase()) >= 0);
    if (bad) {
      appendFileSync(join(out, 'failed.jsonl'), JSON.stringify(record) + '\n');
      return { http: 200, body: providerError(r.send_error_message || 'Failed to send email.') };
    }
    appendFileSync(join(out, 'sent.jsonl'), JSON.stringify(record) + '\n');
    return { http: 200, body: okMsg('Email sent.') };
  }
  if (name === 'list_google_calendar_events') {
    const min = p.time_min ? Date.parse(p.time_min) : -Infinity;
    const max = p.time_max ? Date.parse(p.time_max) : Infinity;
    const list = events()
      .map(shapeEvent)
      .filter((e) => {
        const t = Date.parse(e.start.dateTime);
        return t >= min && t <= max;
      })
      .sort((a, b) => (a.start.dateTime < b.start.dateTime ? -1 : 1));
    return { http: 200, body: ok(list.slice(0, Number(p.max_results || 250))) };
  }
  if (name === 'get_google_calendar_event') {
    const e = events().find((x) => x.id === p.event_id);
    if (!e) return { http: 200, body: providerError('Failed to get event.') };
    return { http: 200, body: ok(shapeEvent(e)) };
  }
  return { http: 404, body: { error: "Unknown action '" + name + "'" } };
}

function readBody(req) {
  return new Promise((res) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => res(s));
  });
}

function lines(file) {
  const p = join(out, file);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l));
}

const server = createServer(async (req, res) => {
  const send = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const url = new URL(req.url, 'http://127.0.0.1');
  const raw = req.method === 'POST' ? await readBody(req) : '';
  let body = {};
  try {
    body = raw === '' ? {} : JSON.parse(raw);
  } catch {
    return send(400, { error: 'Invalid JSON body' });
  }
  if (url.pathname === '/__mock/health') return send(200, { ok: true, fixtures: fixtures, out: out });
  if (url.pathname === '/__mock/sent') return send(200, { sent: lines('sent.jsonl'), failed: lines('failed.jsonl') });
  if (url.pathname === '/__mock/fires') return send(200, { fires: lines('fires.jsonl') });
  if (url.pathname === '/__mock/reset' && req.method === 'POST') {
    modes = {};
    for (const f of ['sent.jsonl', 'failed.jsonl', 'fires.jsonl']) writeFileSync(join(out, f), '');
    return send(200, { ok: true });
  }
  if (url.pathname === '/__mock/mode' && req.method === 'POST') {
    if (!body.action) return send(400, { error: 'action is required' });
    if (!body.mode || body.mode === 'ok') delete modes[body.action];
    else modes[body.action] = { mode: body.mode, message: body.message || '' };
    return send(200, { ok: true, modes: modes });
  }
  const auth = String(req.headers.authorization || '');
  if (auth !== 'Bearer ' + TOKEN) return send(401, { error: 'Unauthorized' });
  if (url.pathname === '/api/integrations/action' && req.method === 'POST') {
    if (!body.action) return send(400, { error: 'Missing required field: action' });
    if (body.dry_run) return send(200, { status: 200, dry_run: true, would_execute: body.action, note: 'Checks passed (grant, params). Nothing was executed.' });
    const r = action(String(body.action), body.params || {}, body.confirm_irreversible === true);
    return send(r.http, r.body);
  }
  if (url.pathname === '/api/bridge/agent_request' && req.method === 'POST') {
    appendFileSync(join(out, 'fires.jsonl'), JSON.stringify({ at: new Date().toISOString(), request_id: body.request_id || '', trigger: body.trigger || '' }) + '\n');
    return send(200, { ok: true });
  }
  return send(404, { error: 'Not found' });
});

server.listen(port, '127.0.0.1', () => console.log('mock bridge on http://127.0.0.1:' + port + ' (fixtures ' + fixtures + ', records ' + out + ')'));
