/// <reference path="../pb_data/types.d.ts" />
/**
 * One export per module (SPEC 4.2). Each module ships
 * pb_hooks/events_<module>.js, plain data only:
 *
 *   module.exports = {
 *     on: { 'deal.moved': 'lib_x.onDealMoved' },       // or a list of fns; fn(ctx, payload)
 *     approvals: {},                                   // kept for HR OS compatibility; unused
 *     needsYou: 'lib_x.needsYou',                      // fn(ctx) -> NextItem[] (lib_next)
 *     triggers: { deck_triage: { record, param, ... } }, // what this module asks your AI agent for, one trigger per task (lib_agent.js)
 *     search: 'lib_x.search',                          // fn(ctx, q, limit) -> [{ kind, id, title, href, icon, subtitle }]
 *     settingsKeys: { intake: { reply_sla_days: 5 } }, // defaults merged into settings.modules
 *     imports: { companies: { label, perm, fields: [...], row: 'lib_x.importRow' } },  // lib_imports targets
 *     timeline: 'lib_x.timelineFor',                   // fn(ctx, { company | person | deal }) -> events (lib_records.timeline)
 *     today: 'lib_x.today',                            // fn(ctx) -> { key, ... } block for app.today
 *   };
 *
 * emit(ctx, name, payload) calls every subscriber of `name` as
 * fn(ctx, payload), each in its own try: errors are logged and returned
 * with the results, never swallowed. ctx.app is the caller's handle (the
 * transaction of the op that emits), so a subscriber's writes join that
 * op's undo unit.
 *
 * Cron: pb_hooks/cron_<module>.js exports
 *   [{ name, schedule: '0 8 * * *', fn: 'lib_x.fn', catchUp: true }]
 * Five fields read in the firm's zone (settings.zone); fn(app). A job with
 * catchUp runs once on boot when its last scheduled time in the past two
 * days passed while the app was down.
 */

const KEY_REG = 'vo_events_v1';
const KEY_CRON = 'vo_cron_v1';
const IMPORT_TYPES = ['text', 'number', 'int', 'money', 'percent', 'day', 'email', 'url', 'bool', 'list'];

let cache = null;
let cronCache = null;

function files(prefix) {
  const out = [];
  const re = new RegExp('^' + prefix + '_[a-z0-9_]+\\.js$');
  for (const f of $os.readDir(__hooks)) {
    const n = f.name();
    if (re.test(n)) out.push(n.slice(0, -3));
  }
  out.sort();
  return out;
}

function load() {
  const on = {};
  const approvals = {};
  const needsYou = [];
  const triggers = {};
  const search = [];
  const settingsKeys = {};
  const imports = {};
  const timeline = [];
  const today = [];
  const problems = [];
  for (const f of files('events')) {
    const mod = require(`${__hooks}/${f}.js`);
    const m = f.slice('events_'.length);
    for (const ev of Object.keys(mod.on || {})) {
      const list = Array.isArray(mod.on[ev]) ? mod.on[ev] : [mod.on[ev]];
      if (on[ev] === undefined) on[ev] = [];
      for (const fn of list) on[ev].push({ module: m, fn: fn });
    }
    for (const kind of Object.keys(mod.approvals || {})) if (approvals[kind] === undefined) approvals[kind] = { module: m, fn: mod.approvals[kind] };
    if (typeof mod.needsYou === 'string') needsYou.push({ module: m, fn: mod.needsYou });
    for (const name of Object.keys(mod.triggers || {})) {
      if (triggers[name] !== undefined) problems.push('trigger ' + name + ' is declared by ' + triggers[name].module + ' and ' + m);
      else triggers[name] = Object.assign({ module: m }, mod.triggers[name]);
    }
    if (typeof mod.search === 'string') search.push({ module: m, fn: mod.search });
    for (const k of Object.keys(mod.settingsKeys || {})) {
      if (settingsKeys[k] !== undefined) problems.push('settings key ' + k + ' is declared twice');
      else settingsKeys[k] = mod.settingsKeys[k];
    }
    for (const t of Object.keys(mod.imports || {})) {
      if (imports[t] !== undefined) problems.push('import target ' + t + ' is declared twice');
      else imports[t] = Object.assign({ module: m }, mod.imports[t]);
    }
    if (typeof mod.timeline === 'string') timeline.push({ module: m, fn: mod.timeline });
    if (typeof mod.today === 'string') today.push({ module: m, fn: mod.today });
  }
  for (const p of problems) console.error('[vo] events: ' + p);
  return { on: on, approvals: approvals, needsYou: needsYou, triggers: triggers, search: search, settingsKeys: settingsKeys, imports: imports, timeline: timeline, today: today, problems: problems };
}

function reg() {
  if (cache === null) cache = require(`${__hooks}/lib_util.js`).shared(KEY_REG, load);
  return cache;
}

let _fns = {};
/** A 'lib_x.fn' reference as a function (memoised per runtime). */
function resolve(fnName) {
  if (_fns[fnName] !== undefined) return _fns[fnName];
  const parts = String(fnName).split('.');
  const fn = require(`${__hooks}/${parts[0]}.js`)[parts[1]];
  if (typeof fn !== 'function') throw new Error('function ' + fnName + ' is missing');
  _fns[fnName] = fn;
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
      console.error('[vo] event ' + name + ' subscriber ' + s.fn + ' failed:', err);
      out.push({ module: s.module, fn: s.fn, ok: false, error: String((err && err.message) || err) });
    }
  }
  return out;
}

/** The modules' needsYou functions: [{ module, fn }]. */
function needsYouFns() {
  return reg().needsYou;
}

