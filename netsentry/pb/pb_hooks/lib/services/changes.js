/**
 * Running things (v3 plan §8, §9): start / stop / restart an app or a service,
 * and read its log — through the same road as every fix.
 *
 *   changes.request (a person or the agent) → a planned change with its preview
 *   changes.confirm (a person only)         → approved, bound to the plan's hash
 *   check-in                                → the machine's monitor applies it and proves it
 *
 * While someone is looking at a machine, or a change waits for it, its monitor
 * checks in every 2 seconds instead of 10 (a "watch" kept in memory, never in
 * the database), so a button feels like a button.
 *
 * Logs are never stored: a request waits in memory for the monitor's next
 * check-in, the monitor answers with the last lines (secrets already hidden
 * on the machine), and the answer lives in memory for two minutes.
 */
const repo = require('../infra/repo.js');
const audit = require('./audit.js');
const actions = require('../v2/actions.js');
const { OpError } = require('../core/util.js');

const WATCH_MS = 60000;
const FAST_SECONDS = 2;
const SLOW_SECONDS = 10; // how soon an idle machine hears that someone is now watching it
const LOG_TTL_MS = 120000;
const MAX_LOG_LINES = 500;
const ACTIVE = '(status = "planned" || status = "approved" || status = "executing")';

function store() {
  return $app.store();
}

// ------------------------------------------------------------------ watching

/** A person has a machine's page open: its monitor checks in fast for the next minute. */
function watch(app, p) {
  const asset = repo.byId(app, 'assets', String(p.asset_id || ''));
  if (!asset || asset.getString('kind') !== 'host') throw new OpError(404, 'No such server.');
  store().set(`watch:${asset.id}`, Date.now() + WATCH_MS);
  return { ok: true, fast_for_seconds: WATCH_MS / 1000 };
}

/** Is a person looking at this server right now (a page keeps the watch)? */
function watching(assetId) {
  const until = store().get(`watch:${assetId}`);
  return !!(until && until > Date.now());
}

/** How often this machine's monitor should check in now. */
function checkinSeconds(app, assetId) {
  const until = store().get(`watch:${assetId}`);
  if (until && until > Date.now()) return FAST_SECONDS;
  if (repo.first(app, 'remediations', `asset = {:a} && (status = "approved" || status = "executing")`, { a: assetId })) return FAST_SECONDS;
  if ((store().get(`logs:${assetId}`) || []).length) return FAST_SECONDS;
  if (require('./serverreads.js').waiting(assetId)) return FAST_SECONDS;
  if (require('./terminal.js').active(app, assetId)) return FAST_SECONDS;
  return SLOW_SECONDS;
}

// ------------------------------------------------------------------ changes

function appOf(app, appId) {
  const a = repo.byId(app, 'apps', String(appId || ''));
  if (!a) throw new OpError(404, 'No such app.');
  return a;
}

function machineName(asset) {
  return asset.getString('label') || asset.getString('identifier');
}

/** Build the one-step plan for a start / stop / restart (validated against the typed actions). */
function planFor(app, p) {
  const what = String(p.action || '');
  if (['start', 'stop', 'restart'].indexOf(what) < 0) throw new OpError(400, 'action must be start, stop or restart.');
  if (p.app_id) {
    const a = appOf(app, p.app_id);
    const asset = repo.byId(app, 'assets', a.getString('asset'));
    if (!a.getString('container')) throw new OpError(409, "This app isn't a container, so NetSentry can't start or stop it. Use its service instead.");
    const name = a.getString('label') || a.getString('display_name') || a.getString('container');
    const plan = actions.operatePlan(`container.${what}`, { container: a.getString('container'), app: name }, machineName(asset));
    return { plan, asset, appRec: a, target: a.getString('container') };
  }
  const asset = repo.byId(app, 'assets', String(p.asset_id || ''));
  if (!asset || asset.getString('kind') !== 'host') throw new OpError(404, 'No such server.');
  const unit = String(p.service || '');
  const plan = actions.operatePlan(`service.${what}`, { unit, label: String(p.label || unit).slice(0, 120), machine: machineName(asset) }, machineName(asset));
  return { plan, asset, appRec: null, target: unit };
}

