/// <reference path="../pb_data/types.d.ts" />
/**
 * Your AI agent's proposals (Store OS model). When your AI agent calls an
 * operation marked agent 'propose' and the owner's autonomy for its kind
 * is 'ask' (the default), the call is stored here instead of run, with a
 * before and after preview. A person accepts it (the op then runs as that
 * person, with their rights checked) or dismisses it with a note. Each item
 * is checked again at accept: if what it changes moved since it was
 * proposed it is skipped as stale. The same change proposed twice adds
 * nothing; a different value for the same thing replaces the older one.
 * Pending proposals expire after 14 days.
 *
 * Preview: an op may declare `preview: 'lib_x.fn'` (ctx, params) ->
 * { label, target, fields: [{ name, before, after }], notes, risk }, or
 * `diff: { collection, id: '<param>', fields: { <param>: '<field>' } }`;
 * otherwise the preview lists the params.
 */

const EXPIRE_DAYS = 14;
const KIND_MODULE = { people: 'people', time: 'time', leave: 'leave', expenses: 'expenses', payroll: 'payroll', hiring: 'hiring', performance: 'performance', packs: 'payroll' };
const RISK = { low: 0, medium: 1, high: 2 };

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

function firstSentence(s) {
  const t = String(s || '');
  const i = t.indexOf('. ');
  return (i > 0 ? t.slice(0, i) : t).replace(/\.$/, '');
}

/** The record a diff names: employees and employments also by number. */
function diffRecord(app, collection, ref) {
  const people = L('lib_people');
  if (ref === undefined || ref === null || ref === '') return null;
  const org = L('lib_org');
  const kinds = { locations: 'location', departments: 'department', job_titles: 'title', grades: 'grade', cost_centers: 'cost_center', employment_types: 'employment_type' };
  try {
    if (collection === 'employees') return people.employeeRef(app, String(ref));
    if (collection === 'employments') return people.employmentRef(app, String(ref));
    if (collection === 'entities') return org.entityRef(app, String(ref));
    if (kinds[collection]) return org.kindRef(app, kinds[collection], String(ref));
    if (collection === 'holiday_calendars') return L('lib_calendar').calendarRef(app, String(ref));
    if (collection === 'work_schedules') return L('lib_calendar').scheduleRef(app, String(ref));
  } catch {
    return null;
  }
  return u().byId(app, collection, String(ref));
}

function shown(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

function preview(ctx, spec, params) {
  const app = ctx.app;
  if (spec.preview) {
    const parts = spec.preview.split('.');
    const out = require(`${__hooks}/${parts[0]}.js`)[parts[1]](ctx, params) || {};
    return { label: out.label || firstSentence(spec.desc), target: out.target || '', fields: out.fields || [], notes: out.notes || [], risk: out.risk || 'medium' };
  }
  if (spec.diff) {
    const rec = diffRecord(app, spec.diff.collection, params[spec.diff.id]);
    const fields = [];
    for (const k of Object.keys(spec.diff.fields)) {
      if (params[k] === undefined) continue;
      const f = spec.diff.fields[k];
      let before = '';
      if (rec !== null) {
        const raw = rec.get(f);
        before = raw === undefined || raw === null ? '' : typeof raw === 'object' ? u().jsonOf(rec, f, '') : raw;
      }
      if (canon(shown(before)) === canon(shown(params[k]))) continue;
      fields.push({ name: k, before: shown(before), after: shown(params[k]) });
    }
    return { label: firstSentence(spec.desc) + (rec !== null ? ' (' + spec.diff.collection + ' ' + rec.id + ')' : ''), target: rec !== null ? spec.diff.collection + ':' + rec.id : '', fields: fields, notes: [], risk: 'medium' };
  }
  const fields = Object.keys(params)
    .filter((k) => params[k] !== '' && params[k] !== undefined)
    .map((k) => ({ name: k, before: '', after: shown(params[k]) }));
  return { label: firstSentence(spec.desc), target: '', fields: fields, notes: [], risk: 'medium' };
}

/** JSON with object keys sorted (stored JSON comes back with sorted keys). */
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v !== null && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}

function keyOf(spec, params) {
  if (spec.diff && params[spec.diff.id] !== undefined) return spec.name + ':' + params[spec.diff.id];
  const ks = Object.keys(params).sort();
  return spec.name + ':' + canon(ks.map((k) => [k, params[k]]));
}

