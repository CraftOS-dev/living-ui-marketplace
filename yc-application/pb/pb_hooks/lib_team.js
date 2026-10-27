/// <reference path="../pb_data/types.d.ts" />
/**
 * The founders. Structured facts (technical, full-time, equity) drive the
 * team checks and the odds; each founder's profile answers live in answers
 * (fp.<founder>.<field>). Your AI agent may add founders and fill empty
 * fields; once a founder confirmed their row it keeps their values and
 * reports what it left alone.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

const TEXT = ['role', 'email', 'linkedin', 'github', 'x', 'website', 'location', 'education', 'work', 'need'];
const BOOL = ['technical', 'full_time'];
/** The schema's limits, checked before saving so a long value is a clear 400, not a server error. */
const MAX = { name: 120, role: 60, email: 200, linkedin: 400, github: 400, x: 400, website: 400, location: 120, education: 2000, work: 4000, need: 600 };

function fits(k, v) {
  const U = L('lib_util');
  const n = U.chars(String(v));
  if (MAX[k] !== undefined && n > MAX[k]) throw U.fail(400, k + ' is ' + n + ' characters; it takes at most ' + MAX[k] + '.', 'too_long', { param: k, max: MAX[k] });
  return v;
}

function resolve(app, ref) {
  const U = L('lib_util');
  const S = L('lib_store');
  const byId = U.byId(app, 'founders', ref);
  if (byId !== null) return byId;
  const want = String(ref || '').trim().toLowerCase();
  const all = S.founderRecords(app);
  for (const r of all) if (r.getString('name').trim().toLowerCase() === want) return r;
  const names = all.map((r) => r.getString('name') + ' (' + r.id + ')');
  throw U.fail(404, 'No founder "' + ref + '". Founders: ' + (names.length > 0 ? names.join(', ') : 'none yet (founders.add)') + '.', 'unknown_founder');
}

function list(ctx) {
  return { founders: L('lib_store').founders(ctx.app) };
}

function get(ctx, p) {
  const S = L('lib_store');
  const A = L('lib_answers');
  const r = resolve(ctx.app, p.founder);
  const profile = A.all(ctx.app).filter((a) => a.founder === r.id);
  return { founder: S.founderView(r), profile: profile };
}

function equityOrFail(v) {
  const U = L('lib_util');
  if (v === undefined) return undefined;
  if (!(v >= 0 && v <= 100)) throw U.fail(400, 'equity is a percent from 0 to 100.', 'invalid_param', { param: 'equity' });
  return Math.round(v * 100) / 100;
}

function add(ctx, p) {
  const U = L('lib_util');
  const S = L('lib_store');
  const app = ctx.app;
  S.assertPreparing(app);
  const name = fits('name', String(p.name || '').trim());
  if (name === '') throw U.fail(400, 'name is required.', 'missing_param', { param: 'name' });
  for (const r of S.founderRecords(app)) {
    if (r.getString('name').trim().toLowerCase() === name.toLowerCase()) throw U.fail(409, name + ' is already on the team (' + r.id + '). Use founders.update.', 'duplicate', { founder: r.id });
  }
  const rec = U.newRecord(app, 'founders');
  rec.set('name', name);
  for (const k of TEXT) if (p[k] !== undefined) rec.set(k, fits(k, String(p[k]).trim()));
  for (const k of BOOL) if (p[k] !== undefined) rec.set(k, p[k] === true ? 'yes' : 'no');
  const eq = equityOrFail(p.equity);
  if (eq !== undefined) rec.set('equity', eq);
  rec.set('origin', ctx.isAgent ? 'agent' : 'person');
  rec.set('confirmed', !ctx.isAgent);
  rec.set('sort', S.founderRecords(app).length);
  app.save(rec);
  L('lib_answers').syncBreakdown(app);
  S.log(app, ctx.actor, 'Added ' + name + ' to the team', rec.id);
  return { founder: S.founderView(rec) };
}

function update(ctx, p) {
  const U = L('lib_util');
  const S = L('lib_store');
  const app = ctx.app;
  S.assertPreparing(app);
  const rec = resolve(app, p.founder);
  const owned = rec.getBool('confirmed');
  const kept = [];
  const changed = [];
  const apply = (k, v) => {
    const cur = rec.get(k);
    const curEmpty = cur === '' || cur === null || cur === undefined || (k === 'equity' && !(cur > 0));
    if (String(cur) === String(v)) return;
    if (ctx.isAgent && owned && !curEmpty && k !== 'need') {
      kept.push(k);
      return;
    }
    rec.set(k, v);
    changed.push(k);
  };
  if (p.name !== undefined && String(p.name).trim() !== '') apply('name', fits('name', String(p.name).trim()));
  for (const k of TEXT) if (p[k] !== undefined) apply(k, fits(k, String(p[k]).trim()));
  for (const k of BOOL) if (p[k] !== undefined) apply(k, p[k] === true ? 'yes' : 'no');
  const eq = equityOrFail(p.equity);
  if (eq !== undefined) apply('equity', eq);
  if (!ctx.isAgent && changed.length > 0) {
    rec.set('confirmed', true);
    if (changed.indexOf('need') < 0) rec.set('need', '');
  }
  // What your AI agent adds about a founder waits for that founder's "Looks right".
  if (ctx.isAgent && changed.some((k) => k !== 'need')) rec.set('confirmed', false);
  app.save(rec);
  L('lib_answers').syncBreakdown(app);
  if (ctx.isAgent && changed.length > 0) S.log(app, 'agent', 'Updated ' + rec.getString('name') + ': ' + changed.join(', '), rec.id);
  const out = { founder: S.founderView(rec), changed: changed };
  if (kept.length > 0) out.kept = { fields: kept, why: rec.getString('name') + ' confirmed these values; tell the founders what you would change instead.' };
  return out;
}

function confirm(ctx, p) {
  const app = ctx.app;
  L('lib_store').assertPreparing(app);
  const rec = resolve(app, p.founder);
  rec.set('confirmed', true);
  app.save(rec);
  L('lib_answers').syncBreakdown(app);
  return { founder: L('lib_store').founderView(rec) };
}

function remove(ctx, p) {
  const S = L('lib_store');
  const app = ctx.app;
  S.assertPreparing(app);
  const rec = resolve(app, p.founder);
  const name = rec.getString('name');
  app.runInTransaction((tx) => {
    L('lib_answers').dropFounder(tx, rec.id);
    tx.delete(tx.findRecordById('founders', rec.id));
  });
  L('lib_answers').syncBreakdown(app);
  S.log(app, ctx.actor, 'Removed ' + name + ' from the team', '');
  return { removed: name };
}

/** Put founders in order (the first is shown first on YC's form). */
function reorder(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  L('lib_store').assertPreparing(app);
  const ids = U.list(p.order, 'order');
  let i = 0;
  for (const ref of ids) {
    const rec = resolve(app, String(ref));
    rec.set('sort', i++);
    app.save(rec);
  }
  return list(ctx);
}

/** For the delete prompt: the founder exists, and what to call them. */
function lookup(ctx, p) {
  return '"' + resolve(ctx.app, p.founder).getString('name') + '"';
}

module.exports = { resolve: resolve, lookup: lookup, list: list, get: get, add: add, update: update, confirm: confirm, remove: remove, reorder: reorder };