function request(app, actor, p) {
  const { plan, asset, appRec, target } = planFor(app, p);
  if (!plan) throw new OpError(400, 'That is not something NetSentry can start, stop or restart.');
  // One change at a time per target: a second click reuses the waiting one.
  const waiting = repo.first(app, 'remediations', `asset = {:a} && purpose = "operate" && blast_radius = {:t} && ${ACTIVE}`, { a: asset.id, t: target });
  if (waiting && waiting.getString('status') !== 'planned') throw new OpError(409, `A change to ${target} is already ${waiting.getString('status')}.`, 'busy');
  if (waiting) app.delete(waiting);
  const { planHash } = require('../core/remediation.js');
  const body = { steps: plan.steps };
  const hash = planHash((s) => $security.sha256(s), body);
  const rem = repo.create(app, 'remediations', {
    purpose: 'operate', app: appRec ? appRec.id : '', asset: asset.id,
    fingerprint: `op|${asset.id}|${target}|${Date.now()}`, playbook_id: 'v3.operate',
    title: plan.title.slice(0, 300), plain_title: plan.title.slice(0, 300),
    risk_class: 'approve', status: 'planned', plan: body, plan_hash: hash, preconditions: [], downtime: plan.downtime, cost_note: 'none',
    blast_radius: target, requested_by: actor.label, planned_by: 'NetSentry (built-in actions)', steps_log: [],
  });
  audit.append(app, actor, 'change.requested', { collection: 'remediations', id: rem.id }, `Change asked for: ${plan.title}`, { action: plan.steps[0].action, target });
  const ready = require('./remediations.js').executorReady(app, asset.id);
  return {
    ok: true,
    remediation_id: rem.id,
    plan_hash: hash,
    status: 'planned',
    preview: { title: plan.title, what_changes: plan.steps.map((s) => s.description), undo: plan.steps.map((s) => s.rollback), disrupts: plan.downtime },
    manageable: ready,
    message: ready
      ? 'Confirm to do it now. Only a person can confirm.'
      : `Changes are switched off on ${machineName(asset)}. Allow them on the server itself (Settings → Monitor shows the command), or do it by hand.`,
  };
}

/** A person confirms exactly this plan; the machine's monitor picks it up within seconds. */
// Who may confirm what: running things and backups — anyone who looks after the machines;
// updates, installs and operating-system changes — an admin.
const CONFIRM_ROLE = { operate: 'analyst', backup: 'analyst', restore: 'admin', update: 'admin', install: 'admin', os: 'admin',
  // v4 §7–§8: everything that changes the server's files, settings, firewall, keys or programs — an admin (N-B15)
  files: 'admin', settings: 'admin', remove: 'admin', cleanup: 'admin', process: 'admin', firewall: 'admin', keys: 'admin', schedule: 'admin', remote: 'admin', command: 'admin' };

function confirm(app, actor, p) {
  const rem = repo.byId(app, 'remediations', String(p.remediation_id || ''));
  const R0 = require('./remediations.js');
  // A built-in fix for a problem (v2 typed actions) is confirmed the same way from Home's "To fix" (v4 §5.1).
  if (rem && rem.getString('playbook_id') === R0.V2_FIX && (!rem.getString('purpose') || rem.getString('purpose') === 'fix')) {
    if (actor.role !== 'admin') throw new OpError(403, 'Only an admin can confirm a fix.');
    if (String(p.plan_hash || '') !== rem.getString('plan_hash')) throw new OpError(409, 'This change was altered after you saw it — look at it again before confirming.', 'plan_changed');
    if (rem.getString('status') !== 'planned') throw new OpError(409, `This change is already ${rem.getString('status')}.`);
    if (!R0.executorReady(app, rem.getString('asset'))) throw new OpError(409, 'Changes are switched off on this server — switch them on there first.', 'executor_off');
    R0.approve(app, actor, { remediation_id: rem.id });
    // Now it's being handled: the problem shows as such until the check passes (or the fix ends unfixed).
    const f = repo.byId(app, 'findings', rem.getString('finding'));
    if (f && f.getString('status') === 'open') require('./findings.js').transition(app, actor, 'acknowledge', { finding_id: f.id, note: R0.FIX_REQUESTED_NOTE });
    store().set(`watch:${rem.getString('asset')}`, Date.now() + WATCH_MS);
    return { ok: true, remediation_id: rem.id, status: 'approved', message: 'Sent to the server — usually done within seconds.' };
  }
  const purpose = rem ? rem.getString('purpose') : '';
  if (!rem || !CONFIRM_ROLE[purpose]) throw new OpError(404, 'No such change.');
  if (CONFIRM_ROLE[purpose] === 'admin' && actor.role !== 'admin') throw new OpError(403, 'Only an admin can confirm this kind of change.');
  // Bound to the plan the person was shown (security review 2026-10-01, C9).
  if (String(p.plan_hash || '') !== rem.getString('plan_hash')) throw new OpError(409, 'This change was altered after you saw it — look at it again before confirming.', 'plan_changed');
  if (rem.getString('status') !== 'planned') throw new OpError(409, `This change is already ${rem.getString('status')}.`);
  const R = require('./remediations.js');
  if (!R.executorReady(app, rem.getString('asset'))) throw new OpError(409, 'Changes are switched off on that server — switch them on there first.', 'executor_off');
  R.approveInternal(app, rem, actor);
  store().set(`watch:${rem.getString('asset')}`, Date.now() + WATCH_MS);
  return { ok: true, remediation_id: rem.id, status: 'approved', message: 'Sent to the server — usually done within seconds.' };
}