function itemOf(ctx, spec, params) {
  const pv = preview(ctx, spec, params);
  return { op: spec.name, params: params, key: keyOf(spec, params), label: pv.label, target: pv.target, fields: pv.fields, notes: pv.notes, risk: pv.risk, state: 'pending' };
}

function afterOf(it) {
  return canon(it.op === undefined ? [] : (it.fields || []).map((f) => [f.name, f.after]).concat([['params', it.params]]));
}

function settleRepeats(app, items) {
  const util = u();
  const keep = [];
  const dupOf = [];
  for (const it of items) {
    let dup = '';
    for (const r of util.findMany(app, 'proposals', "status = 'pending'", 'created')) {
      const old = util.jsonOf(r, 'items', []) || [];
      let changed = false;
      for (const o of old) {
        if (o.state !== 'pending' || o.key !== it.key) continue;
        if (afterOf(o) === afterOf(it)) dup = r.id;
        else if (it.key.indexOf('[') < 0) {
          o.state = 'superseded';
          o.error = 'Replaced by a newer proposal.';
          changed = true;
        }
      }
      if (changed) {
        r.set('items', old);
        if (!old.some((o) => o.state === 'pending')) {
          r.set('status', 'withdrawn');
          r.set('decided_at', util.nowIso());
        }
        app.save(r);
      }
    }
    if (dup !== '') dupOf.push(dup);
    else keep.push(it);
  }
  return { keep: keep, duplicate_of: dupOf };
}

function make(ctx, kind, title, why, items, entity) {
  const util = u();
  const r = util.newRecord(ctx.app, 'proposals');
  let risk = 'low';
  for (const it of items) if (RISK[it.risk] > RISK[risk]) risk = it.risk;
  r.set('kind', kind);
  r.set('title', util.clip(title, 300));
  r.set('why', util.clip(why || '', 4000));
  r.set('origin', ctx.isAgent ? 'agent' : 'rule');
  r.set('status', 'pending');
  r.set('risk', risk);
  r.set('items', items);
  r.set('target', items.length > 0 ? util.clip(items[0].target || '', 80) : '');
  r.set('entity', entity || '');
  ctx.app.save(r);
  return r;
}

function view(app, r) {
  const util = u();
  const items = util.jsonOf(r, 'items', []) || [];
  const dm = r.getString('decided_by') !== '' ? util.byId(app, 'members', r.getString('decided_by')) : null;
  return {
    id: r.id,
    kind: r.getString('kind'),
    title: r.getString('title'),
    why: r.getString('why'),
    origin: r.getString('origin'),
    status: r.getString('status'),
    risk: r.getString('risk'),
    target: r.getString('target'),
    note: r.getString('note'),
    items: items.map((it, i) => ({ index: i, op: it.op, label: it.label, fields: it.fields || [], notes: it.notes || [], risk: it.risk, state: it.state || 'pending', error: it.error || '', result: it.result || null })),
    decided_by: r.getString('decided_by'),
    decided_by_name: dm ? dm.getString('name') : '',
    decided_at: r.getString('decided_at'),
    created: r.getString('created'),
  };
}

/** Your AI agent called a 'propose' op: store it (the dispatcher audits it). */
function fromCall(ctx, spec, params) {
  const why = String(params.why || '');
  const clean = Object.assign({}, params);
  delete clean.why;
  const item = itemOf(ctx, spec, clean);
  const s = settleRepeats(ctx.app, [item]);
  if (s.keep.length === 0) return { proposed: true, proposal: s.duplicate_of[0], duplicate_of: s.duplicate_of[0], label: item.label, message: 'The same change is already waiting in proposal ' + s.duplicate_of[0] + '. Nothing new was added.' };
  const r = make(ctx, spec.kind, item.label, why, [item], '');
  return { proposed: true, proposal: r.id, label: item.label, message: 'Waiting for a person to accept it in the Inbox. Nothing changed yet.', preview: { label: item.label, fields: item.fields, notes: item.notes, risk: item.risk } };
}

/* ------------------------------------------------------------------- ops */

