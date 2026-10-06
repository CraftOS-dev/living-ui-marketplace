/**
 * The terminal (v4 plan §6, N-B20), console side.
 *
 *   terminal.open   (an admin, people only, with their password again) → a session the server's
 *                   monitor must start within 2 minutes — only if the terminal is switched on THERE
 *   terminal.input / resize / close  (the admin who opened it)
 *   sensors.terminal-exchange        (the monitor, every ~60 ms): output in, typed input out
 *
 * Output reaches the browser as terminal_io records only the session's admin can follow (deleted
 * when it ends). The transcript — output only, already masked on the server — is kept 90 days.
 * Nothing here can start a shell: only the monitor can, and only when its owner switched it on.
 */
const repo = require('../infra/repo.js');
const audit = require('./audit.js');
const { OpError } = require('../core/util.js');

const START_MS = 120000;
const SILENT_MS = 60000; // a running session the monitor stopped talking about is closed
const MAX_TRANSCRIPT = 1900000;
const FLUSH_MS = 4000;
const KEEP_DAYS = 90;
const B64 = /^[A-Za-z0-9+/=]*$/;

function store() {
  return $app.store();
}

function terminalCap(app, assetId) {
  const s = repo.first(app, 'sensors', 'asset = {:a} && status != "revoked"', { a: assetId }, '-last_seen');
  const caps = s ? repo.jsonOf(s, 'capabilities') || {} : {};
  return { sensor: s, cap: caps.terminal || { available: false, reason: "this server's monitor is older than the terminal — run its installer again" } };
}

function open(app, actor, p) {
  if (actor.type !== 'user' || actor.role !== 'admin') throw new OpError(403, 'Only an admin can open the terminal.');
  // A fresh password check (§6): a stolen browser session alone can't open a shell.
  const tries = (store().get(`ttries:${actor.id}`) || []).filter((t) => t > Date.now() - 600000);
  if (tries.length >= 5) throw new OpError(429, 'Too many wrong passwords — wait ten minutes.');
  const user = $app.findRecordById('users', actor.id);
  if (!user.validatePassword(String(p.password || ''))) {
    tries.push(Date.now());
    store().set(`ttries:${actor.id}`, tries);
    audit.append(app, actor, 'terminal.refused', { collection: 'users', id: actor.id }, 'Terminal not opened: wrong password', null);
    throw new OpError(403, "That password isn't right.");
  }
  store().set(`ttries:${actor.id}`, []);
  const asset = require('./server.js').theServer(app);
  if (!asset) throw new OpError(404, 'No server is set up yet.');
  const { sensor, cap } = terminalCap(app, asset.id);
  if (!sensor || sensor.getString('status') !== 'online') throw new OpError(409, "The server's monitor isn't reporting — start it first.");
  if (!cap.available) throw new OpError(409, `The terminal is switched off on this server: ${cap.reason || 'set NETSENTRY_TERMINAL=on for its monitor'}.`, 'terminal_off');
  if (repo.find(app, 'terminal_sessions', 'status != "closed"').length >= 3) throw new OpError(409, 'Three terminals are open already — close one first.');
  const rec = repo.create(app, 'terminal_sessions', {
    user: actor.id, user_email: actor.label, asset: asset.id, status: 'requested', start_by: new Date(Date.now() + START_MS).toISOString(),
    cols: Math.max(20, Math.min(400, Number(p.cols) || 100)), rows: Math.max(5, Math.min(200, Number(p.rows) || 30)), run_as: String(cap.user || '').slice(0, 100), transcript: '',
  });
  store().set(`watch:${asset.id}`, Date.now() + 60000);
  audit.append(app, actor, 'terminal.opened', { collection: 'terminal_sessions', id: rec.id }, `Opened a terminal on the server (as ${cap.user || 'its account'})`, null);
  return { ok: true, session_id: rec.id, run_as: cap.user || '', mode: cap.mode || 'pty' };
}

function mine(app, actor, id) {
  const s = repo.byId(app, 'terminal_sessions', String(id || ''));
  if (!s || s.getString('user') !== actor.id) throw new OpError(404, 'No such terminal.');
  return s;
}

function input(app, actor, p) {
  const s = mine(app, actor, p.session_id);
  if (s.getString('status') === 'closed') throw new OpError(409, 'This terminal is closed.', 'closed');
  const data = String(p.data || '');
  if (!B64.test(data) || data.length > 16384) throw new OpError(400, 'data must be base64, at most 12 KB at a time.');
  const q = store().get(`tin:${s.id}`) || [];
  if (q.length > 200) throw new OpError(429, 'The server is behind — wait a moment.');
  q.push(data);
  store().set(`tin:${s.id}`, q);
  return { ok: true };
}

function resize(app, actor, p) {
  const s = mine(app, actor, p.session_id);
  store().set(`tsize:${s.id}`, { cols: Math.max(20, Math.min(400, Number(p.cols) || 100)), rows: Math.max(5, Math.min(200, Number(p.rows) || 30)) });
  return { ok: true };
}

function finish(app, s, reason) {
  if (s.getString('status') === 'closed') return;
  flush(app, s, true);
  repo.update(app, s, { status: 'closed', ended_at: repo.nowIso(), reason: String(reason || 'closed').slice(0, 200) });
  for (const io of repo.find(app, 'terminal_io', 'session = {:s}', { s: s.id }, 'seq', 100000)) app.delete(io);
  for (const k of ['tin', 'tsize', 'tclose', 'tseen', 'tseq', 'ttr', 'tflush']) store().remove(`${k}:${s.id}`);
  audit.append(app, { type: 'system', label: 'terminal' }, 'terminal.closed', { collection: 'terminal_sessions', id: s.id }, `Terminal of ${s.getString('user_email')} closed (${reason})`, null);
}