// v4 §7: what can be undone afterwards, and for how long (what the monitor keeps: the bin 7 days, copies 14).
const UNDOABLE = { files: 7, settings: 14, remove: 7, install: 7, firewall: 30, keys: 30, schedule: 30, operate: 1, remote: 30 };

/** Days this change can be undone for (0: never). A restart has nothing to put back (v4 §16 walk). */
function undoDays(rem) {
  const days = UNDOABLE[rem.getString('purpose')] || 0;
  if (!days) return 0;
  const steps = (repo.jsonOf(rem, 'plan') || {}).steps || [];
  if (rem.getString('purpose') === 'operate' && steps.length && steps.every((s) => /\.restart$/.test(String(s.action || '')))) return 0;
  return days;
}

/** Undo a change that worked — the monitor reverses it from what it recorded doing. A person only. */
function undo(app, actor, p) {
  const rem = repo.byId(app, 'remediations', String(p.remediation_id || ''));
  if (!rem) throw new OpError(404, 'No such change.');
  const days = undoDays(rem);
  if (!days) throw new OpError(409, "This kind of change can't be undone by NetSentry.");
  if (rem.getString('status') !== 'done') throw new OpError(409, 'Only a change that worked can be undone.');
  const finished = Date.parse(repo.isoOf(rem, 'completed_at') || repo.isoOf(rem, 'updated'));
  if (Date.now() - finished > days * 86400000) throw new OpError(409, `It is too late: this kind of change can be undone for ${days} day${days === 1 ? '' : 's'}.`);
  const log = repo.jsonOf(rem, 'steps_log') || [];
  if (log.some((e) => e.step === -3)) throw new OpError(409, 'Undo was already asked for.');
  if (!require('./remediations.js').executorReady(app, rem.getString('asset'))) throw new OpError(409, 'Changes are switched off on the server — switch them on there first.', 'executor_off');
  log.push({ step: -3, outcome: 'ok', output: `Undo asked by ${actor.label}`, at: repo.nowIso(), by: actor.label });
  repo.update(app, rem, { steps_log: log });
  audit.append(app, actor, 'change.undo_requested', { collection: 'remediations', id: rem.id }, `Undo asked for: "${rem.getString('title')}"`, null);
  store().set(`watch:${rem.getString('asset')}`, Date.now() + WATCH_MS);
  return { ok: true, message: 'Sent to the server — it puts things back the way they were.' };
}