function canSeeKind(ctx, kind) {
  const auth = L('lib_auth');
  if (ctx.isAgent) return true;
  if (auth.can(ctx, 'admin', 'edit')) return true;
  if (kind === 'mixed') return false;
  return auth.can(ctx, KIND_MODULE[kind] || 'admin', 'edit');
}

function create(ctx, p) {
  const util = u();
  const raw = util.list(p, 'items');
  if (raw === undefined || raw.length === 0) throw util.fail(400, 'Give --items \'[{"op":"job.update","params":{"employment":"E0001","reason":"promotion","title":"Senior engineer"}}]\'.', 'missing_param', { param: 'items' });
  if (raw.length > 100) throw util.fail(400, 'At most 100 changes in one proposal.', 'too_many');
  const cat = L('lib_catalog');
  const items = [];
  const kinds = {};
  raw.forEach((it, i) => {
    let spec;
    try {
      spec = cat.get(String(it.op || ''));
    } catch {
      throw util.fail(400, 'Item ' + (i + 1) + ': unknown operation ' + it.op + '.', 'invalid_param');
    }
    if (spec.agent !== 'propose') throw util.fail(400, 'Item ' + (i + 1) + ': ' + spec.name + ' does not need a proposal; run it directly (or a person runs it when it is people only).', 'invalid_param');
    const params = L('lib_ops').check(it.params && typeof it.params === 'object' ? it.params : {}, spec, false);
    delete params.why;
    items.push(itemOf(ctx, spec, params));
    kinds[spec.kind] = true;
  });
  const ks = Object.keys(kinds);
  const s = settleRepeats(ctx.app, items);
  if (s.keep.length === 0) return { proposal: view(ctx.app, ctx.app.findRecordById('proposals', s.duplicate_of[0])), duplicate_of: s.duplicate_of, message: 'Every change here is already waiting. Nothing new was added.' };
  const title = util.text(p, 'title', 300, '') || (s.keep.length === 1 ? s.keep[0].label : s.keep.length + ' changes');
  const r = make(ctx, ks.length === 1 ? ks[0] : 'mixed', title, util.text(p, 'why', 4000, ''), s.keep, '');
  L('lib_audit').note(ctx, { collection: 'proposals', record: r.id, summary: 'Your AI agent proposed: ' + title });
  const out = { proposal: view(ctx.app, r) };
  if (s.duplicate_of.length > 0) out.duplicate_of = s.duplicate_of;
  return out;
}

function list(ctx, p) {
  const util = u();
  const status = util.oneOf(p, 'status', ['pending', 'decided', 'all'], 'pending');
  const filter = status === 'pending' ? "status = 'pending'" : status === 'decided' ? "status != 'pending'" : '1=1';
  const kind = util.str(p, 'kind', '');
  const pg = util.page(p, 50, 300);
  const rows = util
    .findMany(ctx.app, 'proposals', filter + (kind !== '' ? ' && kind = {:k}' : ''), status === 'pending' ? 'created' : '-created', 1000, { k: kind })
    .filter((r) => canSeeKind(ctx, r.getString('kind')));
  return { proposals: rows.slice(pg.offset, pg.offset + pg.limit).map((r) => view(ctx.app, r)), total: rows.length, pending: status === 'pending' ? rows.length : util.count(ctx.app, "SELECT COUNT(*) AS n FROM proposals WHERE status = 'pending'") };
}

function ref(ctx, id) {
  const r = u().byId(ctx.app, 'proposals', String(id || ''));
  if (r === null) throw u().fail(404, 'No proposal ' + id + '. Run proposals.list.', 'not_found');
  if (!canSeeKind(ctx, r.getString('kind'))) throw u().fail(403, 'You cannot see this proposal.', 'not_permitted');
  return r;
}

function get(ctx, p) {
  return { proposal: view(ctx.app, ref(ctx, u().req(p, 'proposal'))) };
}

