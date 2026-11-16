/// <reference path="../pb_data/types.d.ts" />
/**
 * Rule packs for people: the list by country, one pack's steps, tables,
 * profile fields and vectors (run live), drafts from your AI agent shown as
 * a diff against the active version, testing, and activation with the PIN
 * only when every vector passes. Your AI agent drafts (a proposal) when a
 * person asks about a pack (pack_update_draft) and, when the company
 * switched the monthly checks on, checks one pack in use a day against its
 * official sources (rule_update_check); it never activates.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

function bodyOf(rec) {
  return L('lib_util').jsonOf(rec, 'body', {}) || {};
}

function rowView(app, r, usage) {
  const b = bodyOf(r);
  return {
    id: r.id, code: r.getString('code'), country: r.getString('country'), region: r.getString('region'), name: r.getString('name'), version: r.getString('version'),
    effective_from: r.getString('effective_from'), effective_to: r.getString('effective_to'), status: r.getString('status'), source: r.getString('source'),
    vectors_passed: r.getInt('vectors_passed'), vectors_total: r.getInt('vectors_total'), tested_at: r.getString('tested_at'), activated_at: r.getString('activated_at'),
    activated_by: L('lib_payroll_out').memberName(app, r.getString('activated_by')), ship: b.ship || '', sources: (b.sources || []).length,
    official_vectors: (b.vectors || []).filter((v) => v && v.source === 'official').length, in_use: usage ? usage[r.getString('code')] || 0 : 0, updated: r.getString('updated'),
  };
}

/** The compact list row: what tells versions apart. Full detail is packs.get. */
function listRow(r, usage) {
  return {
    id: r.id, code: r.getString('code'), country: r.getString('country'), name: r.getString('name'), version: r.getString('version'), status: r.getString('status'),
    effective_from: r.getString('effective_from'), effective_to: r.getString('effective_to'), vectors_passed: r.getInt('vectors_passed'), vectors_total: r.getInt('vectors_total'),
    in_use: usage[r.getString('code')] || 0, source: r.getString('source'),
  };
}

/** How many entities enable each pack code. */
function usage(app) {
  const u = L('lib_util');
  const out = {};
  for (const e of u.rows(app, 'SELECT id FROM entities WHERE active = TRUE', { id: '' })) {
    const codes = u.jsonOf(app.findRecordById('entities', e.id), 'packs', []) || [];
    for (const c of codes) out[c] = (out[c] || 0) + 1;
  }
  return out;
}

function packRec(ctx, p) {
  const u = L('lib_util');
  const ref = String(p.pack || '').trim();
  if (ref === '') throw u.fail(400, 'Give the pack (record id, or code to see its active version).', 'missing_param', { param: 'pack' });
  let r = u.byId(ctx.app, 'rule_packs', ref);
  if (r === null) {
    const rows = u.findMany(ctx.app, 'rule_packs', 'code = {:c}', '-effective_from', 50, { c: ref.toLowerCase() });
    if (rows.length === 0) throw u.fail(404, 'No rule pack "' + ref + '". Run packs.list.', 'not_found');
    const today = u.today(ctx.app);
    r = rows.find((x) => x.getString('status') === 'active' && x.getString('effective_from') <= today && (x.getString('effective_to') === '' || x.getString('effective_to') >= today)) || rows.find((x) => x.getString('status') === 'active') || rows[0];
  }
  return r;
}

/** Bodies of the other packs (active ones, one per code) for validation and vectors. */
function others(app, code, day) {
  const u = L('lib_util');
  const rows = u.findMany(app, 'rule_packs', 'status = "active" && code != {:c}', 'code,-effective_from', 2000, { c: code });
  const seen = {};
  const out = [];
  for (const r of rows) {
    const c = r.getString('code');
    const inForce = r.getString('effective_from') <= day && (r.getString('effective_to') === '' || r.getString('effective_to') >= day);
    if (seen[c] && !inForce) continue;
    if (seen[c] && inForce) {
      out[seen[c] - 1] = bodyOf(r);
      continue;
    }
    out.push(bodyOf(r));
    seen[c] = out.length;
  }
  return out;
}

