/// <reference path="../pb_data/types.d.ts" />
/**
 * Gmail through CraftBot's bridge (SPEC 12), with the error shape checked
 * on every call: a provider failure comes back as HTTP 200 with
 * { status: 'error' } inside data, so a call is ok only when the HTTP
 * status is 200 AND data.status is not 'error' (Advance Life OS
 * lib_calendar.js). Outside CraftBot the bridge answers 503 (reason
 * 'offline'): screens say "Connect Gmail in CraftBot" once, in Settings,
 * Capture, never as a wall.
 *
 *   answer(res) -> { ok: true, data } | { ok: false, reason: 'offline'|'not_permitted'|'error', error, status }
 *   search(app, query, max) -> { ok, messages: [{ id, thread_id }], estimate }
 *   get(app, id) -> { ok, message: { id, thread_id, from, to, cc, reply_to, subject, date, message_id,
 *                                    internal_at, labels, unread, snippet, body, body_format, attachments: [{ attachment_id, filename, mime, size }] } }
 *   attachment(app, messageId, attachmentId, filename) -> { ok, path, size }   (saved under pb_data/mail/<message>/)
 *   send(app, { to: [emails], subject, body, attachments: [paths] }) -> { ok, data } | { ok: false, ... }
 *   labels(app) -> { deals_label, updates_label }      bridgeUp() -> bool
 *
 * Every action name is a string literal here, so the gate grants it.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function bridge() {
  return require(`${__hooks}/_craftbot_bridge.js`);
}

/**
 * A demo firm (settings.mail.demo, set by the demo seed) never touches the
 * owner's Gmail: sends are recorded as sent without leaving the app, and
 * mail reads find nothing. A real firm never has the flag.
 */
function demo(app) {
  const s = L('lib_settings').row(app);
  return !!s && (L('lib_util').jsonOf(s, 'mail', {}) || {}).demo === true;
}

/** Is CraftBot's bridge configured for this process? */
function bridgeUp() {
  return String($os.getenv('CRAFTBOT_BRIDGE_URL') || '') !== '' && String($os.getenv('CRAFTBOT_BRIDGE_TOKEN') || '') !== '';
}

/** What a bridge call answered: { ok, data } or { ok: false, reason, error, status }. */
function answer(res) {
  const status = res && typeof res.status === 'number' ? res.status : 0;
  if (!res || status !== 200) {
    if (status === 503) return { ok: false, reason: 'offline', error: 'Connect Gmail in CraftBot: the app reaches Gmail only while it runs inside CraftBot.', status: status };
    if (status === 403) return { ok: false, reason: 'not_permitted', error: String((res && res.error) || 'This app may not use that Gmail action.').slice(0, 300), status: status };
    return { ok: false, reason: 'error', error: String((res && (res.error || res.data)) || 'No answer from CraftBot.').slice(0, 300), status: status };
  }
  let d = res.data;
  if (typeof d === 'string') {
    try {
      d = JSON.parse(d);
    } catch {
      d = null;
    }
  }
  if (d && d.status === 'error') return { ok: false, reason: 'error', error: String(d.message || d.reason || d.error || 'Gmail refused the request.').slice(0, 300), status: status };
  return { ok: true, data: d && d.result !== undefined ? d.result : d, status: status };
}

function labels(app) {
  const s = L('lib_settings').row(app);
  return Object.assign({ deals_label: 'Venture OS/Deals', updates_label: 'Venture OS/Updates' }, L('lib_util').jsonOf(s, 'mail', {}) || {});
}

function search(app, query, max) {
  if (demo(app)) return { ok: true, messages: [], estimate: 0 };
  const a = answer(bridge().callAction('search_gmail', { query: String(query || ''), max_results: Math.max(1, Math.min(100, Number(max) || 25)) }));
  if (!a.ok) return a;
  const d = a.data || {};
  const list = Array.isArray(d.messages) ? d.messages : Array.isArray(d) ? d : [];
  return { ok: true, messages: list.map((m) => ({ id: String(m.id || ''), thread_id: String(m.threadId || m.thread_id || '') })).filter((m) => m.id !== ''), estimate: Number(d.resultSizeEstimate || list.length) };
}