/** Accept (all items, or the chosen ones; the rest are dismissed). Each runs as the person accepting. */
function accept(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = ref(ctx, util.req(p, 'proposal'));
  if (r.getString('status') !== 'pending') throw util.fail(409, 'This proposal is already ' + r.getString('status') + '.', 'conflict');
  const items = util.jsonOf(r, 'items', []) || [];
  const chosen = (util.list(p, 'items') || []).map(Number);
  const pick = (i) => chosen.length === 0 || chosen.indexOf(i) >= 0;
  const cat = L('lib_catalog');
  let applied = 0;
  let failed = 0;
  items.forEach((it, i) => {
    if (it.state !== 'pending') return;
    if (!pick(i)) {
      it.state = 'dismissed';
      return;
    }
    let now;
    try {
      now = preview(ctx, cat.get(it.op), Object.assign({}, it.params));
    } catch (err) {
      it.state = 'failed';
      it.error = String((err && err.message) || err);
      failed++;
      return;
    }
    const stale = (it.fields || []).some((f) => {
      const cur = (now.fields || []).filter((x) => x.name === f.name)[0];
      return cur !== undefined && f.before !== '' && canon(cur.before) !== canon(f.before);
    });
    if (stale) {
      it.state = 'stale';
      it.error = 'Changed since it was proposed; not applied.';
      failed++;
      return;
    }
    try {
      const out = L('lib_ops').runAs(ctx, it.op, Object.assign({}, it.params));
      it.state = 'applied';
      const text = out && typeof out === 'object' ? JSON.stringify(out, (k, v) => (k === 'events' ? undefined : v)) : '';
      it.result = text !== '' && text.length <= 4000 ? JSON.parse(text) : { ok: true };
      applied++;
    } catch (err) {
      it.state = 'failed';
      it.error = String((err && err.message) || err);
      failed++;
    }
  });
  r.set('items', items);
  r.set('status', applied === 0 ? 'failed' : failed > 0 || items.some((x) => x.state === 'dismissed') ? 'partial' : 'accepted');
  r.set('decided_by', ctx.memberId);
  r.set('decided_at', util.nowIso());
  app.save(r);
  L('lib_audit').note(ctx, { collection: 'proposals', record: r.id, summary: 'Accepted: ' + r.getString('title') + ' (' + applied + ' applied' + (failed > 0 ? ', ' + failed + ' not' : '') + ')' });
  return { proposal: view(app, r), applied: applied, failed: failed };
}

function dismiss(ctx, p) {
  const util = u();
  const r = ref(ctx, util.req(p, 'proposal'));
  if (r.getString('status') !== 'pending') throw util.fail(409, 'This proposal is already ' + r.getString('status') + '.', 'conflict');
  const items = util.jsonOf(r, 'items', []) || [];
  for (const it of items) if (it.state === 'pending') it.state = 'dismissed';
  r.set('items', items);
  r.set('status', 'dismissed');
  r.set('note', util.text(p, 'note', 2000, ''));
  r.set('decided_by', ctx.memberId);
  r.set('decided_at', util.nowIso());
  ctx.app.save(r);
  L('lib_audit').note(ctx, { collection: 'proposals', record: r.id, summary: 'Dismissed: ' + r.getString('title') + (r.getString('note') !== '' ? ' (' + util.clip(r.getString('note'), 160) + ')' : '') });
  return { proposal: view(ctx.app, r) };
}

function withdraw(ctx, p) {
  const util = u();
  const r = ref(ctx, util.req(p, 'proposal'));
  if (r.getString('status') !== 'pending') throw util.fail(409, 'This proposal is already ' + r.getString('status') + '.', 'conflict');
  r.set('status', 'withdrawn');
  r.set('decided_at', util.nowIso());
  ctx.app.save(r);
  L('lib_audit').note(ctx, { collection: 'proposals', record: r.id, summary: 'Withdrew: ' + r.getString('title') });
  return { proposal: view(ctx.app, r) };
}

/** Nightly: pending proposals older than two weeks close themselves rather than apply late. */
function expire(app) {
  const util = u();
  const before = new Date(Date.now() - EXPIRE_DAYS * 86400000).toISOString().replace('T', ' ');
  let n = 0;
  for (const r of util.findMany(app, 'proposals', "status = 'pending' && created < {:t}", '', 0, { t: before })) {
    r.set('status', 'expired');
    r.set('decided_at', util.nowIso());
    app.save(r);
    n++;
  }
  return n;
}

module.exports = { KIND_MODULE: KIND_MODULE, preview: preview, fromCall: fromCall, create: create, list: list, get: get, accept: accept, dismiss: dismiss, withdraw: withdraw, expire: expire, view: view, canSeeKind: canSeeKind };
