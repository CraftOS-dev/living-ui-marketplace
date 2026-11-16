/// <reference path="../pb_data/types.d.ts" />
/**
 * Events between modules, by subscription (SPEC 3.4). Each module ships
 * pb_hooks/events_<module>.js, plain data:
 *
 *   module.exports = {
 *     on: { 'employment.hired': 'lib_lifecycle.onHire' },
 *     approvals: { leave_request: 'lib_leave.onDecision' },
 *     profileFacts: 'lib_leave.profileFacts',
 *   };
 *
 * emit(ctx, name, payload) calls every subscriber of `name` as
 * fn(ctx, payload), each in its own try: errors are logged and returned
 * with the results, never swallowed. approvalHandler(kind) finds the one
 * subscriber of an approval kind (lib_approvals refuses unknown kinds).
 */

let cache = null;

function files() {
  const out = [];
  for (const f of $os.readDir(__hooks)) {
    const n = f.name();
    if (/^events_[a-z0-9_]+\.js$/.test(n)) out.push(n.slice(0, -3));
  }
  out.sort();
  return out;
}

function load() {
  const on = {};
  const approvals = {};
  const facts = [];
  for (const f of files()) {
    const mod = require(`${__hooks}/${f}.js`);
    const m = f.slice('events_'.length);
    for (const ev of Object.keys(mod.on || {})) {
      const list = Array.isArray(mod.on[ev]) ? mod.on[ev] : [mod.on[ev]];
      if (on[ev] === undefined) on[ev] = [];
      for (const fn of list) on[ev].push({ module: m, fn: fn });
    }
    for (const kind of Object.keys(mod.approvals || {})) {
      if (approvals[kind] !== undefined) console.error('[hr] approval kind ' + kind + ' has two subscribers: ' + approvals[kind].fn + ' and ' + mod.approvals[kind] + ' (the first wins)');
      else approvals[kind] = { module: m, fn: mod.approvals[kind] };
    }
    if (typeof mod.profileFacts === 'string') facts.push({ module: m, fn: mod.profileFacts });
  }
  return { on: on, approvals: approvals, facts: facts };
}

const KEY_REG = 'hr_events_v1';
const KEY_CRON = 'hr_cron_v1';

function reg() {
  if (cache === null) cache = require(`${__hooks}/lib_util.js`).shared(KEY_REG, load);
  return cache;
}

function resolve(fnName) {
  const parts = String(fnName).split('.');
  const fn = require(`${__hooks}/${parts[0]}.js`)[parts[1]];
  if (typeof fn !== 'function') throw new Error('subscriber ' + fnName + ' is missing');
  return fn;
}

/** Call every subscriber of `name`; returns [{ module, fn, ok, result | error }]. */
function emit(ctx, name, payload) {
  const subs = reg().on[name] || [];
  const out = [];
  for (const s of subs) {
    try {
      const result = resolve(s.fn)(ctx, payload);
      out.push({ module: s.module, fn: s.fn, ok: true, result: result === undefined ? null : result });
    } catch (err) {
      console.error('[hr] event ' + name + ' subscriber ' + s.fn + ' failed:', err);
      out.push({ module: s.module, fn: s.fn, ok: false, error: String((err && err.message) || err) });
    }
  }
  return out;
}

/** The subscriber of an approval kind: { module, name, fn } or null. */
function approvalHandler(kind) {
  const s = reg().approvals[kind];
  if (s === undefined) return null;
  return { module: s.module, name: s.fn, fn: resolve(s.fn) };
}

/** The approval kinds some module handles. */
function approvalKinds() {
  return Object.keys(reg().approvals).sort();
}

/** Facts modules show on a profile and Home: [{ module, facts }] (a failing module answers { error }). */
function profileFacts(ctx, employmentId) {
  const out = [];
  for (const s of reg().facts) {
    try {
      out.push({ module: s.module, facts: resolve(s.fn)(ctx, employmentId) });
    } catch (err) {
      console.error('[hr] profileFacts ' + s.fn + ' failed:', err);
      out.push({ module: s.module, error: String((err && err.message) || err) });
    }
  }
  return out;
}

/** What subscribes to what (for app.status). */
function describe() {
  const r = reg();
  const on = {};
  for (const k of Object.keys(r.on)) on[k] = r.on[k].map((s) => s.fn);
  const ap = {};
  for (const k of Object.keys(r.approvals)) ap[k] = r.approvals[k].fn;
  return { on: on, approvals: ap, profileFacts: r.facts.map((s) => s.fn) };
}

/* ---------------------------------------------------------------- cron */

let cronCache = null;

/** Module cron jobs from pb_hooks/cron_<module>.js: [{ module, name, schedule, fn }]. */
function cronJobs() {
  if (cronCache === null) cronCache = require(`${__hooks}/lib_util.js`).shared(KEY_CRON, loadCron);
  return cronCache;
}

function loadCron() {
  const out = [];
  for (const f of $os.readDir(__hooks)) {
    const n = f.name();
    if (!/^cron_[a-z0-9_]+\.js$/.test(n)) continue;
    const list = require(`${__hooks}/${n}`);
    for (const j of Array.isArray(list) ? list : []) out.push({ module: n.slice(5, -3), name: String(j.name || ''), schedule: String(j.schedule || ''), fn: String(j.fn || '') });
  }
  return out;
}

/** Boot: the subscriptions and cron jobs into the app store. */
function warm(app) {
  const u = require(`${__hooks}/lib_util.js`);
  u.sharedReset(app, KEY_REG);
  u.sharedReset(app, KEY_CRON);
  cache = null;
  cronCache = null;
  return { events: Object.keys(reg().on).length, approvals: Object.keys(reg().approvals).length, cron: cronJobs().length };
}

/** Run every module cron job whose schedule matches this minute (UTC); each in its own try. */
function runDue(app, ms) {
  const u = require(`${__hooks}/lib_util.js`);
  const ran = [];
  for (const j of cronJobs()) {
    if (!u.cronMatch(j.schedule, ms)) continue;
    const started = Date.now();
    try {
      resolve(j.fn)(app);
      ran.push({ name: j.name, ok: true, ms: Date.now() - started });
    } catch (err) {
      console.error('[hr] cron ' + j.name + ' (' + j.fn + ') failed:', err);
      ran.push({ name: j.name, ok: false, error: String((err && err.message) || err) });
    }
  }
  return ran;
}

module.exports = { warm: warm, files: files, emit: emit, approvalHandler: approvalHandler, approvalKinds: approvalKinds, profileFacts: profileFacts, describe: describe, cronJobs: cronJobs, runDue: runDue };