/** "Fix it" from Home: NetSentry's built-in fix for one problem, shown before anything happens. */
function prepareFix(app, actor, p) {
  const R = require('./remediations.js');
  const f = repo.byId(app, 'findings', String(p.finding_id || ''));
  if (!f) throw new OpError(404, 'No such problem.');
  let rem = repo.first(app, 'remediations', `fingerprint = {:f} && status = "planned" && playbook_id = {:p}`, { f: f.getString('fingerprint'), p: R.V2_FIX });
  if (f.getString('status') === 'resolved') throw new OpError(409, 'This problem is already fixed.');
  if (!rem) rem = repo.byId(app, 'remediations', R.requestV2(app, actor, f, { prepareOnly: true }).remediation_id);
  const plan = repo.jsonOf(rem, 'plan') || { steps: [] };
  return {
    ok: true, remediation_id: rem.id, plan_hash: rem.getString('plan_hash'), status: rem.getString('status'),
    manageable: R.executorReady(app, rem.getString('asset')),
    preview: {
      title: rem.getString('title'),
      what_changes: (plan.steps || []).map((s) => s.description),
      undo: (plan.steps || []).map((s) => s.rollback).filter(Boolean),
      disrupts: rem.getString('downtime'),
      keeps: [].concat(repo.jsonOf(rem, 'preconditions') || []).map(String).filter(Boolean),
    },
    message: 'Here is exactly what will change. Confirm, and the monitor on this server applies it; NetSentry then checks it worked.',
  };
}

/** What the monitor reported names containers ("joe-sonarr-1 is running"); people know the app ("Sonarr is running"). */
function withAppNames(app, text) {
  let out = String(text || '');
  // Whole names only: a container called "pt" must never turn "kept" into "kePlex" (v4 walk).
  const apps = repo.find(app, 'apps', 'container != ""').sort((x, y) => y.getString('container').length - x.getString('container').length);
  for (const a of apps) {
    const c = a.getString('container');
    if (!c || out.indexOf(c) < 0) continue;
    const esc = c.split('.').join('\\.'); // container names are letters, digits, _ . - — only the dot means something
    out = out.replace(new RegExp(`(^|[^A-Za-z0-9_.-])${esc}(?![A-Za-z0-9_.-])`, 'g'), (m, before) => before + (a.getString('label') || a.getString('display_name') || c));
  }
  return out;
}

/** Changes made on a machine or to an app, newest first. */
function list(app, p) {
  const filter = p.app_id ? 'app = {:x}' : 'asset = {:x}';
  const x = String(p.app_id || p.asset_id || '');
  if (!x) throw new OpError(400, 'Give app_id or asset_id.');
  return {
    ok: true,
    // A preview nobody confirmed (closed, or withdrawn after a day) never happened: it isn't a change made.
    changes: repo.find(app, 'remediations', `${filter} && status != "expired" && (status != "cancelled" || approved_by != "")`, { x }, '-created', 50).map((r) => ({
      id: r.id, purpose: r.getString('purpose'), title: withAppNames(app, r.getString('title')), status: r.getString('status'),
      requested_by: r.getString('requested_by'), approved_by: r.getString('approved_by'), created: repo.isoOf(r, 'created'),
      result: withAppNames(app, (repo.jsonOf(r, 'steps_log') || []).filter((e) => e.step !== -3).map((e) => e.output).filter(Boolean).slice(-1)[0] || r.getString('failure_reason') || ''),
      undoable: r.getString('status') === 'done' && undoDays(r) > 0 && !(repo.jsonOf(r, 'steps_log') || []).some((e) => e.step === -3) &&
        Date.now() - Date.parse(repo.isoOf(r, 'completed_at') || repo.isoOf(r, 'updated')) < undoDays(r) * 86400000,
      undo: ((repo.jsonOf(r, 'plan') || {}).steps || []).map((s) => s.rollback).filter(Boolean),
    })),
  };
}

// ------------------------------------------------------------------ logs

/** Ask the machine for an app's (or a service's) last lines. Returns a request id to read the answer with. */
function logsRequest(app, actor, p) {
  let asset;
  let target;
  if (p.app_id) {
    const a = appOf(app, p.app_id);
    asset = repo.byId(app, 'assets', a.getString('asset'));
    if (!a.getString('container')) throw new OpError(409, "NetSentry reads logs of container apps and of services; this app is neither.");
    target = { kind: 'container', name: a.getString('container') };
  } else {
    asset = repo.byId(app, 'assets', String(p.asset_id || ''));
    if (!asset || asset.getString('kind') !== 'host') throw new OpError(404, 'No such server.');
    const unit = String(p.service || '');
    if (!/^[A-Za-z0-9@_.-]{1,120}$/.test(unit)) throw new OpError(400, 'service must be a service name.');
    target = { kind: 'service', name: unit };
  }
  const lines = Math.max(10, Math.min(MAX_LOG_LINES, Number(p.lines) || 200));
  const since = String(p.since || '');
  if (since && isNaN(Date.parse(since))) throw new OpError(400, 'since must be a time.');
  const id = $security.randomString(16);
  const queue = (store().get(`logs:${asset.id}`) || []).filter((r) => r.expires > Date.now()).slice(-9);
  queue.push({ id, target, lines, since, expires: Date.now() + LOG_TTL_MS });
  store().set(`logs:${asset.id}`, queue);
  store().set(`watch:${asset.id}`, Date.now() + WATCH_MS);
  return { ok: true, request_id: id, asset_id: asset.id };
}