function check(app, rec) {
  const b = bodyOf(rec);
  const pc = L('lib_packcheck');
  const day = rec.getString('effective_from') || L('lib_util').today(app);
  const oth = others(app, rec.getString('code'), day);
  let problems = [];
  let vectors = { passed: 0, total: 0, failures: [] };
  try {
    problems = pc.validate(b, oth) || [];
    vectors = pc.runVectors(b, oth);
  } catch (err) {
    problems = problems.concat([{ level: 'error', message: String((err && err.message) || err) }]);
  }
  const errors = problems.filter((x) => x && x.level === 'error');
  return { problems: problems, errors: errors.length, warnings: problems.length - errors.length, passed: vectors.passed, total: vectors.total, failures: (vectors.failures || []).slice(0, 50), ok: errors.length === 0 && vectors.total > 0 && vectors.passed === vectors.total };
}

/* --------------------------------------------------------------- diff */

function stepKey(s, i) {
  if (s.var) return 'var ' + s.var;
  if (s.code) return 'line ' + s.code;
  if (s.check) return 'check ' + (s.issue || i);
  return 'step ' + i;
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A structured diff of two pack bodies: header fields, tables, steps, fields and vectors. */
function diff(before, after) {
  const out = { meta: [], tables: [], steps: [], year_end_steps: [], profile_fields: [], vectors: { before: (before.vectors || []).length, after: (after.vectors || []).length, added: [], removed: [] }, sources: { added: [], removed: [] } };
  for (const k of ['name', 'version', 'effective_from', 'effective_to', 'currency', 'order', 'notes', 'date_basis']) if (!same(before[k], after[k])) out.meta.push({ field: k, before: before[k] === undefined ? '' : before[k], after: after[k] === undefined ? '' : after[k] });
  if (!same(before.tax_year, after.tax_year)) out.meta.push({ field: 'tax_year', before: JSON.stringify(before.tax_year || {}), after: JSON.stringify(after.tax_year || {}) });
  const tb = before.tables || {};
  const ta = after.tables || {};
  for (const name of Object.keys(Object.assign({}, tb, ta))) {
    if (tb[name] === undefined) out.tables.push({ name: name, change: 'added', rows_after: rowsOf(ta[name]) });
    else if (ta[name] === undefined) out.tables.push({ name: name, change: 'removed', rows_before: rowsOf(tb[name]) });
    else if (!same(tb[name], ta[name])) out.tables.push({ name: name, change: 'changed', rows_before: rowsOf(tb[name]), rows_after: rowsOf(ta[name]), changed_rows: changedRows(tb[name], ta[name]) });
  }
  for (const part of ['steps', 'year_end_steps']) {
    const sb = before[part] || [];
    const sa = after[part] || [];
    const mb = {};
    sb.forEach((s, i) => (mb[stepKey(s, i)] = s));
    const ma = {};
    sa.forEach((s, i) => (ma[stepKey(s, i)] = s));
    for (const k of Object.keys(Object.assign({}, mb, ma))) {
      if (mb[k] === undefined) out[part].push({ key: k, change: 'added', after: ma[k] });
      else if (ma[k] === undefined) out[part].push({ key: k, change: 'removed', before: mb[k] });
      else if (!same(mb[k], ma[k])) {
        const fields = [];
        for (const f of Object.keys(Object.assign({}, mb[k], ma[k]))) if (!same(mb[k][f], ma[k][f])) fields.push({ field: f, before: mb[k][f] === undefined ? '' : mb[k][f], after: ma[k][f] === undefined ? '' : ma[k][f] });
        out[part].push({ key: k, change: 'changed', fields: fields });
      }
    }
  }
  const fb = {};
  for (const f of before.profile_fields || []) fb[f.key] = f;
  const fa = {};
  for (const f of after.profile_fields || []) fa[f.key] = f;
  for (const k of Object.keys(Object.assign({}, fb, fa))) {
    if (fb[k] === undefined) out.profile_fields.push({ key: k, change: 'added', label: fa[k].label });
    else if (fa[k] === undefined) out.profile_fields.push({ key: k, change: 'removed', label: fb[k].label });
    else if (!same(fb[k], fa[k])) out.profile_fields.push({ key: k, change: 'changed', label: fa[k].label });
  }
  const vb = (before.vectors || []).map((v) => v.name);
  const va = (after.vectors || []).map((v) => v.name);
  out.vectors.added = va.filter((n) => vb.indexOf(n) < 0);
  out.vectors.removed = vb.filter((n) => va.indexOf(n) < 0);
  const sb = (before.sources || []).map((s) => s.url || s.title);
  const sa = (after.sources || []).map((s) => s.url || s.title);
  out.sources.added = sa.filter((n) => sb.indexOf(n) < 0);
  out.sources.removed = sb.filter((n) => sa.indexOf(n) < 0);
  out.changes = out.meta.length + out.tables.length + out.steps.length + out.year_end_steps.length + out.profile_fields.length + out.vectors.added.length + out.vectors.removed.length;
  return out;
}

function rowsOf(t) {
  if (!t || !t.rows) return 0;
  return Array.isArray(t.rows) ? t.rows.length : Object.keys(t.rows).length;
}

function changedRows(a, b) {
  const out = [];
  if (Array.isArray(a.rows) && Array.isArray(b.rows)) {
    const n = Math.max(a.rows.length, b.rows.length);
    for (let i = 0; i < n && out.length < 40; i++) if (!same(a.rows[i], b.rows[i])) out.push({ row: i, before: a.rows[i] === undefined ? null : a.rows[i], after: b.rows[i] === undefined ? null : b.rows[i] });
  } else {
    const ra = a.rows || {};
    const rb = b.rows || {};
    for (const k of Object.keys(Object.assign({}, ra, rb))) {
      if (out.length >= 40) break;
      if (!same(ra[k], rb[k])) out.push({ row: k, before: ra[k] === undefined ? null : ra[k], after: rb[k] === undefined ? null : rb[k] });
    }
  }
  return out;
}

/* ----------------------------------------------------------------- ops */

function list(ctx, p) {
  const u = L('lib_util');
  const where = [];
  const bind = {};
  const country = u.str(p, 'country', '').trim().toUpperCase();
  if (country !== '') {
    if (!/^[A-Z]{2}$/.test(country)) throw u.fail(400, 'country is a two-letter code, like SG or US.', 'invalid_param', { param: 'country' });
    where.push('country = {:c}');
    bind.c = country;
  }
  if (u.str(p, 'status', '') !== '') {
    where.push('status = {:s}');
    bind.s = u.oneOf(p, 'status', ['draft', 'tested', 'active', 'retired'], 'active');
  }
  // your AI agent sees the packs some entity enables unless it asks for all
  const inUse = u.bool(p, 'in_use', ctx.isAgent === true);
  const all = u.findMany(ctx.app, 'rule_packs', where.length ? where.join(' && ') : '1=1', 'country,code,-effective_from', 2000, bind);
  const use = usage(ctx.app);
  const rows = inUse ? all.filter((r) => (use[r.getString('code')] || 0) > 0) : all;
  const packs = rows.map((r) => listRow(r, use));
  const countries = {};
  for (const x of packs) {
    const c = x.country || '';
    const g = countries[c] || (countries[c] = { country: c, name: c === '' ? 'Templates' : countryName(c), packs: 0, active: 0, drafts: 0 });
    g.packs += 1;
    if (x.status === 'active') g.active += 1;
    if (x.status === 'draft' || x.status === 'tested') g.drafts += 1;
  }
  const asks = [];
  for (const r of all) {
    const a = L('lib_agent').openView(r, ASK_TRIGGERS);
    if (a !== null) asks.push(Object.assign({ pack: r.id, code: r.getString('code'), version: r.getString('version') }, a));
  }
  return { in_use: inUse, left_out: all.length - rows.length, packs: packs, countries: Object.keys(countries).sort().map((k) => countries[k]), asks: asks };
}

function countryName(code) {
  try {
    return L('lib_countries').get(code).name;
  } catch {
    return code;
  }
}

function tablesView(t) {
  const out = [];
  for (const name of Object.keys(t || {})) {
    const x = t[name];
    const rows = Array.isArray(x.rows) ? x.rows : Object.keys(x.rows || {}).map((k) => ({ key: k, value: x.rows[k] }));
    out.push({ name: name, type: x.type, rows: rows.length, preview: rows.slice(0, 60), default: x.default === undefined ? null : x.default });
  }
  return out;
}

function get(ctx, p) {
  const u = L('lib_util');
  const r = packRec(ctx, p);
  const b = bodyOf(r);
  const res = check(ctx.app, r);
  const versions = u.findMany(ctx.app, 'rule_packs', 'code = {:c}', '-effective_from,-created', 50, { c: r.getString('code') }).map((x) => rowView(ctx.app, x, null));
  let against = null;
  let d = null;
  if (r.getString('status') !== 'active') {
    const act = u.findMany(ctx.app, 'rule_packs', 'code = {:c} && status = "active"', '-effective_from', 1, { c: r.getString('code') });
    if (act.length > 0) {
      against = rowView(ctx.app, act[0], null);
      d = diff(bodyOf(act[0]), b);
    }
  }
  const fails = {};
  for (const f of res.failures) fails[f.name || f.vector || ''] = f;
  return {
    pack: Object.assign(rowView(ctx.app, r, usage(ctx.app)), {
      notes: b.notes || r.getString('notes'), sources: b.sources || [], tax_year: b.tax_year || {}, requires: b.requires || [], order: b.order, currency: b.currency || '',
      profile_fields: b.profile_fields || [], tags: b.tags || [], seed_components: b.seed_components || [], tables: tablesView(b.tables),
      steps: b.steps || [], year_end_steps: b.year_end_steps || [], filings: b.filings || [], documents: b.documents || [], min_wage: b.min_wage || null,
      vectors: (b.vectors || []).map((v) => ({ name: v.name, source: v.source, reference: v.reference || '', expect: v.expect || {}, passed: fails[v.name] === undefined, failure: fails[v.name] || null })),
    }),
    check: { ok: res.ok, errors: res.errors, warnings: res.warnings, problems: res.problems.slice(0, 50), passed: res.passed, total: res.total },
    versions: versions, against: against, diff: d,
    can: { activate: res.ok && r.getString('status') !== 'active' && !ctx.isAgent && L('lib_auth').can(ctx, 'payroll', 'full'), retire: r.getString('status') === 'active' && !ctx.isAgent && L('lib_auth').can(ctx, 'payroll', 'full') },
    agent: askOf(r),
    last_checked: lastChecked(r),
  };
}

/** Run the checks and vectors now and keep the result. */
function test(ctx, p) {
  const u = L('lib_util');
  L('lib_auth').need(ctx, 'payroll', 'edit');
  const r = packRec(ctx, p);
  const res = check(ctx.app, r);
  r.set('vectors_passed', res.passed);
  r.set('vectors_total', res.total);
  r.set('tested_at', u.nowIso());
  if (r.getString('status') === 'draft' && res.ok) r.set('status', 'tested');
  else if (r.getString('status') === 'tested' && !res.ok) r.set('status', 'draft');
  ctx.app.save(r);
  L('lib_audit').note(ctx, { collection: 'rule_packs', record: r.id, summary: 'Tested ' + r.getString('code') + ' ' + r.getString('version') + ': ' + res.passed + '/' + res.total + ' vectors, ' + res.errors + ' errors' });
  return { pack: rowView(ctx.app, r, null), check: { ok: res.ok, errors: res.errors, warnings: res.warnings, problems: res.problems.slice(0, 50), passed: res.passed, total: res.total, failures: res.failures } };
}

/** Activate a pack version (people only, PIN): only when it validates and every vector passes. */
function activate(ctx, p) {
  const u = L('lib_util');
  L('lib_auth').need(ctx, 'payroll', 'full', 'activate rule packs');
  const r = packRec(ctx, p);
  if (r.getString('status') === 'active') throw u.fail(409, 'This version is already active.', 'active');
  const res = check(ctx.app, r);
  if (!res.ok) throw u.fail(409, 'Not activated: ' + (res.errors > 0 ? res.errors + ' error' + (res.errors === 1 ? '' : 's') + ' in the pack' : res.total === 0 ? 'the pack has no vectors' : res.total - res.passed + ' of ' + res.total + ' vectors fail') + '.', 'vectors_fail', { passed: res.passed, total: res.total, errors: res.errors, failures: res.failures.slice(0, 10) });
  const retired = [];
  ctx.app.runInTransaction((tx) => {
    const from = r.getString('effective_from');
    const to = r.getString('effective_to') || '9999-12-31';
    for (const x of tx.findRecordsByFilter('rule_packs', 'code = {:c} && status = "active" && id != {:id}', '', 0, 0, { c: r.getString('code'), id: r.id })) {
      const xf = x.getString('effective_from');
      const xt = x.getString('effective_to') || '9999-12-31';
      if (xf <= to && from <= xt) {
        x.set('status', 'retired');
        tx.save(x);
        retired.push(x.getString('version'));
      }
    }
    const me = tx.findRecordById('rule_packs', r.id);
    me.set('status', 'active');
    me.set('vectors_passed', res.passed);
    me.set('vectors_total', res.total);
    me.set('tested_at', u.nowIso());
    if (ctx.memberId) me.set('activated_by', ctx.memberId);
    me.set('activated_at', u.nowIso());
    tx.save(me);
  });
  L('lib_audit').note(ctx, { collection: 'rule_packs', record: r.id, summary: 'Activated rule pack ' + r.getString('code') + ' ' + r.getString('version') + ' (' + res.passed + '/' + res.total + ' vectors)' + (retired.length ? '; retired ' + retired.join(', ') : '') });
  return { pack: rowView(ctx.app, ctx.app.findRecordById('rule_packs', r.id), null), retired: retired, next: 'Recalculate draft pay runs in its dates so they use this version.' };
}

function retire(ctx, p) {
  const u = L('lib_util');
  L('lib_auth').need(ctx, 'payroll', 'full', 'retire rule packs');
  const r = packRec(ctx, p);
  if (r.getString('status') !== 'active') throw u.fail(409, 'Only an active pack can be retired.', 'not_active');
  r.set('status', 'retired');
  ctx.app.save(r);
  L('lib_audit').note(ctx, { collection: 'rule_packs', record: r.id, summary: 'Retired rule pack ' + r.getString('code') + ' ' + r.getString('version') });
  return { pack: rowView(ctx.app, r, null) };
}

/** A new draft version (your AI agent's call is a proposal a person accepts). */
function draft(ctx, p) {
  const u = L('lib_util');
  L('lib_auth').need(ctx, 'payroll', 'edit');
  const body = u.obj(p, 'body');
  if (!body || typeof body.code !== 'string' || typeof body.version !== 'string') throw u.fail(400, 'body is the whole pack object as JSON, with code and version.', 'invalid_param', { param: 'body' });
  const code = body.code;
  if (u.findOne(ctx.app, 'rule_packs', 'code = {:c} && version = {:v}', { c: code, v: body.version }) !== null) throw u.fail(409, code + ' ' + body.version + ' already exists; give the draft a new version (for example ' + body.version + '-draft).', 'version_exists');
  if (!Array.isArray(body.steps) || !/^[a-z0-9-]{1,40}$/.test(code) || body.version.length > 40) throw u.fail(400, 'A pack needs a code (lower case letters, digits, dashes), a version and a steps list.', 'pack_invalid');
  const existing = u.findOne(ctx.app, 'rule_packs', 'code = {:c}', { c: code });
  if (existing !== null && existing.getString('country') !== String(body.country || '')) throw u.fail(400, 'Pack ' + code + ' belongs to country ' + existing.getString('country') + '.', 'pack_invalid');
  body.ship = 'draft';
  const rec = u.newRecord(ctx.app, 'rule_packs');
  rec.set('code', code);
  rec.set('country', body.country || '');
  rec.set('region', body.region || '');
  rec.set('name', u.clip(body.name || code, 200));
  rec.set('version', body.version);
  rec.set('effective_from', body.effective_from || '');
  rec.set('effective_to', body.effective_to || '');
  rec.set('status', 'draft');
  rec.set('body', body);
  rec.set('vectors_passed', 0);
  rec.set('vectors_total', (body.vectors || []).length);
  rec.set('source', ctx.isAgent ? 'agent' : 'person');
  rec.set('notes', u.clip(u.str(p, 'notes', '') || body.notes || '', 4000));
  ctx.app.save(rec);
  const res = check(ctx.app, rec);
  rec.set('vectors_passed', res.passed);
  rec.set('vectors_total', res.total);
  rec.set('tested_at', u.nowIso());
  if (res.ok) rec.set('status', 'tested');
  ctx.app.save(rec);
  L('lib_audit').note(ctx, { collection: 'rule_packs', record: rec.id, summary: 'Drafted rule pack ' + code + ' ' + body.version + ' (' + res.passed + '/' + res.total + ' vectors)' });
  return { pack: rowView(ctx.app, rec, null), check: { ok: res.ok, errors: res.errors, passed: res.passed, total: res.total }, next: res.ok ? 'Review the diff and activate it with your PIN.' : 'Fix the failing vectors before it can be activated.' };
}

function discard(ctx, p) {
  const u = L('lib_util');
  L('lib_auth').need(ctx, 'payroll', 'edit');
  const r = packRec(ctx, p);
  if (['draft', 'tested'].indexOf(r.getString('status')) < 0 || r.getString('source') === 'builtin') throw u.fail(409, 'Only a draft that a person or your AI agent made can be discarded.', 'not_draft');
  ctx.app.delete(r);
  L('lib_audit').note(ctx, { collection: 'rule_packs', record: r.id, summary: 'Discarded draft ' + r.getString('code') + ' ' + r.getString('version') });
  return { ok: true };
}

const ASK_TRIGGERS = ['pack_update_draft', 'rule_update_check'];
const CHECK_EVERY_DAYS = 28;

/** The open ask on a pack (a person's or the monthly check), else the latest one, as screens show it. */
function askOf(r) {
  const ag = L('lib_agent');
  const open = ag.openView(r, ASK_TRIGGERS);
  if (open !== null) return open;
  const vs = ASK_TRIGGERS.map((t) => ag.view(r, t)).filter((v) => v !== null);
  vs.sort((x, y) => (x.asked_at < y.asked_at ? 1 : -1));
  return vs.length > 0 ? vs[0] : null;
}

/** When your AI agent last finished a check or draft of this pack ('' when never). */
function lastChecked(r) {
  const ag = L('lib_agent');
  let last = '';
  for (const t of ASK_TRIGGERS) {
    const a = ag.stateOf(r, t);
    if (a !== null && (a.ended_at || '') > last) last = a.ended_at;
  }
  return last;
}

/** agent.retry on pack_update_draft and rule_update_check: payroll edit rights. */
function mayAsk(ctx) {
  L('lib_auth').need(ctx, 'payroll', 'edit');
}

/** packs.ask-update: ask your AI agent to check this pack's official sources and draft an update (pack_update_draft with the pack's id). */
function askUpdate(ctx, p) {
  const u = L('lib_util');
  mayAsk(ctx);
  const r = packRec(ctx, p);
  const note = u.text(p, 'note', 2000, '');
  const x = L('lib_agent').ask(ctx, r, 'pack_update_draft', { note: note });
  L('lib_audit').note(ctx, { collection: 'rule_packs', record: r.id, summary: (x.asked ? 'Asked your AI agent about ' : 'Your AI agent is already asked about ') + r.getString('code') + ' ' + r.getString('version') + (note ? ': ' + u.clip(note, 120) : ''), after: { trigger: 'pack_update_draft', request: x.request } });
  return { asked: x.asked, agent: askOf(ctx.app.findRecordById('rule_packs', r.id)) };
}

/** packs.check-updates: ask your AI agent to check one pack's official sources for changes now (pack_update_draft). */
function checkUpdates(ctx, p) {
  const u = L('lib_util');
  mayAsk(ctx);
  const r = packRec(ctx, p);
  const x = L('lib_agent').ask(ctx, r, 'pack_update_draft', { note: 'Check the official sources for changes since ' + (lastChecked(r) !== '' ? 'the last check (' + lastChecked(r).slice(0, 10) + ')' : 'the sources were read') + '.' });
  L('lib_audit').note(ctx, { collection: 'rule_packs', record: r.id, summary: (x.asked ? 'Asked your AI agent to check ' : 'Your AI agent is already asked about ') + r.getString('code') + ' ' + r.getString('version'), after: { trigger: 'pack_update_draft', request: x.request } });
  return { asked: x.asked, agent: askOf(ctx.app.findRecordById('rule_packs', r.id)) };
}

/**
 * packs.checked (your AI agent): the sources of a pack were checked and
 * nothing is drafted (no change, or what could not be verified). Closes the
 * ask on the pack; the person who asked is told.
 */
function checked(ctx, p) {
  const u = L('lib_util');
  if (!ctx.isAgent) throw u.fail(403, 'packs.checked is for your AI agent.', 'not_permitted');
  const r = packRec(ctx, p);
  const changed = u.str(p, 'changed', 'no');
  const note = u.text(p, 'note', 2000, '');
  if (u.squash(note) === '') throw u.fail(400, 'note: what you checked (sources) and what you found or could not verify.', 'missing_param', { param: 'note' });
  const outcome = changed === 'unverified' ? 'unverified' : 'unchanged';
  const ag = L('lib_agent');
  const by = [];
  for (const t of ASK_TRIGGERS) {
    const a = ag.stateOf(r, t);
    if (ag.end(ctx.app, ctx.app.findRecordById('rule_packs', r.id), t, outcome, note) && a !== null && a.by) by.push(a.by);
  }
  const title = (outcome === 'unverified' ? 'Your AI agent could not verify every source of ' : 'Your AI agent checked ') + r.getString('code') + ' ' + r.getString('version') + (outcome === 'unchanged' ? ': no change' : '');
  if (by.length > 0) L('lib_notify').notify(ctx.app, by, { kind: 'agent', title: title, body: u.clip(note, 600), link: '#/payroll/packs/' + r.id });
  else if (outcome === 'unverified') L('lib_notify').toRole(ctx.app, 'payroll_admin', { kind: 'agent', title: title, body: u.clip(note, 600), link: '#/payroll/packs/' + r.id });
  L('lib_audit').note(ctx, { collection: 'rule_packs', record: r.id, summary: title });
  return { pack: r.id, outcome: outcome, agent: askOf(ctx.app.findRecordById('rule_packs', r.id)) };
}

/** packs.draft by your AI agent delivers its asks (lib_agent.DELIVER): the open asks on every version of that code. */
function deliveredBy(app, p) {
  const u = L('lib_util');
  let body = p.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return [];
    }
  }
  const code = body && typeof body.code === 'string' ? body.code : '';
  if (code === '') return [];
  const out = [];
  for (const r of u.findMany(app, 'rule_packs', 'code = {:c}', '', 50, { c: code })) for (const t of ASK_TRIGGERS) if (L('lib_agent').isOpen(L('lib_agent').stateOf(r, t))) out.push({ rec: r, trigger: t });
  return out;
}

