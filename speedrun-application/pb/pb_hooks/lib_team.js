/// <reference path="../pb_data/types.d.ts" />
/**
 * The founders: speedrun's per-founder fields (the first founder is the CEO
 * who applies, then the co-founders) and the facts the checks read
 * (technical end-to-end, full-time, years of experience). Each founder's
 * "Relevant experience" lives in answers (fp.<founder>.experience). Your AI
 * agent may add founders and fill empty fields; once a founder confirmed
 * their row it keeps their values and reports what it left alone.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

const TEXT = ['role', 'email', 'phone', 'linkedin', 'github', 'x', 'website', 'state', 'city', 'college', 'need'];
const COUNTRY = ['country', 'citizenship'];
const BOOL = ['technical', 'full_time'];
/** The schema's limits, checked before saving so a long value is a clear 400, not a server error. */
const MAX = { name: 160, first_name: 80, last_name: 80, role: 60, email: 200, phone: 50, linkedin: 400, github: 400, x: 400, website: 400, state: 80, city: 120, college: 200, need: 600 };

function fits(k, v) {
  const U = L('lib_util');
  const n = U.chars(String(v));
  if (MAX[k] !== undefined && n > MAX[k]) throw U.fail(400, k + ' is ' + n + ' characters; it takes at most ' + MAX[k] + '.', 'too_long', { param: k, max: MAX[k] });
  return v;
}

/** A country as the form lists it ('' clears it). */
function country(k, raw) {
  const U = L('lib_util');
  if (String(raw).trim() === '') return '';
  const c = L('lib_questions').countryOf(raw, U.nearest);
  if (c.country !== null) return c.country;
  throw U.fail(400, k + ' must be a country as speedrun\'s form lists it' + (c.near !== '' ? ' (did you mean ' + c.near + '?)' : ', for example United States of America, United Kingdom, Singapore') + '. questions.list gives every country.', 'invalid_param', { param: k });
}

function education(raw) {
  const U = L('lib_util');
  const s = String(raw).trim();
  if (s === '') return '';
  for (const e of L('lib_questions').EDUCATION) if (e.toLowerCase() === s.toLowerCase()) return e;
  throw U.fail(400, 'education must be one of: ' + L('lib_questions').EDUCATION.join('; ') + ' (or "" when not given).', 'invalid_param', { param: 'education' });
}

function years(raw) {
  const U = L('lib_util');
  const s = String(raw).trim();
  if (s === '') return '';
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 70) throw U.fail(400, 'years is a whole number of years of professional experience, from 0 to 70.', 'invalid_param', { param: 'years' });
  return String(Math.round(n));
}

/** First and last name from a full name: the last word is the last name. Pass both for family-name-first names. */
function split(full) {
  const parts = String(full).trim().split(/\s+/).filter((x) => x !== '');
  if (parts.length <= 1) return { first: parts[0] || '', last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

function joined(first, last) {
  return [String(first).trim(), String(last).trim()].filter((x) => x !== '').join(' ');
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

/** The values of a write, checked and made canonical (only the fields given). */
function values(p) {
  const out = {};
  for (const k of TEXT) if (p[k] !== undefined) out[k] = fits(k, String(p[k]).trim());
  for (const k of COUNTRY) if (p[k] !== undefined) out[k] = country(k, p[k]);
  if (p.education !== undefined) out.education = education(p.education);
  if (p.years !== undefined) out.years = years(p.years);
  for (const k of BOOL) if (p[k] !== undefined) out[k] = p[k] === true ? 'yes' : 'no';
  return out;
}

function add(ctx, p) {
  const U = L('lib_util');
  const S = L('lib_store');
  const app = ctx.app;
  S.assertPreparing(app);
  let first = p.first_name !== undefined ? String(p.first_name).trim() : '';
  let last = p.last_name !== undefined ? String(p.last_name).trim() : '';
  if (first === '' && last === '') {
    const sp = split(String(p.name || ''));
    first = sp.first;
    last = sp.last;
  }
  const name = fits('name', joined(first, last));
  if (name === '') throw U.fail(400, 'Give --name "<full name>", or --first_name and --last_name.', 'missing_param', { param: 'name' });
  fits('first_name', first);
  fits('last_name', last);
  for (const r of S.founderRecords(app)) {
    if (r.getString('name').trim().toLowerCase() === name.toLowerCase()) throw U.fail(409, name + ' is already on the team (' + r.id + '). Use founders.update.', 'duplicate', { founder: r.id });
  }
  const vals = values(p);
  const rec = U.newRecord(app, 'founders');
  rec.set('name', name);
  rec.set('first_name', first);
  rec.set('last_name', last);
  for (const k of Object.keys(vals)) rec.set(k, vals[k]);
  rec.set('origin', ctx.isAgent ? 'agent' : 'person');
  rec.set('confirmed', !ctx.isAgent);
  rec.set('sort', S.founderRecords(app).length);
  app.save(rec);
  L('lib_answers').syncDerived(app);
  S.log(app, ctx.actor, 'Added ' + name + ' to the team', rec.id);
  return { founder: S.founderView(rec) };
}

function update(ctx, p) {
  const S = L('lib_store');
  const app = ctx.app;
  S.assertPreparing(app);
  const rec = resolve(app, p.founder);
  const owned = rec.getBool('confirmed');
  const kept = [];
  const changed = [];
  const apply = (k, v) => {
    const cur = rec.get(k);
    const curEmpty = cur === '' || cur === null || cur === undefined;
    if (String(cur) === String(v)) return;
    if (ctx.isAgent && owned && !curEmpty && k !== 'need') {
      kept.push(k);
      return;
    }
    rec.set(k, v);
    changed.push(k);
  };
  // A full name splits at the last word; first_name and last_name given separately win.
  let first = p.first_name !== undefined ? String(p.first_name).trim() : undefined;
  let last = p.last_name !== undefined ? String(p.last_name).trim() : undefined;
  if (p.name !== undefined && String(p.name).trim() !== '' && first === undefined && last === undefined) {
    const sp = split(String(p.name));
    first = sp.first;
    last = sp.last;
  }
  if (first !== undefined && first !== '') apply('first_name', fits('first_name', first));
  if (last !== undefined) apply('last_name', fits('last_name', last));
  const vals = values(p);
  for (const k of Object.keys(vals)) apply(k, vals[k]);
  const name = joined(rec.getString('first_name'), rec.getString('last_name'));
  if (name !== '' && name !== rec.getString('name')) rec.set('name', fits('name', name));
  if (!ctx.isAgent && changed.length > 0) {
    rec.set('confirmed', true);
    if (changed.indexOf('need') < 0) rec.set('need', '');
  }
  // What your AI agent adds about a founder waits for that founder's "Looks right".
  if (ctx.isAgent && changed.some((k) => k !== 'need')) rec.set('confirmed', false);
  app.save(rec);
  L('lib_answers').syncDerived(app);
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
  L('lib_answers').syncDerived(app);
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
  L('lib_answers').syncDerived(app);
  S.log(app, ctx.actor, 'Removed ' + name + ' from the team', '');
  return { removed: name };
}

/** Put founders in order: the first is the CEO who applies (speedrun's form starts with the CEO). */
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
  L('lib_answers').syncDerived(app);
  return list(ctx);
}

/** For the delete prompt: the founder exists, and what to call them. */
function lookup(ctx, p) {
  return '"' + resolve(ctx.app, p.founder).getString('name') + '"';
}

module.exports = { resolve: resolve, lookup: lookup, list: list, get: get, add: add, update: update, confirm: confirm, remove: remove, reorder: reorder };