/** What the monitor gets at check-in (and the queue empties). */
function logRequestsFor(assetId) {
  const queue = (store().get(`logs:${assetId}`) || []).filter((r) => r.expires > Date.now());
  store().set(`logs:${assetId}`, []);
  for (const r of queue) store().set(`logpending:${r.id}`, { asset: assetId, expires: r.expires });
  return queue.map((r) => ({ id: r.id, kind: r.target.kind, name: r.target.name, lines: r.lines, since: r.since }));
}

/** The monitor's answer (sensor op). Only for a request made for its own machine. */
function logsReply(app, actor, p) {
  const sensor = repo.byId(app, 'sensors', actor.id);
  if (!sensor) throw new OpError(403, 'Not a monitor.');
  const id = String(p.request_id || '');
  const pending = store().get(`logpending:${id}`);
  if (!pending || pending.asset !== sensor.getString('asset')) throw new OpError(404, 'No such log request for this server.');
  let lines = p.lines;
  if (typeof lines === 'string') {
    try {
      lines = JSON.parse(lines);
    } catch {
      lines = [];
    }
  }
  if (!Array.isArray(lines)) lines = [];
  const clean = lines.slice(-MAX_LOG_LINES).map((l) => String(l).slice(0, 2000));
  store().set(`logreply:${id}`, { lines: clean, error: String(p.error || '').slice(0, 300), at: new Date().toISOString(), expires: Date.now() + LOG_TTL_MS });
  store().remove(`logpending:${id}`);
  return { ok: true, received: clean.length };
}

/** The answer, once the monitor sent it: { ready, lines, hints, error }. */
function logsResult(app, p) {
  const id = String(p.request_id || '');
  const r = store().get(`logreply:${id}`);
  if (!r || r.expires < Date.now()) return { ok: true, ready: false };
  return { ok: true, ready: true, lines: r.lines, error: r.error, at: r.at, hints: hintsFor(r.lines) };
}

// What a log's last lines usually mean, in plain words (tested patterns only).
const HINTS = [
  [/out of memory|oom-?kill|cannot allocate memory|killed process/i, 'It ran out of memory.'],
  [/permission denied|operation not permitted|EACCES/i, "It can't read or write one of its folders — usually the folder belongs to a different user than the app runs as (PUID/PGID)."],
  [/address already in use|EADDRINUSE|bind: address/i, 'Another app already uses the port it wants.'],
  [/no space left on device|ENOSPC|disk full/i, 'The disk is full.'],
  [/database is locked|database disk image is malformed|SQLITE_CORRUPT/i, 'Its database is locked or damaged — restore its data from a backup if it keeps happening.'],
  [/(could not|unable to|failed to) (connect|resolve)|connection refused|name or service not known|ECONNREFUSED/i, "It can't reach something it depends on (another app, a database or the internet)."],
  // "failed"/"error", never "failures": every fresh Jellyfin warns "…Migrations… diagnose any failures"
  [/migrat\w*\b[^\n]{0,120}\b(failed|error)\b|\b(failed|error)\b[^\n]{0,60}\bmigrat/i,'An update failed to upgrade its data — rolling the update back usually helps.'],
];

function hintsFor(lines) {
  const text = (lines || []).slice(-80).join('\n');
  const out = [];
  for (const [re, words] of HINTS) if (re.test(text) && out.indexOf(words) < 0) out.push(words);
  return out;
}

module.exports = { undo, UNDOABLE, prepareFix, watch, watching, checkinSeconds, request, confirm, list, logsRequest, logRequestsFor, logsReply, logsResult, hintsFor, WATCH_MS, FAST_SECONDS };