function close(app, actor, p) {
  const s = mine(app, actor, p.session_id);
  if (s.getString('status') === 'requested') finish(app, s, 'closed before it started');
  else store().set(`tclose:${s.id}`, true);
  return { ok: true };
}

/** At check-in: sessions this monitor should start now (and ones it never started are closed). */
function sessionsFor(app, assetId) {
  const out = [];
  for (const s of repo.find(app, 'terminal_sessions', 'asset = {:a} && status != "closed"', { a: assetId })) {
    if (s.getString('status') === 'requested') {
      if (Date.parse(repo.isoOf(s, 'start_by')) < Date.now()) {
        finish(app, s, "the server didn't start it within 2 minutes");
        continue;
      }
      repo.update(app, s, { status: 'running', started_at: repo.nowIso() });
      store().set(`tseen:${s.id}`, Date.now());
      out.push({ id: s.id, cols: s.getInt('cols'), rows: s.getInt('rows') });
    } else if (Date.now() - (store().get(`tseen:${s.id}`) || 0) > SILENT_MS) {
      finish(app, s, 'the server stopped answering');
    }
  }
  return out;
}

function active(app, assetId) {
  return !!repo.first(app, 'terminal_sessions', 'asset = {:a} && status != "closed"', { a: assetId });
}

function flush(app, s, force) {
  const pending = store().get(`ttr:${s.id}`) || '';
  if (!pending) return;
  if (!force && pending.length < 50000 && Date.now() - (store().get(`tflush:${s.id}`) || 0) < FLUSH_MS) return;
  let t = s.getString('transcript') + pending;
  if (t.length > MAX_TRANSCRIPT) t = t.slice(0, MAX_TRANSCRIPT) + '\n[NetSentry: the rest of this session was not kept — the transcript is full]\n';
  repo.update(app, s, { transcript: t });
  store().set(`ttr:${s.id}`, '');
  store().set(`tflush:${s.id}`, Date.now());
}

/** The monitor's side (every ~60 ms while open): its output in, what the admin typed out. */
function exchange(app, actor, p) {
  const sensor = repo.byId(app, 'sensors', actor.id);
  const s = repo.byId(app, 'terminal_sessions', String(p.session_id || ''));
  if (!sensor || !s || s.getString('asset') !== sensor.getString('asset')) throw new OpError(404, 'No such terminal on this server.');
  if (s.getString('status') === 'closed') return { ok: true, close: true };
  store().set(`tseen:${s.id}`, Date.now());
  const out = String(p.out || '');
  if (out) {
    if (!B64.test(out) || out.length > 100000) throw new OpError(400, 'out must be base64.');
    const seq = (store().get(`tseq:${s.id}`) || 0) + 1;
    store().set(`tseq:${s.id}`, seq);
    repo.create(app, 'terminal_io', { session: s.id, seq, data: out });
  }
  if (p.transcript) store().set(`ttr:${s.id}`, (store().get(`ttr:${s.id}`) || '') + String(p.transcript).slice(0, 200000));
  if (p.closed === true || p.closed === 'true') {
    finish(app, s, String(p.reason || 'ended'));
    return { ok: true, close: true };
  }
  flush(app, s, false);
  // Nothing to send: wait here (up to wait_ms) for the admin to type, rather than be asked again and again.
  const wait = Math.max(0, Math.min(1500, Number(p.wait_ms) || 0));
  for (let waited = 0; !out && waited < wait; waited += 40) {
    if ((store().get(`tin:${s.id}`) || []).length || store().get(`tclose:${s.id}`) || store().get(`tsize:${s.id}`)) break;
    sleep(40);
  }
  store().set(`tseen:${s.id}`, Date.now());
  const input = store().get(`tin:${s.id}`) || [];
  store().set(`tin:${s.id}`, []);
  const size = store().get(`tsize:${s.id}`) || null;
  if (size) store().remove(`tsize:${s.id}`);
  return { ok: true, input, resize: size, close: !!store().get(`tclose:${s.id}`) };
}

function list(app) {
  return {
    ok: true,
    sessions: repo.find(app, 'terminal_sessions', 'id != ""', {}, '-created', 50).map((s) => ({
      id: s.id, user: s.getString('user_email'), status: s.getString('status'), started_at: repo.isoOf(s, 'started_at') || repo.isoOf(s, 'created'),
      ended_at: repo.isoOf(s, 'ended_at'), reason: s.getString('reason'), run_as: s.getString('run_as'), size: s.getString('transcript').length,
    })),
  };
}

function transcript(app, p) {
  const s = repo.byId(app, 'terminal_sessions', String(p.session_id || ''));
  if (!s) throw new OpError(404, 'No such terminal session.');
  return { ok: true, id: s.id, user: s.getString('user_email'), started_at: repo.isoOf(s, 'started_at'), ended_at: repo.isoOf(s, 'ended_at'), reason: s.getString('reason'), transcript: s.getString('transcript') };
}

/** Daily: transcripts older than 90 days go. */
function housekeeping(app) {
  const before = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString().replace('T', ' ');
  for (const s of repo.find(app, 'terminal_sessions', 'status = "closed" && created < {:b}', { b: before }, 'created', 500)) app.delete(s);
}

module.exports = { open, input, resize, close, sessionsFor, active, exchange, list, transcript, housekeeping };