function header(h, name) {
  if (!h) return '';
  for (const k of Object.keys(h)) if (k.toLowerCase() === name.toLowerCase()) return String(h[k] || '');
  return '';
}

function get(app, id) {
  if (demo(app)) return { ok: false, reason: 'error', error: 'Demo firm: Gmail is not read.' };
  const a = answer(bridge().callAction('get_gmail', { message_id: String(id || ''), full_body: true }));
  if (!a.ok) return a;
  const d = a.data || {};
  const h = d.headers || {};
  const internal = Number(d.internalDate || 0);
  return {
    ok: true,
    message: {
      id: String(d.id || id),
      thread_id: String(d.threadId || ''),
      from: header(h, 'From'),
      to: header(h, 'To'),
      cc: header(h, 'Cc'),
      reply_to: header(h, 'Reply-To'),
      subject: header(h, 'Subject'),
      date: header(h, 'Date'),
      message_id: header(h, 'Message-ID'),
      internal_at: internal > 0 ? new Date(internal).toISOString() : '',
      labels: Array.isArray(d.labelIds) ? d.labelIds : [],
      unread: d.unread === true,
      snippet: String(d.snippet || ''),
      body: String(d.body || ''),
      body_format: String(d.body_format || ''),
      attachments: (Array.isArray(d.attachments) ? d.attachments : []).map((x) => ({ attachment_id: String(x.attachment_id || ''), filename: String(x.filename || ''), mime: String(x.mimeType || ''), size: Number(x.size || 0) })),
    },
  };
}

/** A safe file name (letters, digits, dot, dash, underscore). */
function safeName(name) {
  const n = String(name || 'attachment')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120);
  return n === '' ? 'attachment' : n;
}

function attachment(app, messageId, attachmentId, filename) {
  if (demo(app)) return { ok: false, reason: 'error', error: 'Demo firm: Gmail is not read.' };
  const data = app.dataDir();
  const dir = $filepath.join($filepath.isAbs(data) ? data : $filepath.join($os.getwd(), data), 'mail', safeName(messageId));
  try {
    $os.mkdirAll(dir, 0o755);
  } catch (err) {
    return { ok: false, reason: 'error', error: 'Could not make the mail folder: ' + err };
  }
  const path = $filepath.join(dir, safeName(filename));
  const a = answer(bridge().callAction('download_gmail_attachment', { message_id: String(messageId || ''), attachment_id: String(attachmentId || ''), save_to: path, filename: safeName(filename) }));
  if (!a.ok) return a;
  const d = a.data || {};
  const saved = String(d.saved_to || path);
  let size = Number(d.size || 0);
  try {
    size = $os.stat(saved).size();
  } catch {
    return { ok: false, reason: 'error', error: 'Gmail answered but no file was saved at ' + saved + '.' };
  }
  return { ok: true, path: saved, size: size };
}

/** Do these paths exist as files? Answers the missing ones. */
function missingFiles(paths) {
  const out = [];
  for (const p of paths || []) {
    try {
      if ($os.stat(p).isDir()) out.push(p);
    } catch {
      out.push(p);
    }
  }
  return out;
}

/**
 * Send one message. Attachments are local paths and must all exist (Gmail's
 * action skips a missing path without saying so). The answer is the
 * bridge's answer, error shape checked: report it, never assume.
 */
function send(app, m) {
  if (demo(app)) return { ok: true, demo: true, data: { demo: true } };
  const to = (Array.isArray(m.to) ? m.to : [m.to]).filter((x) => x);
  if (to.length === 0) return { ok: false, reason: 'error', error: 'No recipient.' };
  const files = m.attachments || [];
  const missing = missingFiles(files);
  if (missing.length > 0) return { ok: false, reason: 'attachment_missing', error: 'Attachment not found: ' + missing.join(', '), missing: missing };
  const params = { to: to.join(', '), subject: String(m.subject || ''), body: String(m.body || '') };
  if (files.length > 0) params.attachments = files;
  return answer(bridge().callAction('send_gmail', params, { confirmIrreversible: true }));
}

module.exports = { demo: demo, bridgeUp: bridgeUp, answer: answer, labels: labels, search: search, get: get, attachment: attachment, missingFiles: missingFiles, send: send, safeName: safeName };