/**
 * Daily, only when the company switched Monthly payroll rule checks on:
 * the one active pack in use checked longest ago (never, or over
 * CHECK_EVERY_DAYS days) with no open ask is checked (rule_update_check).
 * One pack a day at most.
 */
function cronDaily(app) {
  const u = L('lib_util');
  const ag = L('lib_agent');
  if (!ag.autoOn(app, 'monthly_rule_checks')) return { asked: 0 };
  const use = usage(app);
  const today = u.today(app);
  const due = Date.now() - CHECK_EVERY_DAYS * 86400000;
  let pick = null;
  let pickAt = '';
  for (const r of u.findMany(app, 'rule_packs', 'status = "active"', 'code,effective_from', 2000, {})) {
    if ((use[r.getString('code')] || 0) === 0) continue;
    if (r.getString('effective_to') !== '' && r.getString('effective_to') < today) continue;
    if (ag.openView(r, ASK_TRIGGERS) !== null) continue;
    let last = '';
    for (const t of ASK_TRIGGERS) {
      const a = ag.stateOf(r, t);
      if (a !== null && (a.asked_at || '') > last) last = a.asked_at;
    }
    if (last !== '' && Date.parse(last.replace(' ', 'T')) > due) continue;
    if (pick === null || last < pickAt) {
      pick = r;
      pickAt = last;
    }
  }
  if (pick === null) return { asked: 0 };
  const x = ag.ask(app, pick, 'rule_update_check', { source: 'monthly_rule_checks', defer: true });
  return { asked: x.asked ? 1 : 0, waiting: x.waiting === true, pack: pick.getString('code') };
}

module.exports = { diff: diff, list: list, get: get, test: test, activate: activate, retire: retire, draft: draft, discard: discard, askUpdate: askUpdate, checkUpdates: checkUpdates, checked: checked, mayAsk: mayAsk, deliveredBy: deliveredBy, cronDaily: cronDaily };