/** The triggers modules declare: { name: { module, record, param, ... } } (lib_agent.js). */
function triggers() {
  return reg().triggers;
}

function searchFns() {
  return reg().search;
}

/** Module settings defaults: { key: { ... } }. */
function settingsDefaults() {
  return reg().settingsKeys;
}

/** Import targets: { target: { module, label, perm, fields, row } }. */
function importTargets() {
  return reg().imports;
}

function timelineFns() {
  return reg().timeline;
}

function todayFns() {
  return reg().today;
}

/** What subscribes to what (for app.status). */
function describe() {
  const r = reg();
  const on = {};
  for (const k of Object.keys(r.on)) on[k] = r.on[k].map((s) => s.fn);
  return {
    on: on,
    needsYou: r.needsYou.map((s) => s.fn),
    triggers: Object.keys(r.triggers).sort(),
    search: r.search.map((s) => s.fn),
    settings_keys: Object.keys(r.settingsKeys).sort(),
    imports: Object.keys(r.imports).sort(),
    timeline: r.timeline.map((s) => s.fn),
    today: r.today.map((s) => s.fn),
    problems: r.problems,
  };
}

/* ---------------------------------------------------------------- cron */

function loadCron() {
  const out = [];
  for (const f of files('cron')) {
    const list = require(`${__hooks}/${f}.js`);
    for (const j of Array.isArray(list) ? list : []) out.push({ module: f.slice(5), name: f.slice(5) + '.' + String(j.name || ''), schedule: String(j.schedule || ''), fn: String(j.fn || ''), catchUp: j.catchUp === true });
  }
  return out;
}

/** Module cron jobs from pb_hooks/cron_<module>.js: [{ module, name, schedule, fn, catchUp }]. */
function cronJobs() {
  if (cronCache === null) cronCache = require(`${__hooks}/lib_util.js`).shared(KEY_CRON, loadCron);
  return cronCache;
}

/** Boot: the registrations and cron jobs into the app store. */
function warm(app) {
  const u = require(`${__hooks}/lib_util.js`);
  u.sharedReset(app, KEY_REG);
  u.sharedReset(app, KEY_CRON);
  cache = null;
  cronCache = null;
  _fns = {};
  return { events: Object.keys(reg().on).length, triggers: Object.keys(reg().triggers).length, cron: cronJobs().length };
}

function lastRuns(app) {
  const u = require(`${__hooks}/lib_util.js`);
  const r = u.one(app, 'SELECT id, cron FROM settings ORDER BY created LIMIT 1', { id: '', cron: '' });
  if (r === null) return null;
  let v = {};
  try {
    v = JSON.parse(r.cron || '{}') || {};
  } catch {
    v = {};
  }
  return { id: r.id, runs: v };
}

function noteRun(app, name, ms) {
  const u = require(`${__hooks}/lib_util.js`);
  const lr = lastRuns(app);
  if (lr === null) return;
  lr.runs[name] = new Date(ms).toISOString();
  u.exec(app, 'UPDATE settings SET cron = {:c} WHERE id = {:id}', { c: JSON.stringify(lr.runs), id: lr.id });
}

function runOne(app, j, ms) {
  const started = Date.now();
  try {
    resolve(j.fn)(app);
    if (j.catchUp) noteRun(app, j.name, ms);
    return { name: j.name, ok: true, ms: Date.now() - started };
  } catch (err) {
    console.error('[vo] cron ' + j.name + ' (' + j.fn + ') failed:', err);
    return { name: j.name, ok: false, error: String((err && err.message) || err) };
  }
}

/** Run every cron job whose schedule matches this minute in the firm's zone; each in its own try. */
function runDue(app, ms) {
  const u = require(`${__hooks}/lib_util.js`);
  const local = new Date(ms + u.tzOffset(u.zoneOf(app), ms) * 60000);
  const ran = [];
  for (const j of cronJobs()) if (u.cronHit(u.cronParse(j.schedule), local)) ran.push(runOne(app, j, ms));
  return ran;
}

/** Boot: run once each catchUp job whose last scheduled time (within two days) passed since its last run. */
function catchUp(app) {
  const u = require(`${__hooks}/lib_util.js`);
  const lr = lastRuns(app);
  if (lr === null) return [];
  const now = Math.floor(Date.now() / 60000) * 60000;
  // One offset for the look-back (a daylight saving change inside two days moves a catch-up by an hour at most).
  const off = u.tzOffset(u.zoneOf(app), now) * 60000;
  const ran = [];
  for (const j of cronJobs()) {
    if (!j.catchUp) continue;
    const parsed = u.cronParse(j.schedule);
    let due = 0;
    for (let t = now - 60000; t > now - 2 * 86400000; t -= 60000) {
      if (u.cronHit(parsed, new Date(t + off))) {
        due = t;
        break;
      }
    }
    if (due === 0) continue;
    const last = Date.parse(lr.runs[j.name] || '');
    if (Number.isFinite(last) && last >= due) continue;
    ran.push(runOne(app, j, Date.now()));
  }
  return ran;
}

module.exports = {
  IMPORT_TYPES: IMPORT_TYPES,
  warm: warm,
  files: files,
  resolve: resolve,
  emit: emit,
  needsYouFns: needsYouFns,
  triggers: triggers,
  searchFns: searchFns,
  settingsDefaults: settingsDefaults,
  importTargets: importTargets,
  timelineFns: timelineFns,
  todayFns: todayFns,
  describe: describe,
  cronJobs: cronJobs,
  runDue: runDue,
  catchUp: catchUp,
};
